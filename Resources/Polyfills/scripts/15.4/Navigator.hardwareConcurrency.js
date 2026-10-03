(function () {
    const value =
        typeof window !== "undefined" &&
        typeof window.__injectedHardwareConcurrency__ === "number"
            ? window.__injectedHardwareConcurrency__
            : 4; // fallback default

    function defineHardwareConcurrency(target) {
        if (
            target &&
            target.navigator &&
            typeof target.navigator.hardwareConcurrency !== "number"
        ) {
            Object.defineProperty(target.navigator, "hardwareConcurrency", {
                value,
                configurable: true,
                enumerable: true,
                writable: false,
            });
        }
    }

    // Main thread
    if (typeof window !== "undefined") defineHardwareConcurrency(window);

    // Worker thread
    if (typeof self !== "undefined" && self !== window)
        defineHardwareConcurrency(self);

    // Fallback for WorkerNavigator prototype (optional)
    if (typeof WorkerNavigator !== "undefined") {
        if (!("hardwareConcurrency" in WorkerNavigator.prototype)) {
            Object.defineProperty(
                WorkerNavigator.prototype,
                "hardwareConcurrency",
                {
                    value,
                    configurable: true,
                    enumerable: true,
                    writable: false,
                }
            );
        }
    }
})();
