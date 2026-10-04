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

    function copyOf(array) {
        var Ctor = array.constructor;
        var len = array.length;
        var out = new Ctor(len);
        var i;
        for (i = 0; i < len; i++) out[i] = array[i];
        return out;
    }

    function defaultCompare(a, b) {
        if (a !== a && b !== b) return 0;
        if (a !== a) return 1;
        if (b !== b) return -1;
        if (a < b) return -1;
        if (a > b) return 1;
        if (a === 0 && b === 0) {
            var aNeg = 1 / a < 0;
            var bNeg = 1 / b < 0;
            if (aNeg && !bNeg) return -1;
            if (!aNeg && bNeg) return 1;
        }
        return 0;
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
        define(targets[t], 'toReversed', function () {
            var array = requireTypedArray(this, 'toReversed');
            var len = array.length;
            var out = new array.constructor(len);
            var i;
            for (i = 0; i < len; i++) out[i] = array[len - 1 - i];
            return out;
        });
        define(targets[t], 'toSorted', function (compareFn) {
            var array = requireTypedArray(this, 'toSorted');
            if (compareFn !== undefined && typeof compareFn !== 'function') {
                throw new TypeError('compareFn must be a function');
            }
            var len = array.length;
            var items = [];
            var i;
            for (i = 0; i < len; i++) items[i] = array[i];
            items.sort(compareFn || defaultCompare);
            var out = new array.constructor(len);
            for (i = 0; i < len; i++) out[i] = items[i];
            return out;
        });
        define(targets[t], 'with', function (index, value) {
            var array = requireTypedArray(this, 'with');
            var len = array.length;
            var relativeIndex = toIntegerOrInfinity(index);
            var actualIndex = relativeIndex >= 0 ? relativeIndex : len + relativeIndex;
            if (actualIndex < 0 || actualIndex >= len) {
                throw new RangeError('Invalid index : ' + index);
            }
            var out = copyOf(array);
            out[actualIndex] = value;
            return out;
        });
    }
})();
