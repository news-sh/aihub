import UIKit
import WebKit

/// Hosts one assistant's website.
///
/// GPU notes: WKWebView composites through Core Animation and renders with
/// Metal on every device this app supports, so there is no switch to "turn
/// on" the GPU -- it is already the default path. What actually costs frames
/// on an older device is the work we pile on top of it, so this controller
/// removes that work instead of pretending to flip a flag:
///
///   * isOpaque = true and a matching background, so the compositor never
///     blends the whole web layer against what is behind it.
///   * drawsAsynchronously on the scroll layer, moving rasterisation off the
///     main thread.
///   * A shared WKProcessPool, so switching assistants reuses one warm
///     content process instead of spawning a cold one each time.
///   * suppressesIncrementalRendering = false, so frames paint as they
///     arrive rather than waiting for a complete layout.
///   * "Fast mode" (on by default) neutralises the long CSS animations and
///     transitions these chat UIs use, which is the single biggest win on an
///     A9-class device.
final class AIWebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate,
                                 WKScriptMessageHandler {

    private let service: AIService

    /// Shown only for transpiled services. Rewriting ~6 MB of chunks takes
    /// real time on an A9, and a blank screen reads as a crash, so name the
    /// file being processed instead of showing nothing.
    private var loadingOverlay: UIView?
    private var loadingLabel: UILabel?
    private var webView: WKWebView!
    private var toolbar: UIView!
    private var progress: UIProgressView!
    private var titleLabel: UILabel!
    private var backBtn: UIButton!
    private var fwdBtn: UIButton!
    /// Solid block behind the status bar so the page never shows through
    /// next to the clock.
    private let statusBG = UIView()
    /// JS errors reported by the page, newest last. Surfaced via the ... menu.
    private var pageErrors: [String] = []
    private var progressObs: NSKeyValueObservation?
    private var titleObs: NSKeyValueObservation?

    private let toolbarHeight: CGFloat = 50

    /// One content process shared by every assistant in this app.
    private static let sharedPool = WKProcessPool()

    /// Claims Safari 15.6 on purpose. The engine underneath really is
    /// WebKit 605 / Safari 15.x, and advertising 16.x made sites serve
    /// bundles targeting features this device does not have.
    private static let desktopUA =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15"

    private var desktopMode: Bool {
        get {
            let k = "AIHubDesktop_" + service.id
            if UserDefaults.standard.object(forKey: k) == nil {
                return service.prefersDesktop
            }
            return UserDefaults.standard.bool(forKey: k)
        }
        set { UserDefaults.standard.set(newValue, forKey: "AIHubDesktop_" + service.id) }
    }

    private var fastMode: Bool {
        get {
            if UserDefaults.standard.object(forKey: "AIHubFastMode") == nil { return true }
            return UserDefaults.standard.bool(forKey: "AIHubFastMode")
        }
        set { UserDefaults.standard.set(newValue, forKey: "AIHubFastMode") }
    }

    init(service: AIService, forceDesktop: Bool?) {
        self.service = service
        super.init(nibName: nil, bundle: nil)
        if let f = forceDesktop { self.desktopMode = f }
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    deinit {
        progressObs?.invalidate()
        titleObs?.invalidate()
        // The content controller retains its handlers; without this the
        // controller and its web view never deallocate.
        let ucc = webView?.configuration.userContentController
        ucc?.removeScriptMessageHandler(forName: "aierr")
        if service.needsTranspiler {
            ucc?.removeScriptMessageHandler(forName: "patchScript")
            ucc?.removeScriptMessageHandler(forName: "loadingStatus")
        }
    }

    // MARK: - Setup

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.04, alpha: 1)
        buildWebView()
        buildToolbar()
        if service.needsTranspiler {
            showLoadingOverlay()
            // Safety net: never strand the user behind the overlay if the
            // "ready" message is lost. 3 minutes is generous for an A9.
            DispatchQueue.main.asyncAfter(deadline: .now() + 180) { [weak self] in
                self?.hideLoadingOverlay()
            }
        }
        load()
    }

    private func buildWebView() {
        let cfg = WKWebViewConfiguration()
        cfg.processPool = AIWebViewController.sharedPool
        // Persistent store: stay logged in between launches.
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.suppressesIncrementalRendering = false

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        cfg.defaultWebpagePreferences = prefs

        // Must run at documentStart and in every frame: a missing built-in
        // throws while the framework bundle is still initialising, long
        // before documentEnd.
        cfg.userContentController.addUserScript(
            WKUserScript(source: Compat.js,
                         injectionTime: .atDocumentStart,
                         forMainFrameOnly: false))
        cfg.userContentController.add(self, name: "aierr")

        // ---- Runtime transpiler ----------------------------------------
        // Some sites ship syntax WebKit 605 cannot PARSE (class static blocks,
        // regexp lookbehind - both Safari 16.4+). A parse error happens before
        // any code runs, so Compat.js cannot help. For those services we block
        // the real <script> tags and replay transpiled source instead.
        if service.needsTranspiler {
            PolyfillsLoader.inject(into: cfg.userContentController)

            let v = ProcessInfo.processInfo.operatingSystemVersion
            let cfgJS = """
            window.__aihub = {
              baseURL: "\(service.chunkBaseURL)",
              mode: "\(service.transpilerMode)",
              iosVersion: "\(v.majorVersion).\(v.minorVersion)"
            };
            """
            cfg.userContentController.addUserScript(
                WKUserScript(source: cfgJS,
                             injectionTime: .atDocumentStart,
                             forMainFrameOnly: false))

            // Order matters: config, then the transpiler, then the interceptor.
            for name in ["legacy-transpiler", "patch"] {
                guard let src = PolyfillsLoader.resource(named: name) else { continue }
                cfg.userContentController.addUserScript(
                    WKUserScript(source: src,
                                 injectionTime: .atDocumentStart,
                                 forMainFrameOnly: false))
            }

            cfg.userContentController.add(self, name: "patchScript")
            cfg.userContentController.add(self, name: "loadingStatus")
        }

        if fastMode {
            let css = """
            var s=document.createElement('style');
            s.textContent='*,*::before,*::after{animation-duration:0.01s !important;' +
              'animation-delay:0s !important;transition-duration:0.01s !important;' +
              'transition-delay:0s !important;}';
            (document.head||document.documentElement).appendChild(s);
            """
            cfg.userContentController.addUserScript(
                WKUserScript(source: css,
                             injectionTime: .atDocumentEnd,
                             forMainFrameOnly: true))
        }

        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // Opaque: the compositor can skip blending the page against the app.
        webView.isOpaque = true
        webView.backgroundColor = UIColor(white: 0.04, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(white: 0.04, alpha: 1)
        webView.scrollView.layer.drawsAsynchronously = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        applyUserAgent()
        view.addSubview(webView)

        statusBG.backgroundColor = UIColor(white: 0.04, alpha: 1)
        view.addSubview(statusBG)

        progressObs = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
            guard let self = self else { return }
            let p = Float(wv.estimatedProgress)
            self.progress.setProgress(p, animated: true)
            self.progress.isHidden = (p >= 0.99)
        }
        titleObs = webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
            guard let self = self else { return }
            let t = wv.title ?? ""
            self.titleLabel.text = t.isEmpty ? self.service.name : t
        }
    }

    private func applyUserAgent() {
        webView.customUserAgent = desktopMode ? AIWebViewController.desktopUA : nil
    }

    private func buildToolbar() {
        toolbar = UIView()
        toolbar.backgroundColor = UIColor(white: 0.08, alpha: 1)
        view.addSubview(toolbar)

        let sep = UIView()
        sep.backgroundColor = UIColor(white: 0.22, alpha: 1)
        sep.tag = 55
        toolbar.addSubview(sep)

        progress = UIProgressView(progressViewStyle: .bar)
        progress.progressTintColor = service.tint
        progress.trackTintColor = .clear
        progress.isHidden = true
        view.addSubview(progress)

        func button(_ title: String, _ sel: Selector, _ size: CGFloat) -> UIButton {
            let b = UIButton(type: .system)
            b.setTitle(title, for: .normal)
            b.setTitleColor(.white, for: .normal)
            b.setTitleColor(UIColor(white: 0.3, alpha: 1), for: .disabled)
            b.titleLabel?.font = .systemFont(ofSize: size, weight: .medium)
            b.addTarget(self, action: sel, for: .touchUpInside)
            toolbar.addSubview(b)
            return b
        }

        let home = button("Hub", #selector(closeTapped), 15)
        home.tag = 61
        home.setTitleColor(service.tint, for: .normal)
        home.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)

        backBtn = button("\u{2039}", #selector(goBack), 30)
        backBtn.tag = 62
        fwdBtn = button("\u{203A}", #selector(goForward), 30)
        fwdBtn.tag = 63

        titleLabel = UILabel()
        titleLabel.text = service.name
        titleLabel.textColor = UIColor(white: 0.75, alpha: 1)
        titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.tag = 64
        toolbar.addSubview(titleLabel)

        let more = button("\u{22EF}", #selector(moreTapped), 22)
        more.tag = 65

        refreshNavButtons()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        let topSafe = view.safeAreaInsets.top
        let bottomSafe = view.safeAreaInsets.bottom
        let tbH = toolbarHeight + bottomSafe
        let w = view.bounds.width

        toolbar.frame = CGRect(x: 0, y: view.bounds.height - tbH, width: w, height: tbH)
        toolbar.viewWithTag(55)?.frame = CGRect(x: 0, y: 0, width: w, height: 0.5)

        // Keep the page clear of the status bar. Sites that pin their own
        // header to top:0 (Grok does) otherwise render it underneath the
        // clock and carrier text, which makes the controls unreachable.
        statusBG.frame = CGRect(x: 0, y: 0, width: w, height: topSafe)
        webView.frame = CGRect(x: 0, y: topSafe, width: w,
                               height: max(0, view.bounds.height - tbH - topSafe))
        progress.frame = CGRect(x: 0, y: topSafe, width: w, height: 2)

        toolbar.viewWithTag(61)?.frame = CGRect(x: 8, y: 0, width: 54, height: toolbarHeight)
        toolbar.viewWithTag(62)?.frame = CGRect(x: 66, y: 0, width: 42, height: toolbarHeight)
        toolbar.viewWithTag(63)?.frame = CGRect(x: 110, y: 0, width: 42, height: toolbarHeight)
        toolbar.viewWithTag(65)?.frame = CGRect(x: w - 52, y: 0, width: 44, height: toolbarHeight)
        toolbar.viewWithTag(64)?.frame = CGRect(x: 158, y: 0,
                                                width: max(40, w - 158 - 56),
                                                height: toolbarHeight)
    }

    private func load() {
        guard let url = URL(string: service.url) else { return }
        webView.load(URLRequest(url: url))
    }

    private func refreshNavButtons() {
        backBtn.isEnabled = webView.canGoBack
        fwdBtn.isEnabled = webView.canGoForward
    }

    // MARK: - Actions

    @objc private func closeTapped() { dismiss(animated: true, completion: nil) }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }
    @objc private func goForward() { if webView.canGoForward { webView.goForward() } }

    @objc private func moreTapped() {
        let a = UIAlertController(title: service.name, message: nil,
                                  preferredStyle: .actionSheet)

        a.addAction(UIAlertAction(title: "Reload", style: .default) { _ in
            self.webView.reload()
        })

        let uaTitle = desktopMode ? "Switch to mobile site" : "Switch to desktop site"
        a.addAction(UIAlertAction(title: uaTitle, style: .default) { _ in
            self.desktopMode.toggle()
            self.applyUserAgent()
            self.webView.reload()
        })

        let fastTitle = fastMode ? "Fast mode: ON" : "Fast mode: OFF"
        a.addAction(UIAlertAction(title: fastTitle, style: .default) { _ in
            self.fastMode.toggle()
            let msg = self.fastMode
                ? "Fast mode on. Reopen this assistant to apply."
                : "Fast mode off. Reopen this assistant to apply."
            let t = UIAlertController(title: nil, message: msg, preferredStyle: .alert)
            t.addAction(UIAlertAction(title: "OK", style: .default))
            self.present(t, animated: true)
        })

        a.addAction(UIAlertAction(title: "Home page", style: .default) { _ in
            self.load()
        })

        let errTitle = pageErrors.isEmpty
            ? "Page errors: none" : "Page errors (\(pageErrors.count))"
        a.addAction(UIAlertAction(title: errTitle, style: .default) { _ in
            self.showPageErrors()
        })

        a.addAction(UIAlertAction(title: "Clear this site's data", style: .destructive) { _ in
            self.clearSiteData()
        })

        a.addAction(UIAlertAction(title: "Cancel", style: .cancel))

        // iPad/regular-width safety.
        if let pop = a.popoverPresentationController {
            pop.sourceView = toolbar
            pop.sourceRect = toolbar.viewWithTag(65)?.frame ?? toolbar.bounds
        }
        present(a, animated: true)
    }

    /// Show whatever the page threw, with a copy button. This is the only
    /// way to find out why a specific site misbehaves on this old WebKit.
    private func showPageErrors() {
        let body: String
        if pageErrors.isEmpty {
            body = "No JavaScript errors were reported on this page.\n\n" +
                   "If the site still looks wrong the cause is most likely a " +
                   "CSS feature this WebKit lacks, or a RegExp lookbehind, " +
                   "neither of which can be shimmed."
        } else {
            body = pageErrors.suffix(12).joined(separator: "\n\n")
        }
        let a = UIAlertController(title: "Page errors", message: body,
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Copy", style: .default) { _ in
            UIPasteboard.general.string = self.pageErrors.joined(separator: "\n")
        })
        a.addAction(UIAlertAction(title: "Close", style: .cancel))
        present(a, animated: true)
    }

    private func clearSiteData() {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        WKWebsiteDataStore.default().fetchDataRecords(ofTypes: types) { records in
            guard let host = URL(string: self.service.url)?.host else { return }
            let base = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
            let hits = records.filter { $0.displayName.contains(base) }
            WKWebsiteDataStore.default().removeData(ofTypes: types, for: hits) {
                self.webView.reload()
            }
        }
    }

    // MARK: - Transpiler progress overlay

    private func showLoadingOverlay() {
        guard loadingOverlay == nil, let host = view else { return }
        let bg = UIView()
        bg.backgroundColor = UIColor(white: 0.07, alpha: 1)
        bg.translatesAutoresizingMaskIntoConstraints = false

        let spinner = UIActivityIndicatorView(style: .whiteLarge)
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()

        let title = UILabel()
        title.text = "Rewriting " + service.name + " for iOS 15"
        title.textColor = .white
        title.font = .systemFont(ofSize: 16, weight: .semibold)
        title.textAlignment = .center
        title.numberOfLines = 2
        title.translatesAutoresizingMaskIntoConstraints = false

        let detail = UILabel()
        detail.text = "starting"
        detail.textColor = UIColor(white: 0.6, alpha: 1)
        detail.font = .systemFont(ofSize: 12)
        detail.textAlignment = .center
        detail.numberOfLines = 2
        detail.translatesAutoresizingMaskIntoConstraints = false

        bg.addSubview(spinner); bg.addSubview(title); bg.addSubview(detail)
        host.addSubview(bg)

        NSLayoutConstraint.activate([
            bg.topAnchor.constraint(equalTo: host.topAnchor),
            bg.bottomAnchor.constraint(equalTo: host.bottomAnchor),
            bg.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            spinner.centerXAnchor.constraint(equalTo: bg.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: bg.centerYAnchor, constant: -40),
            title.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 20),
            title.leadingAnchor.constraint(equalTo: bg.leadingAnchor, constant: 24),
            title.trailingAnchor.constraint(equalTo: bg.trailingAnchor, constant: -24),
            detail.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8),
            detail.leadingAnchor.constraint(equalTo: bg.leadingAnchor, constant: 24),
            detail.trailingAnchor.constraint(equalTo: bg.trailingAnchor, constant: -24)
        ])

        loadingOverlay = bg
        loadingLabel = detail
    }

    private func hideLoadingOverlay() {
        guard let o = loadingOverlay else { return }
        UIView.animate(withDuration: 0.25, animations: {
            o.alpha = 0
        }, completion: { _ in
            o.removeFromSuperview()
        })
        loadingOverlay = nil
        loadingLabel = nil
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        switch message.name {
        case "aierr":
            if let text = message.body as? String, pageErrors.count < 40 {
                pageErrors.append(text)
            }

        case "patchScript":
            // Run transpiled source through the HOST, not eval(): these sites
            // send a CSP that forbids eval and inline script, and
            // evaluateJavaScript is not subject to page CSP. That is the whole
            // reason this round-trip exists.
            guard let d = message.body as? [String: Any],
                  let code = d["code"] as? String else { return }
            let file = (d["file"] as? String) ?? "?"
            let ackID = d["id"] as? Int
            // Trailing `null` keeps the completion value serialisable.
            webView?.evaluateJavaScript(code + "\nnull;") { [weak self] _, err in
                if let err = err {
                    let msg = "transpiled \(file): \(err.localizedDescription)"
                    if (self?.pageErrors.count ?? 99) < 40 { self?.pageErrors.append(msg) }
                }
                // Release the queue even on failure, or classic mode deadlocks.
                if let id = ackID {
                    var arg = "null"
                    if let err = err {
                        let q = "\""
                        let clean = err.localizedDescription
                            .replacingOccurrences(of: q, with: "'")
                            .replacingOccurrences(of: "\n", with: " ")
                        arg = q + clean + q
                    }
                    let js = "window.__aihubAck && window.__aihubAck("
                        + String(id) + ", " + arg + ");null;"
                    self?.webView?.evaluateJavaScript(js)
                }
            }

        case "loadingStatus":
            guard let d = message.body as? [String: Any],
                  let stage = d["stage"] as? String else { return }
            switch stage {
            case "boot":
                loadingLabel?.text = "loading engine"
            case "download":
                loadingLabel?.text = (d["file"] as? String) ?? "loading"
            case "ready":
                hideLoadingOverlay()
            case "error":
                if let m = d["message"] as? String {
                    if pageErrors.count < 40 { pageErrors.append("patch: " + m) }
                    if (d["fatal"] as? Bool) == true {
                        loadingLabel?.text = "failed: " + m
                    }
                }
            default:
                break
            }

        default:
            break
        }
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshNavButtons()
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        refreshNavButtons()
        pageErrors.removeAll()
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!,
                 withError error: Error) {
        showError(error)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        showError(error)
    }

    private func showError(_ error: Error) {
        let ns = error as NSError
        // -999 is "cancelled", which happens on every redirect; ignore it.
        if ns.code == NSURLErrorCancelled { return }
        let a = UIAlertController(title: "Could not load",
                                  message: ns.localizedDescription,
                                  preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Retry", style: .default) { _ in
            self.webView.reload()
        })
        a.addAction(UIAlertAction(title: "Back to Hub", style: .cancel) { _ in
            self.dismiss(animated: true, completion: nil)
        })
        present(a, animated: true)
    }

    // MARK: - WKUIDelegate

    /// Keep target="_blank" links inside this web view instead of dropping them.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak a] _ in
            completionHandler(a?.textFields?.first?.text)
        })
        present(a, animated: true)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .allButUpsideDown
    }
}
