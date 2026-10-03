(function () {
// Claude
if (!Array.prototype.toSorted) {
    Object.defineProperty(Array.prototype, 'toSorted', {
        value: function (compareFn) {
            // Convert to object to handle sparse arrays and non-array objects
            const O = Object(this);

            // Get the length property
            const len = parseInt(O.length) || 0;

            // Create a new array from the current array
            const items = [];
            for (let i = 0; i < len; i++) {
                if (i in O) {
                    items[i] = O[i];
                }
            }

            // Sort the new array with the provided compareFn
            if (compareFn !== undefined) {
                // Validate that compareFn is callable
                if (typeof compareFn !== 'function') {
                    throw new TypeError('Comparefn must be a function');
                }
                return items.sort(compareFn);
            } else {
                return items.sort();
            }
        },
        writable: true,
        configurable: true
    });
}
})();
