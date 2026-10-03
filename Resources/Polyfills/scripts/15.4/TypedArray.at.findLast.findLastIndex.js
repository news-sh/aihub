(function () {
    if (typeof Uint8Array !== 'function') return;

    var NAMES = [
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
        'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
        'Float32Array', 'Float64Array'
    ];

    function typedArrayTargets() {
        var proto = Object.getPrototypeOf(Uint8Array.prototype);
        if (proto && proto !== Object.prototype) return [proto];
        var targets = [];
        var i, Ctor;
        for (i = 0; i < NAMES.length; i++) {
            Ctor = this[NAMES[i]];
            if (typeof Ctor === 'function' && Ctor.prototype) targets.push(Ctor.prototype);
        }
        return targets;
    }

    function requireTypedArray(value, method) {
        if (
            value == null ||
            typeof ArrayBuffer !== 'function' ||
            typeof ArrayBuffer.isView !== 'function' ||
            !ArrayBuffer.isView(value) ||
            Object.prototype.toString.call(value) === '[object DataView]'
        ) {
            throw new TypeError('TypedArray.prototype.' + method + ' called on incompatible receiver');
        }
        return value;
    }

    function toIntegerOrInfinity(value) {
        var n = Number(value);
        if (n !== n || n === 0) return 0;
        if (n === Infinity || n === -Infinity) return n;
        return (n < 0 ? -1 : 1) * Math.floor(Math.abs(n));
    }

    function define(proto, name, fn) {
        if (typeof proto[name] === 'function') return;
        Object.defineProperty(proto, name, {
            value: fn,
            writable: true,
            configurable: true
        });
    }

    var root = typeof window !== 'undefined' ? window : this;
    var targets = typedArrayTargets.call(root);
    var t;
    for (t = 0; t < targets.length; t++) {
        define(targets[t], 'at', function (index) {
            var array = requireTypedArray(this, 'at');
            var len = array.length;
            var relativeIndex = toIntegerOrInfinity(index);
            var k = relativeIndex >= 0 ? relativeIndex : len + relativeIndex;
            if (k < 0 || k >= len) return undefined;
            return array[k];
        });
        define(targets[t], 'findLast', function (callback, thisArg) {
            var array = requireTypedArray(this, 'findLast');
            if (typeof callback !== 'function') {
                throw new TypeError('callback must be a function');
            }
            var i, value;
            for (i = array.length - 1; i >= 0; i--) {
                value = array[i];
                if (callback.call(thisArg, value, i, array)) return value;
            }
            return undefined;
        });
        define(targets[t], 'findLastIndex', function (callback, thisArg) {
            var array = requireTypedArray(this, 'findLastIndex');
            if (typeof callback !== 'function') {
                throw new TypeError('callback must be a function');
            }
            var i;
            for (i = array.length - 1; i >= 0; i--) {
                if (callback.call(thisArg, array[i], i, array)) return i;
            }
            return -1;
        });
    }
})();
