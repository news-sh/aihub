(function () {
if (!String.prototype.at) {
    Object.defineProperty(String.prototype, 'at', {
        value: function (index) {
            if (this == null) {
                throw new TypeError('String.prototype.at called on null or undefined');
            }
            var str = String(this);
            var len = str.length;
            var relativeIndex = Number(index);
            if (relativeIndex !== relativeIndex || relativeIndex === 0) {
                relativeIndex = 0;
            } else if (relativeIndex !== Infinity && relativeIndex !== -Infinity) {
                relativeIndex = (relativeIndex < 0 ? -1 : 1) * Math.floor(Math.abs(relativeIndex));
            }
            var k = relativeIndex >= 0 ? relativeIndex : len + relativeIndex;
            if (k < 0 || k >= len) return undefined;
            return str.charAt(k);
        },
        writable: true,
        configurable: true
    });
}
})();
