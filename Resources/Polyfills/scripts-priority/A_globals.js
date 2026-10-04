// iOS 8 WebKit can set window.X without creating a global identifier.
// Indirect eval is the reliable way to bind the name for page scripts.
(function (global) {
    function bindGlobal(name) {
        try {
            if (global[name] == null) return;
            (0, eval)('var ' + name + ' = window["' + name + '"]');
        } catch (e) {}
    }
    global.__pfBindGlobal = bindGlobal;
    bindGlobal('performance');
})(window);
