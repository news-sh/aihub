(function () {
// https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static
if (
    typeof AbortController !== 'undefined' &&
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.any !== 'function'
) {
    AbortSignal.any = function any(signals) {
        var controller = new AbortController();
        var list = Array.from(signals);
        function onAbort() {
            controller.abort(this.reason);
            cleanup();
        }
        function cleanup() {
            for (var i = 0; i < list.length; i++) {
                list[i].removeEventListener('abort', onAbort);
            }
        }
        for (var i = 0; i < list.length; i++) {
            var signal = list[i];
            if (signal.aborted) {
                controller.abort(signal.reason);
                return controller.signal;
            }
            signal.addEventListener('abort', onAbort);
        }
        return controller.signal;
    };
}
})();
