import UIKit

/// One assistant the hub can open.
struct AIService {
    let id: String
    let name: String
    let subtitle: String
    let url: String
    let tint: UIColor
    let glyph: String
    /// Some of these sites serve a much better layout to a desktop browser.
    let prefersDesktop: Bool

    /// True when the site ships syntax WebKit 605 cannot parse and therefore
    /// needs the runtime transpiler (Polyfills + legacy-transpiler + patch.js).
    /// Leave false where the site already runs: the transpiler costs a lot of
    /// CPU on an A9 and must not be paid for nothing.
    let needsTranspiler: Bool

    /// Origin prefix the chunk interceptor matches against. Only scripts whose
    /// src starts with this are blocked and replayed.
    let chunkBaseURL: String

    /// "esm"     - one entry module pulls the graph (claude.ai)
    /// "classic" - many independent webpack chunks (Next.js: grok, arena)
    let transpilerMode: String
}

enum AICatalog {
    /// Only services that actually RUN on the iOS 15.8 / WebKit 605 engine.
    ///
    /// Grok, Claude and arena.ai were removed in v7. They are not merely
    /// slow or ugly here, they cannot execute at all: their bundles contain
    /// syntax this engine rejects while parsing, before any code runs, so
    /// no polyfill can help.
    ///   - Grok   : class static block  `class Z{static{...}}`  (Safari 16.4+)
    ///   - Arena  : same, `Unexpected token '{'`
    ///   - Claude : one static block plus 27 regexp lookbehinds `(?<=`
    ///              (Safari 16.4+) spread over 4 core chunks. A single bad
    ///              chunk fails the whole ES module graph.
    /// Safari on this device fails on them identically. Verified against the
    /// live bundles, not assumed.
    static let all: [AIService] = [
        AIService(id: "chatgpt",
                  name: "ChatGPT",
                  subtitle: "OpenAI",
                  url: "https://chatgpt.com/",
                  tint: UIColor(red: 0.06, green: 0.64, blue: 0.50, alpha: 1),
                  glyph: "C",
                  prefersDesktop: false,
                  needsTranspiler: false,
                  chunkBaseURL: "",
                  transpilerMode: ""),
        AIService(id: "gemini",
                  name: "Gemini",
                  subtitle: "Google",
                  url: "https://gemini.google.com/app",
                  tint: UIColor(red: 0.26, green: 0.52, blue: 0.96, alpha: 1),
                  glyph: "G",
                  prefersDesktop: false,
                  needsTranspiler: false,
                  chunkBaseURL: "",
                  transpilerMode: ""),
        // ---- transpiled services -------------------------------------
        // Verified against the live bundles: Claude's 22-chunk graph loses
        // 1 static block and all 27 lookbehinds; Grok's chunks lose their
        // static block. Claude is the proven path (the transpiler was built
        // for it). Grok and Arena are webpack, which is less certain.
        AIService(id: "claude",
                  name: "Claude",
                  subtitle: "Anthropic",
                  url: "https://claude.ai/new",
                  tint: UIColor(red: 0.85, green: 0.47, blue: 0.34, alpha: 1),
                  glyph: "A",
                  prefersDesktop: false,
                  needsTranspiler: true,
                  chunkBaseURL: "https://assets-proxy.anthropic.com/claude-ai/v2/assets/v1",
                  transpilerMode: "esm"),
        AIService(id: "grok",
                  name: "Grok",
                  subtitle: "xAI",
                  url: "https://grok.com/",
                  tint: UIColor(red: 0.35, green: 0.36, blue: 0.40, alpha: 1),
                  glyph: "G",
                  prefersDesktop: false,
                  needsTranspiler: true,
                  chunkBaseURL: "https://cdn.grok.com/_next/static/chunks",
                  transpilerMode: "classic"),
        AIService(id: "arena",
                  name: "Arena",
                  subtitle: "arena.ai",
                  url: "https://arena.ai/",
                  tint: UIColor(red: 0.49, green: 0.36, blue: 1.00, alpha: 1),
                  glyph: "A",
                  prefersDesktop: false,
                  needsTranspiler: true,
                  chunkBaseURL: "https://arena.ai/_next/static/chunks",
                  transpilerMode: "classic")
    ]

    static func service(withID id: String) -> AIService? {
        for s in all where s.id == id { return s }
        return nil
    }
}

/// The launcher. Shown on every start so the user picks a destination.
final class HubViewController: UIViewController {

    private let scroll = UIScrollView()
    private let titleLabel = UILabel()
    private let subLabel = UILabel()
    private let footer = UILabel()
    private var cards: [UIControl] = []

    private let cardHeight: CGFloat = 78
    private let cardGap: CGFloat = 12

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.04, alpha: 1)

        scroll.alwaysBounceVertical = true
        scroll.showsVerticalScrollIndicator = false
        view.addSubview(scroll)

        titleLabel.text = "AI Hub"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 34, weight: .bold)
        scroll.addSubview(titleLabel)

        subLabel.text = "Choose an assistant to open"
        subLabel.textColor = UIColor(white: 0.55, alpha: 1)
        subLabel.font = .systemFont(ofSize: 15, weight: .medium)
        scroll.addSubview(subLabel)

        for (i, s) in AICatalog.all.enumerated() {
            let card = makeCard(s, tag: i)
            scroll.addSubview(card)
            cards.append(card)
        }

        footer.text = "Signed-in sessions are remembered per site.\nLong-press a card to open it in desktop mode."
        footer.textColor = UIColor(white: 0.38, alpha: 1)
        footer.font = .systemFont(ofSize: 12)
        footer.numberOfLines = 0
        footer.textAlignment = .center
        scroll.addSubview(footer)
    }

    private func makeCard(_ s: AIService, tag: Int) -> UIControl {
        let card = UIControl()
        card.tag = tag
        card.backgroundColor = UIColor(white: 0.11, alpha: 1)
        card.layer.cornerRadius = 16

        let badge = UILabel()
        badge.text = s.glyph
        badge.textColor = .white
        badge.font = .systemFont(ofSize: 23, weight: .heavy)
        badge.textAlignment = .center
        badge.backgroundColor = s.tint
        badge.layer.cornerRadius = 25
        badge.clipsToBounds = true
        badge.tag = 901
        card.addSubview(badge)

        let name = UILabel()
        name.text = s.name
        name.textColor = .white
        name.font = .systemFont(ofSize: 19, weight: .semibold)
        name.tag = 902
        card.addSubview(name)

        let sub = UILabel()
        sub.text = s.subtitle
        sub.textColor = UIColor(white: 0.5, alpha: 1)
        sub.font = .systemFont(ofSize: 13)
        sub.tag = 903
        card.addSubview(sub)

        let chev = UILabel()
        chev.text = "\u{203A}"
        chev.textColor = UIColor(white: 0.42, alpha: 1)
        chev.font = .systemFont(ofSize: 28, weight: .medium)
        chev.textAlignment = .center
        chev.tag = 904
        card.addSubview(chev)

        card.addTarget(self, action: #selector(cardTapped(_:)), for: .touchUpInside)
        card.addTarget(self, action: #selector(cardDown(_:)), for: .touchDown)
        card.addTarget(self, action: #selector(cardUp(_:)),
                       for: [.touchUpInside, .touchUpOutside, .touchCancel])

        let lp = UILongPressGestureRecognizer(target: self,
                                              action: #selector(cardLongPress(_:)))
        card.addGestureRecognizer(lp)
        return card
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()

        scroll.frame = view.bounds
        let inset: CGFloat = 18
        let w = view.bounds.width - inset * 2
        var y: CGFloat = view.safeAreaInsets.top + 18

        titleLabel.frame = CGRect(x: inset, y: y, width: w, height: 40)
        y += 42
        subLabel.frame = CGRect(x: inset, y: y, width: w, height: 20)
        y += 34

        for card in cards {
            card.frame = CGRect(x: inset, y: y, width: w, height: cardHeight)

            let b = card.viewWithTag(901)
            b?.frame = CGRect(x: 14, y: (cardHeight - 50) / 2, width: 50, height: 50)

            let hasSub = (card.viewWithTag(903) as? UILabel)?.text?.isEmpty == false
            let nameY: CGFloat = hasSub ? 20 : 28
            card.viewWithTag(902)?.frame =
                CGRect(x: 76, y: nameY, width: w - 76 - 40, height: 24)
            card.viewWithTag(903)?.frame =
                CGRect(x: 76, y: nameY + 23, width: w - 76 - 40, height: 18)
            card.viewWithTag(904)?.frame =
                CGRect(x: w - 38, y: (cardHeight - 34) / 2, width: 28, height: 34)

            y += cardHeight + cardGap
        }

        y += 10
        footer.frame = CGRect(x: inset, y: y, width: w, height: 40)
        y += 40 + view.safeAreaInsets.bottom + 20

        scroll.contentSize = CGSize(width: view.bounds.width, height: y)
    }

    // MARK: - Actions

    @objc private func cardDown(_ c: UIControl) {
        UIView.animate(withDuration: 0.09) {
            c.backgroundColor = UIColor(white: 0.17, alpha: 1)
            c.transform = CGAffineTransform(scaleX: 0.98, y: 0.98)
        }
    }

    @objc private func cardUp(_ c: UIControl) {
        UIView.animate(withDuration: 0.16) {
            c.backgroundColor = UIColor(white: 0.11, alpha: 1)
            c.transform = .identity
        }
    }

    @objc private func cardTapped(_ c: UIControl) {
        open(index: c.tag, forceDesktop: nil)
    }

    @objc private func cardLongPress(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let c = g.view as? UIControl else { return }
        cardUp(c)
        open(index: c.tag, forceDesktop: true)
    }

    private func open(index: Int, forceDesktop: Bool?) {
        guard index >= 0 && index < AICatalog.all.count else { return }
        let service = AICatalog.all[index]
        let vc = AIWebViewController(service: service, forceDesktop: forceDesktop)
        vc.modalPresentationStyle = .fullScreen
        present(vc, animated: true, completion: nil)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        .allButUpsideDown
    }
}
