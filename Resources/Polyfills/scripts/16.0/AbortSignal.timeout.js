(function () {
// https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
if (
    typeof AbortController !== 'undefined' &&
    typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout !== 'function'
) {
    AbortSignal.timeout = function timeout(ms) {
        var controller = new AbortController();
        setTimeout(function () {
            var err;
            try {
                err = new DOMException('The operation timed out.', 'TimeoutError');
            } catch (_) {
                err = new Error('The operation timed out.');
                err.name = 'TimeoutError';
            }
            controller.abort(err);
        }, ms);
        return controller.signal;
    };
}
})();
