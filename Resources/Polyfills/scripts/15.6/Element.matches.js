(function () {
    var proto = Element.prototype;
    var nativeMatches = proto.matches || proto.webkitMatchesSelector;
    if (!nativeMatches || proto._originalMatches) {
        return;
    }
    proto._originalMatches = nativeMatches;
    proto.matches = function (selector) {
        var modifiedSelector = selector.replace(/:modal/g, '.modal');
        return proto._originalMatches.call(this, modifiedSelector);
    };
})();
