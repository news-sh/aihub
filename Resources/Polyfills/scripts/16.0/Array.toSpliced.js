(function () {
// Claude
if (!Array.prototype.toSpliced) {
    Object.defineProperty(Array.prototype, 'toSpliced', {
        value: function (start, deleteCount, ...items) {
            // Convert to object to handle array-like objects
            const O = Object(this);

            // Get the length property and convert to integer
            const len = Math.max(0, Math.floor(O.length) || 0);

            // Handle start parameter
            let actualStart;
            if (start === undefined) {
                actualStart = 0;
            } else {
                const integerStart = Math.floor(start);
                if (integerStart < 0) {
                    actualStart = Math.max(len + integerStart, 0);
                } else {
                    actualStart = Math.min(integerStart, len);
                }
            }

            // Handle deleteCount parameter
            let actualDeleteCount;
            if (deleteCount === undefined) {
                actualDeleteCount = len - actualStart;
            } else {
                const integerDeleteCount = Math.floor(deleteCount);
                actualDeleteCount = Math.max(0, Math.min(integerDeleteCount, len - actualStart));
            }

            // Create new array
            const result = [];
            let resultIndex = 0;

            // Copy elements before the start index
            for (let i = 0; i < actualStart; i++) {
                if (i in O) {
                    result[resultIndex] = O[i];
                }
                resultIndex++;
            }

            // Insert new items
            for (let i = 0; i < items.length; i++) {
                result[resultIndex] = items[i];
                resultIndex++;
            }

            // Copy elements after the deleted section
            const endIndex = actualStart + actualDeleteCount;
            for (let i = endIndex; i < len; i++) {
                if (i in O) {
                    result[resultIndex] = O[i];
                }
                resultIndex++;
            }

            // Set the length of the result array
            result.length = resultIndex;

            return result;
        },
        writable: true,
        configurable: true,
        enumerable: false
    });
}
})();
