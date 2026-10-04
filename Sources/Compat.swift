/// JavaScript compatibility shims injected into every page.
///
/// iOS 15.8 ships WebKit 605 (Safari 15.x). Grok, Claude and Arena are
/// modern React/Next.js apps whose bundles assume Safari 16-17 built-ins;
/// when one is missing the bundle throws during hydration and the page
/// renders blank or half-dead. These shims fill the gap.
///
/// Two gaps cannot be filled from JavaScript and are documented here so
/// nobody wastes time on them later:
///   * RegExp lookbehind  (?<=x)  - a parse-time syntax error, so the
///     script dies before any polyfill could run.
///   * CSS :has()  - a selector-engine feature, not a JS API.
///
/// The script also captures the first ~24 JS errors and forwards them to
/// the app, so a broken site can be diagnosed from the device instead of
/// guessed at.
///
/// NOTE: Swift requires every line of a multi-line string literal to be
/// indented at least as far as the closing delimiter. Every JS line below
/// therefore carries the same 4-space prefix, which Swift strips out.
enum Compat {
    static let js = """
    (function () {
      'use strict';
      var D = function (o, k, v) {
        try {
          if (o && !o[k]) {
            Object.defineProperty(o, k, { value: v, configurable: true, writable: true });
          }
        } catch (e) {}
      };

      // ---- Object.hasOwn (Safari 15.4) ----
      D(Object, 'hasOwn', function (o, k) {
        return Object.prototype.hasOwnProperty.call(Object(o), k);
      });

      // ---- Array/String.prototype.at (Safari 15.4) ----
      var atFn = function (n) {
        var o = Object(this);
        var len = o.length >>> 0;
        n = Math.trunc(Number(n)) || 0;
        if (n < 0) { n += len; }
        if (n < 0 || n >= len) { return undefined; }
        return o[n];
      };
      D(Array.prototype, 'at', atFn);
      D(String.prototype, 'at', atFn);

      // ---- findLast / findLastIndex (Safari 15.4) ----
      D(Array.prototype, 'findLast', function (fn, thisArg) {
        var o = Object(this);
        for (var i = (o.length >>> 0) - 1; i >= 0; i--) {
          if (fn.call(thisArg, o[i], i, o)) { return o[i]; }
        }
        return undefined;
      });
      D(Array.prototype, 'findLastIndex', function (fn, thisArg) {
        var o = Object(this);
        for (var i = (o.length >>> 0) - 1; i >= 0; i--) {
          if (fn.call(thisArg, o[i], i, o)) { return i; }
        }
        return -1;
      });

      // ---- Change-array-by-copy (Safari 16.4) ----
      D(Array.prototype, 'toSorted', function (cmp) {
        return Array.prototype.slice.call(this).sort(cmp);
      });
      D(Array.prototype, 'toReversed', function () {
        return Array.prototype.slice.call(this).reverse();
      });
      D(Array.prototype, 'toSpliced', function () {
        var c = Array.prototype.slice.call(this);
        Array.prototype.splice.apply(c, arguments);
        return c;
      });
      D(Array.prototype, 'with', function (i, v) {
        var c = Array.prototype.slice.call(this);
        var len = c.length;
        i = Math.trunc(Number(i)) || 0;
        if (i < 0) { i += len; }
        c[i] = v;
        return c;
      });

      // ---- Object.groupBy / Map.groupBy (Safari 17.4) ----
      D(Object, 'groupBy', function (items, fn) {
        var out = Object.create(null);
        var i = 0;
        var arr = Array.from(items);
        for (i = 0; i < arr.length; i++) {
          var k = fn(arr[i], i);
          if (!out[k]) { out[k] = []; }
          out[k].push(arr[i]);
        }
        return out;
      });
      if (typeof Map === 'function') {
        D(Map, 'groupBy', function (items, fn) {
          var m = new Map();
          var arr = Array.from(items);
          for (var i = 0; i < arr.length; i++) {
            var k = fn(arr[i], i);
            if (!m.has(k)) { m.set(k, []); }
            m.get(k).push(arr[i]);
          }
          return m;
        });
      }

      // ---- Promise.withResolvers (Safari 17.4) ----
      D(Promise, 'withResolvers', function () {
        var res, rej;
        var p = new Promise(function (a, b) { res = a; rej = b; });
        return { promise: p, resolve: res, reject: rej };
      });

      // ---- structuredClone (Safari 15.4) ----
      if (typeof window.structuredClone !== 'function') {
        window.structuredClone = function (v) {
          var seen = typeof Map === 'function' ? new Map() : null;
          var walk = function (x) {
            if (x === null || typeof x !== 'object') { return x; }
            if (seen && seen.has(x)) { return seen.get(x); }
            var out;
            if (x instanceof Date) { return new Date(x.getTime()); }
            if (typeof RegExp !== 'undefined' && x instanceof RegExp) {
              return new RegExp(x.source, x.flags);
            }
            if (typeof Map !== 'undefined' && x instanceof Map) {
              out = new Map();
              if (seen) { seen.set(x, out); }
              x.forEach(function (val, key) { out.set(walk(key), walk(val)); });
              return out;
            }
            if (typeof Set !== 'undefined' && x instanceof Set) {
              out = new Set();
              if (seen) { seen.set(x, out); }
              x.forEach(function (val) { out.add(walk(val)); });
              return out;
            }
            if (Array.isArray(x)) {
              out = [];
              if (seen) { seen.set(x, out); }
              for (var i = 0; i < x.length; i++) { out[i] = walk(x[i]); }
              return out;
            }
            if (typeof ArrayBuffer !== 'undefined' && x instanceof ArrayBuffer) {
              return x.slice(0);
            }
            out = {};
            if (seen) { seen.set(x, out); }
            for (var k in x) {
              if (Object.prototype.hasOwnProperty.call(x, k)) { out[k] = walk(x[k]); }
            }
            return out;
          };
          return walk(v);
        };
      }

      // ---- crypto.randomUUID (Safari 15.4) ----
      try {
        if (window.crypto && !window.crypto.randomUUID) {
          window.crypto.randomUUID = function () {
            var b = new Uint8Array(16);
            if (window.crypto.getRandomValues) {
              window.crypto.getRandomValues(b);
            } else {
              for (var k = 0; k < 16; k++) {
                b[k] = (Math.random() * 256) | 0;
              }
            }
            b[6] = (b[6] & 15) | 64;
            b[8] = (b[8] & 63) | 128;
            var h = [];
            for (var i = 0; i < 16; i++) {
              h.push((b[i] + 256).toString(16).slice(1));
            }
            return h[0] + h[1] + h[2] + h[3] + '-' + h[4] + h[5] + '-' +
                   h[6] + h[7] + '-' + h[8] + h[9] + '-' +
                   h[10] + h[11] + h[12] + h[13] + h[14] + h[15];
          };
        }
      } catch (e) {}

      // ---- AbortSignal.timeout / .any (Safari 16 / 17.4) ----
      try {
        if (typeof AbortController === 'function' && typeof AbortSignal === 'function') {
          if (!AbortSignal.timeout) {
            AbortSignal.timeout = function (ms) {
              var c = new AbortController();
              setTimeout(function () { c.abort(); }, ms);
              return c.signal;
            };
          }
          if (!AbortSignal.any) {
            AbortSignal.any = function (signals) {
              var c = new AbortController();
              var arr = Array.from(signals);
              for (var i = 0; i < arr.length; i++) {
                if (arr[i].aborted) { c.abort(); return c.signal; }
                arr[i].addEventListener('abort', function () { c.abort(); });
              }
              return c.signal;
            };
          }
        }
      } catch (e) {}

      // ---- Element.prototype.replaceChildren (Safari 14) ----
      try {
        if (typeof Element !== 'undefined') {
          D(Element.prototype, 'replaceChildren', function () {
            while (this.firstChild) { this.removeChild(this.firstChild); }
            for (var i = 0; i < arguments.length; i++) {
              this.append(arguments[i]);
            }
          });
        }
      } catch (e) {}

      // ---- report the first few JS errors back to the app ----
      var errs = [];
      window.__aiErrors = errs;
      var push = function (kind, msg, src, line) {
        if (errs.length > 24) { return; }
        var text = kind + ': ' + msg;
        if (src) {
          var s = String(src);
          if (s.length > 70) { s = '...' + s.slice(s.length - 67); }
          text += '  [' + s + (line ? ':' + line : '') + ']';
        }
        errs.push(text);
        try {
          if (window.webkit && window.webkit.messageHandlers &&
              window.webkit.messageHandlers.aierr) {
            window.webkit.messageHandlers.aierr.postMessage(text);
          }
        } catch (e) {}
      };
      window.addEventListener('error', function (e) {
        var t = e ? e.target : null;
        if (t && t !== window && t.tagName) {
          var tag = String(t.tagName).toUpperCase();
          var url = t.src || t.href || '';
          if (tag === 'SCRIPT' || tag === 'LINK' || tag === 'IMG') {
            push('LoadFail ' + tag, 'did not load', url, 0);
            return;
          }
        }
        var m = (e && e.message) ? e.message : '';
        if (!m || m === 'Script error.') {
          m = 'blocked (cross-origin script, no CORS headers)';
        }
        push('Error', m, e ? e.filename : '', e ? e.lineno : 0);
      }, true);
      window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        var m = 'unknown';
        if (r) { m = (r.message ? r.message : String(r)); }
        push('Promise', m, '', 0);
      });

    })();
    """
}
