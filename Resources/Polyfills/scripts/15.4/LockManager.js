// https://github.com/aermin/web-locks
// MIT License (c) 2020 aermin
// Native LockManager / navigator.locks is Safari 15.4 / iOS 15.4.
(function (global) {
    var navigator = global.navigator;
    if (!navigator || navigator.locks) return;
    if (typeof Promise !== 'function') return;

    var SECRET = {};
    var MODE_EXCLUSIVE = 'exclusive';
    var MODE_SHARED = 'shared';
    var LIB_PREFIX = '$navigator.locks';
    var KEY_QUEUE = '$navigator.locks-requestQueueMap';
    var KEY_HELD = '$navigator.locks-heldLockSet';
    var KEY_CLIENTS = '$navigator.locks-clientIds';
    var HEARTBEAT_MS = 1000;
    var DETECT_MS = 2000;
    var STALE_MS = 3100;

    var memoryStore = {};
    var storageOk = false;
    var localListeners = {};

    try {
        var ls = global.localStorage;
        ls.setItem('__pf_locks_probe', '1');
        ls.removeItem('__pf_locks_probe');
        storageOk = true;
    } catch (e) {}

    function makeDOMException(message, name) {
        try {
            return new DOMException(message, name);
        } catch (err) {
            var fallback = new Error(message);
            fallback.name = name || 'Error';
            return fallback;
        }
    }

    function generateRandomId() {
        return Date.now() + '-' + String(Math.random()).substring(2);
    }

    function findIndex(list, predicate) {
        for (var i = 0; i < list.length; i++) {
            if (predicate(list[i], i)) return i;
        }
        return -1;
    }

    function unique(list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            if (out.indexOf(list[i]) === -1) out.push(list[i]);
        }
        return out;
    }

    function toLockInfo(request) {
        return {
            name: request.name,
            mode: request.mode,
            clientId: request.clientId,
            uuid: request.uuid
        };
    }

    function publicLockInfo(info) {
        return {
            name: info.name,
            mode: info.mode,
            clientId: info.clientId
        };
    }

    function getStorageItem(key) {
        if (storageOk) {
            try {
                return global.localStorage.getItem(key);
            } catch (err) {}
        }
        return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
    }

    function setStorageItem(key, value) {
        memoryStore[key] = value;
        if (storageOk) {
            try {
                global.localStorage.setItem(key, value);
            } catch (err) {}
        }
        notifyLocal(key);
    }

    function removeStorageItem(key) {
        delete memoryStore[key];
        if (storageOk) {
            try {
                global.localStorage.removeItem(key);
            } catch (err) {}
        }
        notifyLocal(key);
    }

    function notifyLocal(key) {
        var list = localListeners[key];
        if (!list || !list.length) return;
        var copy = list.slice();
        for (var i = 0; i < copy.length; i++) {
            copy[i]();
        }
    }

    function onStorageChange(key, listener) {
        function finish(needRemove) {
            if (needRemove) remove();
        }

        function run() {
            var result;
            try {
                result = listener();
            } catch (err) {
                return;
            }
            if (result && typeof result.then === 'function') {
                result.then(finish);
            } else {
                finish(result);
            }
        }

        function remove() {
            var list = localListeners[key];
            if (list) {
                var idx = list.indexOf(run);
                if (idx !== -1) list.splice(idx, 1);
            }
            if (global.removeEventListener) {
                global.removeEventListener('storage', onWindowStorage);
            }
        }

        function onWindowStorage(event) {
            if (event && event.key === key) run();
        }

        if (!localListeners[key]) localListeners[key] = [];
        localListeners[key].push(run);
        if (global.addEventListener) {
            global.addEventListener('storage', onWindowStorage, false);
        }

        return remove;
    }

    function parseJSON(raw, fallback) {
        if (!raw) return fallback;
        try {
            var value = JSON.parse(raw);
            return value == null ? fallback : value;
        } catch (err) {
            return fallback;
        }
    }

    function getAbortError(signal) {
        if (signal && signal.reason) return signal.reason;
        return makeDOMException('The request was aborted.', 'AbortError');
    }

    function Lock(token, name, mode) {
        if (token !== SECRET) {
            throw new TypeError("Failed to construct 'Lock': Illegal constructor");
        }
        this.name = name;
        this.mode = mode;
    }

    function LockManager(token) {
        if (token !== SECRET) {
            throw new TypeError("Failed to construct 'LockManager': Illegal constructor");
        }
        this._clientId = LIB_PREFIX + '-clientId-' + generateRandomId();
        this._defaultOptions = {
            mode: MODE_EXCLUSIVE,
            ifAvailable: false,
            steal: false
        };
        this._heartbeatId = null;
        this._detectId = null;
        initManager(this);
    }

    function getClientIds() {
        return parseJSON(getStorageItem(KEY_CLIENTS), []);
    }

    function storeClientIds(clientIds) {
        setStorageItem(KEY_CLIENTS, JSON.stringify(clientIds));
    }

    function requestQueueMap() {
        return parseJSON(getStorageItem(KEY_QUEUE), {});
    }

    function heldLockSet() {
        return parseJSON(getStorageItem(KEY_HELD), []);
    }

    function storeHeldLockSet(set) {
        setStorageItem(KEY_HELD, JSON.stringify(set));
    }

    function storeRequestLockQueueMap(map) {
        setStorageItem(KEY_QUEUE, JSON.stringify(map));
    }

    function storeHeldAndQueue(set, map) {
        storeHeldLockSet(set);
        storeRequestLockQueueMap(map);
    }

    function isInHeldLockSet(uuid) {
        var set = heldLockSet();
        for (var i = 0; i < set.length; i++) {
            if (set[i].uuid === uuid) return true;
        }
        return false;
    }

    function findHeldLock(set, name) {
        for (var i = 0; i < set.length; i++) {
            if (set[i].name === name) return set[i];
        }
        return undefined;
    }

    function initManager(manager) {
        storeClientIds(getClientIds().concat([manager._clientId]));
        if (storageOk) {
            setStorageItem(manager._clientId, String(Date.now()));
            manager._heartbeatId = setInterval(function () {
                setStorageItem(manager._clientId, String(Date.now()));
            }, HEARTBEAT_MS);
            manager._detectId = setInterval(function () {
                cleanUnliveClientLocks();
            }, DETECT_MS);
        }
        if (global.addEventListener) {
            global.addEventListener('pagehide', function (event) {
                if (!event || !event.persisted) {
                    destroyManager(manager);
                    cleanClientLocksByClientId(manager._clientId);
                }
            });
        }
    }

    function destroyManager(manager) {
        if (manager._heartbeatId) {
            clearInterval(manager._heartbeatId);
            manager._heartbeatId = null;
        }
        if (manager._detectId) {
            clearInterval(manager._detectId);
            manager._detectId = null;
        }
        removeStorageItem(manager._clientId);
    }

    function handleRequestArgs(manager, args, reject) {
        var argsLength = args.length;
        var cb;
        var options = {
            mode: manager._defaultOptions.mode,
            ifAvailable: manager._defaultOptions.ifAvailable,
            steal: manager._defaultOptions.steal
        };

        if (argsLength < 2) {
            reject(new TypeError(
                "Failed to execute 'request' on 'LockManager': 2 arguments required, but only " +
                    argsLength + ' present.'
            ));
            return null;
        }

        if (argsLength === 2) {
            if (typeof args[1] !== 'function') {
                reject(new TypeError(
                    "Failed to execute 'request' on 'LockManager': parameter 2 is not of type 'Function'."
                ));
                return null;
            }
            cb = args[1];
        } else {
            if (typeof args[2] !== 'function') {
                reject(new TypeError(
                    "Failed to execute 'request' on 'LockManager': parameter 3 is not of type 'Function'."
                ));
                return null;
            }
            cb = args[2];
            var incoming = args[1] || {};
            if (incoming.mode !== undefined) options.mode = incoming.mode;
            if (incoming.ifAvailable !== undefined) options.ifAvailable = !!incoming.ifAvailable;
            if (incoming.steal !== undefined) options.steal = !!incoming.steal;
            if (incoming.signal !== undefined) options.signal = incoming.signal;
        }

        if (options.mode !== MODE_EXCLUSIVE && options.mode !== MODE_SHARED) {
            reject(new TypeError(
                "Failed to execute 'request' on 'LockManager': The provided value '" +
                    options.mode + "' is not a valid enum value of type LockMode."
            ));
            return null;
        }

        var name = String(args[0]);
        if (name.charAt(0) === '-') {
            reject(makeDOMException(
                "Failed to execute 'request' on 'LockManager': Names cannot start with '-'.",
                'NotSupportedError'
            ));
            return null;
        }

        if (options.signal && options.steal) {
            reject(makeDOMException(
                "Failed to execute 'request' on 'LockManager': The 'signal' and 'steal' options cannot be used together.",
                'NotSupportedError'
            ));
            return null;
        }

        if (options.signal && options.ifAvailable) {
            reject(makeDOMException(
                "Failed to execute 'request' on 'LockManager': The 'signal' and 'ifAvailable' options cannot be used together.",
                'NotSupportedError'
            ));
            return null;
        }

        if (options.steal && options.ifAvailable) {
            reject(makeDOMException(
                "Failed to execute 'request' on 'LockManager': The 'steal' and 'ifAvailable' options cannot be used together.",
                'NotSupportedError'
            ));
            return null;
        }

        if (options.steal && options.mode !== MODE_EXCLUSIVE) {
            reject(makeDOMException(
                "Failed to execute 'request' on 'LockManager': The 'steal' option may only be used with 'exclusive' locks.",
                'NotSupportedError'
            ));
            return null;
        }

        return { cb: cb, options: options, name: name };
    }

    function handleSignal(options, reject, request) {
        var signal = options.signal;
        if (typeof AbortSignal === 'undefined' || !(signal instanceof AbortSignal)) {
            reject(new TypeError(
                "Failed to execute 'request' on 'LockManager': member signal is not of type AbortSignal."
            ));
            return false;
        }
        if (signal.aborted) {
            reject(getAbortError(signal));
            return false;
        }
        var listener = function () {
            var map = requestQueueMap();
            var queue = map[request.name];
            if (queue) {
                var idx = findIndex(queue, function (lock) {
                    return lock.uuid === request.uuid;
                });
                if (idx !== -1) {
                    queue.splice(idx, 1);
                    storeRequestLockQueueMap(map);
                }
            }
            reject(getAbortError(signal));
        };
        signal.addEventListener('abort', listener);
        request.closeSignal = function () {
            signal.removeEventListener('abort', listener);
        };
        return true;
    }

    function resolveWithCB(cb, resolve, reject) {
        return function (lock) {
            return new Promise(function (innerResolve) {
                Promise.resolve().then(function () {
                    return cb(lock);
                }).then(function (result) {
                    innerResolve(result);
                    resolve(result);
                }, function (error) {
                    innerResolve(error);
                    reject(error);
                });
            });
        };
    }

    function pushToQueue(request) {
        var map = requestQueueMap();
        var queue = map[request.name] || [];
        map[request.name] = queue.concat([toLockInfo(request)]);
        storeRequestLockQueueMap(map);
        return request;
    }

    function pushToHeld(request, currentHeld) {
        var set = (currentHeld || heldLockSet()).concat([toLockInfo(request)]);
        storeHeldLockSet(set);
        return request;
    }

    function updateHeldAndRequestLocks(request) {
        var set = heldLockSet();
        var heldIndex = findIndex(set, function (lock) {
            return lock.uuid === request.uuid;
        });
        if (heldIndex === -1) return;

        set.splice(heldIndex, 1);
        var map = requestQueueMap();
        var queue = map[request.name] || [];
        var first = queue[0];
        var rest = queue.slice(1);

        if (first) {
            if (first.mode === MODE_EXCLUSIVE || rest.length === 0) {
                set.push(first);
                map[request.name] = rest;
            } else if (first.mode === MODE_SHARED) {
                var nonShared = findIndex(queue, function (lock) {
                    return lock.mode !== MODE_SHARED;
                });
                if (nonShared === -1) nonShared = queue.length;
                set = set.concat(queue.splice(0, nonShared));
                map[request.name] = queue;
            }
            storeHeldAndQueue(set, map);
            return first;
        }

        storeHeldLockSet(set);
    }

    function handleHeldLockBeSteal(request) {
        request.reject(makeDOMException(
            "Lock broken by another request with the 'steal' option."
        ));
    }

    function handleNewHeldLock(request, grant, currentHeld) {
        pushToHeld(request, currentHeld);

        setTimeout(function () {
            if (request.closeSignal) request.closeSignal();

            if (request.signal && request.signal.aborted) {
                updateHeldAndRequestLocks(request);
                request.reject(getAbortError(request.signal));
                return;
            }

            if (!isInHeldLockSet(request.uuid)) {
                handleHeldLockBeSteal(request);
                return;
            }

            var callBackResolved = false;
            var rejectedForSteal = false;
            onStorageChange(KEY_HELD, function () {
                if (!callBackResolved && !rejectedForSteal && !isInHeldLockSet(request.uuid)) {
                    handleHeldLockBeSteal(request);
                    rejectedForSteal = true;
                    return true;
                }
                return false;
            });

            grant(new Lock(SECRET, request.name, request.mode)).then(function () {
                callBackResolved = true;
                updateHeldAndRequestLocks(request);
            });
        }, 0);
    }

    function handleSharedLockFromListener(request) {
        return new Promise(function (resolve) {
            setTimeout(resolve, Math.floor(Math.random() * 1000));
        }).then(function () {
            var others = [];
            var set = heldLockSet();
            for (var i = 0; i < set.length; i++) {
                var lock = set[i];
                if (lock.name === request.name && lock.uuid !== request.uuid && lock.mode === MODE_SHARED) {
                    others.push(lock);
                }
            }
            if (others.length) storeHeldLockSet(others);
            else updateHeldAndRequestLocks(request);
        });
    }

    function handleNewLockRequest(request, grant) {
        pushToQueue(request);
        var heldLockWIP = false;
        onStorageChange(KEY_HELD, function () {
            if (heldLockWIP || !isInHeldLockSet(request.uuid)) return false;
            heldLockWIP = true;
            return Promise.resolve(grant(new Lock(SECRET, request.name, request.mode))).then(function () {
                if (!isInHeldLockSet(request.uuid)) {
                    handleHeldLockBeSteal(request);
                }
                if (request.mode === MODE_EXCLUSIVE) {
                    updateHeldAndRequestLocks(request);
                    return true;
                }
                return handleSharedLockFromListener(request).then(function () {
                    return true;
                });
            });
        });
    }

    function handleHeldLockAndRequest(heldLock, request, grant, queue, set) {
        if (heldLock) {
            if (heldLock.mode === MODE_EXCLUSIVE) {
                handleNewLockRequest(request, grant);
            } else if (heldLock.mode === MODE_SHARED) {
                if (request.mode === MODE_SHARED && queue.length === 0) {
                    handleNewHeldLock(request, grant, set);
                } else {
                    handleNewLockRequest(request, grant);
                }
            }
        } else {
            handleNewHeldLock(request, grant, set);
        }
    }

    function querySnapshot() {
        var pending = [];
        var map = requestQueueMap();
        for (var name in map) {
            if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
            var queue = map[name] || [];
            for (var i = 0; i < queue.length; i++) {
                pending.push(publicLockInfo(queue[i]));
            }
        }
        var held = heldLockSet();
        var publicHeld = [];
        for (var j = 0; j < held.length; j++) {
            publicHeld.push(publicLockInfo(held[j]));
        }
        return { held: publicHeld, pending: pending };
    }

    function cleanRequestLockQueueByClientId(map, clientId) {
        for (var sourceName in map) {
            if (!Object.prototype.hasOwnProperty.call(map, sourceName)) continue;
            var queue = map[sourceName] || [];
            var kept = [];
            for (var i = 0; i < queue.length; i++) {
                if (queue[i].clientId !== clientId) kept.push(queue[i]);
            }
            map[sourceName] = kept;
        }
    }

    function cleanHeldLockSetByClientId(map, clientId) {
        var set = heldLockSet();
        var next = [];
        for (var i = 0; i < set.length; i++) {
            var element = set[i];
            if (element.clientId !== clientId) {
                next.push(element);
                continue;
            }
            var queue = map[element.name] || [];
            var first = queue[0];
            var rest = queue.slice(1);
            if (!first) continue;
            if (first.mode === MODE_EXCLUSIVE || rest.length === 0) {
                next.push(first);
                map[element.name] = rest;
            } else if (first.mode === MODE_SHARED) {
                var nonShared = findIndex(queue, function (lock) {
                    return lock.mode !== MODE_SHARED;
                });
                if (nonShared === -1) nonShared = queue.length;
                next = next.concat(queue.splice(0, nonShared));
                map[element.name] = queue;
            }
        }
        return next;
    }

    function cleanClientLocksByClientId(clientId) {
        var map = requestQueueMap();
        cleanRequestLockQueueByClientId(map, clientId);
        var nextHeld = cleanHeldLockSetByClientId(map, clientId);
        storeHeldAndQueue(nextHeld, map);
    }

    function cleanUnliveClientLocks() {
        var uniqueClientIds = unique(getClientIds());
        if (!uniqueClientIds.length) {
            storeClientIds([]);
            return;
        }
        var alive = [];
        for (var i = 0; i < uniqueClientIds.length; i++) {
            var clientId = uniqueClientIds[i];
            var timeStamp = getStorageItem(clientId);
            if (!timeStamp || Date.now() - Number(timeStamp) > STALE_MS) {
                removeStorageItem(clientId);
                cleanClientLocksByClientId(clientId);
            } else {
                alive.push(clientId);
            }
        }
        if (JSON.stringify(uniqueClientIds) !== JSON.stringify(alive)) {
            storeClientIds(alive);
        }
    }

    LockManager.prototype.request = function () {
        var manager = this;
        var args = arguments;
        return new Promise(function (resolve, reject) {
            var parsed = handleRequestArgs(manager, args, reject);
            if (!parsed) return;

            var request = {
                name: parsed.name,
                mode: parsed.options.mode,
                clientId: manager._clientId,
                uuid: parsed.name + '-' + generateRandomId(),
                resolve: resolve,
                reject: reject,
                signal: parsed.options.signal
            };

            var grant = resolveWithCB(parsed.cb, resolve, reject);
            var set = heldLockSet();
            var heldLock = findHeldLock(set, request.name);
            var queue = requestQueueMap()[request.name] || [];

            if (parsed.options.steal === true) {
                var filtered = [];
                for (var i = 0; i < set.length; i++) {
                    if (set[i].name !== request.name) filtered.push(set[i]);
                }
                set = filtered;
                storeHeldLockSet(set);
                heldLock = findHeldLock(set, request.name);
            } else if (parsed.options.ifAvailable === true) {
                var blocked = heldLock && !(
                    heldLock.mode === MODE_SHARED && request.mode === MODE_SHARED
                );
                if (blocked || queue.length) {
                    grant(null);
                    return;
                }
                handleNewHeldLock(request, grant, set);
                return;
            } else if (parsed.options.signal !== undefined) {
                if (!handleSignal(parsed.options, reject, request)) return;
            }

            handleHeldLockAndRequest(heldLock, request, grant, queue, set);
        });
    };

    LockManager.prototype.query = function () {
        return Promise.resolve(querySnapshot());
    };

    var manager = new LockManager(SECRET);
    try {
        Object.defineProperty(navigator, 'locks', {
            value: manager,
            configurable: true,
            enumerable: true,
            writable: false
        });
    } catch (err) {
        navigator.locks = manager;
    }

    global.LockManager = LockManager;
    global.Lock = Lock;
    if (typeof global.__pfBindGlobal === 'function') {
        global.__pfBindGlobal('LockManager');
        global.__pfBindGlobal('Lock');
    }
})(typeof window !== 'undefined' ? window : self);
