// patch.js — AI Hub chunk interceptor.
//
// Based on the approach proven by mgefimov/claude-legacy-ios (MIT), generalised
// to handle two different bundler shapes.
//
// WHY THIS EXISTS
// iOS 15.8 is WebKit 605 (Safari 15.x). Modern bundles ship syntax this engine
// cannot PARSE: class static blocks `class A{static{...}}` and regexp
// lookbehind `(?<=x)`, both Safari 16.4+. A parse error happens before any code
// runs, so a polyfill is powerless. The only fix is to rewrite the source
// before WebKit ever sees it.
//
// HOW
//   1. A MutationObserver catches <script src> nodes as they are inserted.
//   2. `node.type = "javascript/blocked"` makes WebKit skip it entirely.
//   3. We fetch the source ourselves, run it through LegacyTranspiler, and hand
//      the result to NATIVE, which runs it with evaluateJavaScript.
//
// WHY BOUNCE THROUGH NATIVE instead of eval()?
// These sites send a Content-Security-Policy that forbids eval and inline
// script. evaluateJavaScript: from the host app is not subject to page CSP.
// This is the load-bearing trick; eval() here would be silently blocked.
//
// Native must provide, before this file runs:
//   window.__aihub = { baseURL, mode: 'esm' | 'classic', iosVersion, debug }
(function () {
  var CFG = window.__aihub || {};
  var BASE = CFG.baseURL || '';
  var MODE = CFG.mode || 'esm';

  var post = function (name, payload) {
    try {
      if (window.webkit && window.webkit.messageHandlers &&
          window.webkit.messageHandlers[name]) {
        window.webkit.messageHandlers[name].postMessage(payload);
      }
    } catch (e) {}
  };

  var shortName = function (src) {
    var p = String(src || '').split('?')[0].split('/');
    return p[p.length - 1] || String(src || '');
  };

  var status = function (o) { post('loadingStatus', o); };
  var reportError = function (msg, fatal) {
    status({ stage: 'error', message: String(msg), fatal: !!fatal });
  };

  status({ stage: 'boot', mode: MODE });

  if (!window.LegacyTranspiler ||
      typeof window.LegacyTranspiler.init !== 'function') {
    reportError('legacy-transpiler.js did not load', true);
    return;
  }

  // ---- native round-trip with acknowledgement -------------------------
  // Classic (webpack) chunks must execute in insertion order, so we need to
  // know when native has finished running one before sending the next.
  var ackSeq = 0;
  var pending = {};
  window.__aihubAck = function (id, errMsg) {
    var cb = pending[id];
    delete pending[id];
    if (cb) { cb(errMsg); }
  };

  var runViaNative = function (code, file) {
    return new Promise(function (resolve) {
      var id = ++ackSeq;
      pending[id] = function (errMsg) {
        if (errMsg) { reportError(file + ': ' + errMsg, false); }
        resolve();
      };
      post('patchScript', { code: code, file: file, id: id });
      // Never hang the queue on a lost acknowledgement.
      setTimeout(function () {
        if (pending[id]) { delete pending[id]; resolve(); }
      }, 30000);
    });
  };

  // ---- readiness ------------------------------------------------------
  var readySent = false, readyTimer = null, readyTries = 0;
  var checkReady = function () {
    if (readySent) { return; }
    var painted = document.body && document.body.innerText.trim().length > 0;
    if (document.readyState === 'complete' && painted) {
      readySent = true;
      status({ stage: 'ready' });
      return;
    }
    // These apps paint long after the last chunk runs — ~15s on a fast device,
    // much later on an A9. Poll fast at first, then back off.
    if (++readyTries > 120) { return; }
    readyTimer = setTimeout(checkReady, readyTries < 20 ? 300 : 1000);
  };
  var scheduleReady = function () {
    if (readySent) { return; }
    readyTries = 0;
    clearTimeout(readyTimer);
    readyTimer = setTimeout(checkReady, 800);
  };

  try {
    window.LegacyTranspiler.init({
      BASE_URL: BASE,
      minify: true,
      runScript: function (code, src) {
        runViaNative(code, shortName(src));
        scheduleReady();
      },
      target: { platform: 'iOS', version: CFG.iosVersion || '15.0' }
    });
  } catch (e) {
    reportError('LegacyTranspiler.init failed: ' + (e && e.message ? e.message : e), true);
    return;
  }

  // ---- report downloads so the overlay can name the current file ------
  var origFetch = window.fetch;
  if (typeof origFetch === 'function' && BASE) {
    window.fetch = function (input) {
      try {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (u.indexOf(BASE) === 0) { status({ stage: 'download', file: shortName(u) }); }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  var isOurs = function (src) {
    if (!src) { return false; }
    if (BASE && src.indexOf(BASE) === 0) { return true; }
    return false;
  };

  var handled = {};

  // ---- ESM sites (claude.ai) ------------------------------------------
  // One entry module pulls the whole graph; LegacyTranspiler emulates ESM and
  // resolves imports itself, so we only intercept the entry point.
  var handleESM = function (node) {
    var src = node.src;
    if (!isOurs(src) || src.indexOf('index') === -1 || handled[src]) { return; }
    handled[src] = true;
    node.type = 'javascript/blocked';
    try {
      window.LegacyTranspiler.loadCode(src);
    } catch (e) {
      reportError('Failed to transpile ' + shortName(src) + ': ' +
                  (e && e.message ? e.message : e), true);
    }
  };

  // ---- classic/webpack sites (grok.com, arena.ai) ---------------------
  // Next.js emits many independent classic chunks that self-register via
  // self.webpackChunk.push. There is no module graph to follow, so every chunk
  // is intercepted and replayed in insertion order.
  var queue = Promise.resolve();
  var handleClassic = function (node) {
    var src = node.src;
    if (!isOurs(src) || handled[src]) { return; }
    handled[src] = true;
    node.type = 'javascript/blocked';
    status({ stage: 'download', file: shortName(src) });
    queue = queue.then(function () {
      return fetch(src, { credentials: 'omit' })
        .then(function (r) { return r.text(); })
        .then(function (code) {
          var out = window.LegacyTranspiler.transpile(src, code);
          return runViaNative(out, shortName(src));
        })
        .then(scheduleReady)
        .catch(function (e) {
          reportError(shortName(src) + ': ' + (e && e.message ? e.message : e), false);
        });
    });
  };

  var handle = MODE === 'classic' ? handleClassic : handleESM;

  var scan = function (node) {
    if (node && node.tagName === 'SCRIPT' && node.src) { handle(node); }
  };

  new MutationObserver(function (recs) {
    for (var i = 0; i < recs.length; i++) {
      var added = recs[i].addedNodes;
      for (var j = 0; j < added.length; j++) { scan(added[j]); }
    }
  }).observe(document.documentElement || document, {
    childList: true, subtree: true
  });

  // Anything the parser already inserted before the observer attached.
  var existing = document.getElementsByTagName('script');
  for (var k = 0; k < existing.length; k++) { scan(existing[k]); }
})();
