# AI Hub

A small iOS app that opens AI assistants in one place. The picker is
shown on every launch — you choose where to go.

| Assistant | Site |
|-----------|------|
| ChatGPT   | chatgpt.com |
| Gemini    | gemini.google.com |

## How each site is handled

| Assistant | Engine |
|-----------|--------|
| ChatGPT   | in-app WKWebView |
| Gemini    | in-app WKWebView |
| Claude    | opens in Reynard |
| Grok      | opens in Reynard |
| Arena     | opens in Reynard |

iOS 15.8 is WebKit 605 (Safari 15.x). Claude, Grok and arena.ai ship syntax
that engine cannot **parse** - class static blocks and regexp lookbehind, both
Safari 16.4+. A parse error happens before any code runs, so a polyfill is
powerless, and Safari on the same device fails identically.

[Reynard](https://github.com/minh-ton/reynard-browser) is a Gecko (Firefox)
browser for iOS 13+. It does not use WebKit, so none of this applies there.
When Reynard is installed, tapping one of those three opens it via
`reynard://open?url=...`. The card says so underneath.

If Reynard is absent, the app falls back to its in-app runtime transpiler
([legacy-transpiler](https://github.com/mgefimov/legacy-transpiler) +
[Polyfills](https://github.com/PoomSmart/Polyfills), approach from
[claude-legacy-ios](https://github.com/mgefimov/claude-legacy-ios)), which
rewrites each chunk before WebKit sees it. That path works but is slow on an
A9. **Long-press** any card to force it instead of handing off.

`Sources/Compat.swift` still polyfills the ~15 missing *runtime* APIs
(`Object.hasOwn`, `Array.at`, `structuredClone`, `Promise.withResolvers`,
`crypto.randomUUID`, …), which is what keeps the remaining sites usable.

* **Tap** a card to open it.
* **Long-press** a card to open it in desktop mode.
* Each site keeps its own cookies, so logins survive relaunches and
  re-signing.

Inside an assistant the bottom bar has **Hub** (back to the picker),
back/forward, and a **⋯** menu with Reload, desktop/mobile toggle, Fast mode,
Home page, and "Clear this site's data".

Requires iOS 15 or newer. Bundle id `com.yourname.aihub`.

---

## Building

The Swift compiler and iOS SDK are macOS-only, so there are two options.

### GitHub Actions (no Mac needed)

Push this folder to a GitHub repo. The included workflow builds on a
`macos-latest` runner and uploads an **`AIHub-ipa`** artifact.

```bash
cd AIHub
git init && git add . && git commit -m "AI Hub"
git branch -M main
git remote add origin https://github.com/YOURNAME/aihub.git
git push -u origin main
```

Then: GitHub → **Actions** → wait for the green tick → download the
`AIHub-ipa` artifact → unzip → sign and install with Sideloadly or AltStore.

If a run does not start by itself, open **Actions → Build AI Hub IPA → Run
workflow**.

### On a Mac

```bash
./build.sh          # -> build/AIHub.ipa (unsigned)
```

Free Apple ID certificates expire after 7 days and need re-signing.

---

## A note on "GPU acceleration"

WKWebView already composites through Core Animation and renders with Metal.
There is no flag to switch the GPU on — anything claiming to do so is either
calling a private API or doing nothing at all.

What this app does instead is remove the work that actually costs frames on
an older device:

* **Opaque layer** — the compositor never blends the page against the app
  behind it.
* **Asynchronous rasterisation** on the scroll layer.
* **A shared content process**, so switching assistants reuses a warm one.
* **Incremental rendering left enabled**, so frames paint as they arrive.
* **Fast mode** (on by default) collapses the long CSS animations these chat
  UIs rely on. This is the biggest single win on an A9-class device such as
  an iPhone 6s. Toggle it from the **⋯** menu.
