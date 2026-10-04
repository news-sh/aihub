// https://github.com/nguyenj/fullscreen-polyfill + GPT-5
(function () {
    "use strict";

    const spec = [
        "fullscreen",
        "fullscreenEnabled",
        "fullscreenElement",
        "fullscreenchange",
        "fullscreenerror",
        "exitFullscreen",
        "requestFullscreen",
    ];

    const webkit = [
        "webkitIsFullScreen",
        "webkitFullscreenEnabled",
        "webkitFullscreenElement",
        "webkitfullscreenchange",
        "webkitfullscreenerror",
        "webkitExitFullscreen",
        "webkitRequestFullscreen",
    ];

    // Get the vendor fullscreen prefixed api
    // Be defensive: in disallowed iframes (Permissions Policy), even reading
    // certain fullscreen properties can throw. Avoid direct reads during detection.
    const fsVendorKeywords = (function getFullscreenApi() {
        try {
            const fullscreenEnabledKey = [spec[1], webkit[1]].find(
                (prefix) => prefix && prefix in document
            );
            return (
                [spec, webkit].find((vendor) => vendor[1] === fullscreenEnabledKey) || []
            );
        } catch (e) {
            // If detection triggers due to restrictive Permissions Policy, disable polyfill.
            return [];
        }
    })();

    function handleEvent(eventType) {
        try {
            document.dispatchEvent(new Event(eventType));
        } catch (e) {
            console.warn("Fullscreen event handling failed:", e);
        }
    }

    function setupShim() {
        // Don't setup if we don't have valid vendor keywords
        if (!fsVendorKeywords.length) {
            return;
        }

        try {
            // Define lazy getters to avoid triggering policy checks during setup
            if (!(spec[0] in document)) {
                Object.defineProperty(document, spec[0], {
                    configurable: true,
                    enumerable: true,
                    get() {
                        try {
                            return (
                                (fsVendorKeywords[0] &&
                                    document[fsVendorKeywords[0]]) ||
                                (fsVendorKeywords[2] &&
                                    !!document[fsVendorKeywords[2]]) ||
                                false
                            );
                        } catch (_) {
                            return false;
                        }
                    },
                });
            }

            if (!(spec[1] in document)) {
                Object.defineProperty(document, spec[1], {
                    configurable: true,
                    enumerable: true,
                    get() {
                        try {
                            return !!(
                                fsVendorKeywords[1] &&
                                document[fsVendorKeywords[1]]
                            );
                        } catch (_) {
                            return false;
                        }
                    },
                });
            }

            if (!(spec[2] in document)) {
                Object.defineProperty(document, spec[2], {
                    configurable: true,
                    enumerable: true,
                    get() {
                        try {
                            return fsVendorKeywords[2]
                                ? document[fsVendorKeywords[2]] || null
                                : null;
                        } catch (_) {
                            return null;
                        }
                    },
                });
            }

            // onfullscreenchange
            if (fsVendorKeywords[3]) {
                document.addEventListener(
                    fsVendorKeywords[3],
                    handleEvent.bind(document, spec[3]),
                    false
                );
            }

            // onfullscreenerror
            if (fsVendorKeywords[4]) {
                document.addEventListener(
                    fsVendorKeywords[4],
                    handleEvent.bind(document, spec[4]),
                    false
                );
            }

            // exitFullscreen (normalize to Promise) - define without probing vendor at setup time
            if (!(spec[5] in document)) {
                document[spec[5]] = function () {
                    try {
                        const fn =
                            fsVendorKeywords[5] &&
                            document[fsVendorKeywords[5]];
                        if (typeof fn === "function") {
                            const ret = fn.call(document);
                            return ret && typeof ret.then === "function"
                                ? ret
                                : Promise.resolve();
                        }
                        return Promise.reject(
                            new DOMException(
                                "Fullscreen API not available",
                                "NotSupportedError"
                            )
                        );
                    } catch (e) {
                        const err =
                            e instanceof DOMException
                                ? e
                                : new DOMException(
                                      e && e.message
                                          ? e.message
                                          : "Failed to exit fullscreen",
                                      "NotAllowedError"
                                  );
                        return Promise.reject(err);
                    }
                };
            }

            // requestFullscreen (normalize to Promise)
            if (Element.prototype && fsVendorKeywords[6] && !(spec[6] in Element.prototype)) {
                Element.prototype[spec[6]] = function () {
                    if (typeof this[fsVendorKeywords[6]] === "function") {
                        try {
                            const ret = this[fsVendorKeywords[6]].apply(
                                this,
                                arguments
                            );
                            return ret && typeof ret.then === "function"
                                ? ret
                                : Promise.resolve();
                        } catch (e) {
                            const err =
                                e instanceof DOMException
                                    ? e
                                    : new DOMException(
                                          e && e.message
                                              ? e.message
                                              : "Failed to enter fullscreen",
                                          "NotAllowedError"
                                      );
                            return Promise.reject(err);
                        }
                    }
                    return Promise.reject(
                        new DOMException(
                            "Fullscreen API not available",
                            "NotSupportedError"
                        )
                    );
                };
            }
        } catch (e) {
            console.warn("Fullscreen polyfill setup failed:", e);
        }
    }

    // Don't polyfill if it already exists
    function initPolyfill() {
        let shouldSetup = false;
        try {
            shouldSetup =
                typeof document[spec[1]] === "undefined" &&
                fsVendorKeywords.length > 0;
        } catch (e) {
            // If even checking throws (very restrictive env), do not setup.
            shouldSetup = false;
        }

        if (shouldSetup) {
            setupShim();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initPolyfill);
    } else {
        initPolyfill();
    }
})();
