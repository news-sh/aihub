(function () {
    function defineCollectionMethod(Ctor, name, fn) {
        if (typeof Ctor === 'undefined' || typeof Ctor.prototype[name] === 'function') return;
        Object.defineProperty(Ctor.prototype, name, {
            value: fn,
            writable: true,
            configurable: true
        });
    }

    function getOrInsert(key, value) {
        if (this.has(key)) return this.get(key);
        this.set(key, value);
        return value;
    }

    function getOrInsertComputed(key, callback) {
        if (typeof callback !== 'function') throw new TypeError('Expected a function');
        if (this.has(key)) return this.get(key);
        var value = callback(key);
        this.set(key, value);
        return value;
    }

    defineCollectionMethod(typeof Map !== 'undefined' ? Map : undefined, 'getOrInsert', getOrInsert);
    defineCollectionMethod(typeof Map !== 'undefined' ? Map : undefined, 'getOrInsertComputed', getOrInsertComputed);
    defineCollectionMethod(typeof WeakMap !== 'undefined' ? WeakMap : undefined, 'getOrInsert', getOrInsert);
    defineCollectionMethod(typeof WeakMap !== 'undefined' ? WeakMap : undefined, 'getOrInsertComputed', getOrInsertComputed);
})();
