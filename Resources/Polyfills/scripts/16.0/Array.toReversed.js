(function () {
if (!Array.prototype.toReversed) {
    Object.defineProperty(Array.prototype, 'toReversed', {
        value: function () {
            for (var i = (this.length - 1), arr = []; i >= 0; --i) {
                arr.push(this[i]);
            }
            return arr;
        },
        writable: true,
        configurable: true
    });
}
})();
