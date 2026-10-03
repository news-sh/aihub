(function () {
// Claude
if (!Array.prototype.with) {
    Object.defineProperty(Array.prototype, 'with', {
        value: function (index, value) {
            // Convert to object to handle array-like objects
            const O = Object(this);

            // Get the length property and convert to integer
            const len = Math.max(0, Math.floor(O.length) || 0);

            // Convert index to integer
            const relativeIndex = Math.floor(index);

            // Calculate actual index (handle negative indices)
            let actualIndex;
            if (relativeIndex < 0) {
                actualIndex = len + relativeIndex;
            } else {
                actualIndex = relativeIndex;
            }

            // Check if index is out of bounds
            if (actualIndex < 0 || actualIndex >= len) {
                throw new RangeError('Invalid index : ' + index);
            }

            // Create new array by copying all elements
            const result = [];
            for (let i = 0; i < len; i++) {
                if (i === actualIndex) {
                    result[i] = value;
                } else if (i in O) {
                    result[i] = O[i];
                }
                // Note: sparse arrays will have holes preserved except at the target index
            }

            // Ensure the result has the correct length
            result.length = len;

            return result;
        },
        writable: true,
        configurable: true,
        enumerable: false
    });
}
})();
