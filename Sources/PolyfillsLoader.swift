import Foundation
import WebKit

/// Loads the PoomSmart/Polyfills script tree out of the app bundle and injects
/// it into a WKWebView.
///
/// Swift port of `PolyfillsLoader.m` from mgefimov/claude-legacy-ios (MIT).
///
/// Layout inside the bundle:
///
///     Polyfills/
///       scripts-priority/   loaded first, at document start
///       scripts/            document start
///       scripts-post/       document end
///
/// Each of those contains loose `*.js` files (always loaded) plus directories
/// named after an iOS version, e.g. `16.4/`. A version directory is loaded only
/// when the device is OLDER than that version — on iOS 15.8 the `16.0`, `16.4`,
/// `17.x`, `18.x` and later folders apply, while `15.4` is skipped because the
/// device already has those APIs natively.
enum PolyfillsLoader {

    private static func deviceIsAtLeast(_ major: Int, _ minor: Int) -> Bool {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        if v.majorVersion > major { return true }
        if v.majorVersion == major && v.minorVersion >= minor { return true }
        return false
    }

    /// Concatenate every `*.js` directly inside `dir`, sorted for stable order.
    private static func js(inDirectory dir: String) -> String {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return "" }
        var out = ""
        for name in names.filter({ $0.hasSuffix(".js") }).sorted() {
            let path = (dir as NSString).appendingPathComponent(name)
            guard let body = try? String(contentsOfFile: path, encoding: .utf8) else { continue }

            // This one polyfill needs a value only the native side knows.
            if name == "Navigator.hardwareConcurrency.js" {
                let cores = ProcessInfo.processInfo.processorCount
                let clamped = cores <= 2 ? 2 : (cores <= 4 ? 4 : (cores <= 6 ? 6 : 8))
                out += "window.__injectedHardwareConcurrency__ = \(clamped);\n"
            }
            out += body
            out += "\n"
        }
        return out
    }

    /// Loose files in `base`, then every version directory newer than the device,
    /// in ascending order so later polyfills can build on earlier ones.
    private static func scripts(fromBase base: String) -> String {
        let fm = FileManager.default
        var out = js(inDirectory: base)

        guard let items = try? fm.contentsOfDirectory(atPath: base) else { return out }

        var versions: [(Int, Int, String)] = []
        for item in items {
            var isDir: ObjCBool = false
            let p = (base as NSString).appendingPathComponent(item)
            guard fm.fileExists(atPath: p, isDirectory: &isDir), isDir.boolValue else { continue }
            let parts = item.split(separator: ".")
            guard parts.count == 2,
                  let maj = Int(parts[0]),
                  let min = Int(parts[1]) else { continue }
            versions.append((maj, min, item))
        }

        versions.sort { a, b in a.0 != b.0 ? a.0 < b.0 : a.1 < b.1 }

        for (maj, min, name) in versions {
            // Device already has these APIs natively -> skip.
            if deviceIsAtLeast(maj, min) { continue }
            out += js(inDirectory: (base as NSString).appendingPathComponent(name))
            out += "\n"
        }
        return out
    }

    /// Inject the polyfill tree. Safe to call when the folder is absent.
    static func inject(into controller: WKUserContentController) {
        guard let root = Bundle.main.path(forResource: "Polyfills", ofType: nil) else {
            NSLog("PolyfillsLoader: Polyfills/ not found in bundle")
            return
        }

        var atStart = ""
        for sub in ["scripts-priority", "scripts"] {
            let body = scripts(fromBase: (root as NSString).appendingPathComponent(sub))
            if !body.isEmpty { atStart += body + "\n" }
        }
        let atEnd = scripts(fromBase: (root as NSString).appendingPathComponent("scripts-post"))

        if !atStart.isEmpty {
            controller.addUserScript(WKUserScript(source: atStart,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: false))
            NSLog("PolyfillsLoader: start scripts %d chars", atStart.count)
        }
        if !atEnd.isEmpty {
            controller.addUserScript(WKUserScript(source: atEnd,
                                                  injectionTime: .atDocumentEnd,
                                                  forMainFrameOnly: false))
            NSLog("PolyfillsLoader: end scripts %d chars", atEnd.count)
        }
    }

    /// Read a single bundled resource such as `legacy-transpiler.js`.
    static func resource(named name: String) -> String? {
        guard let p = Bundle.main.path(forResource: name, ofType: "js"),
              let s = try? String(contentsOfFile: p, encoding: .utf8) else {
            NSLog("PolyfillsLoader: missing resource %@.js", name)
            return nil
        }
        return s
    }
}
