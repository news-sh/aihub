(function () {
if (!String.prototype.isWellFormed || !String.prototype.toWellFormed) {
    if (!String.prototype.isWellFormed) {
        Object.defineProperty(String.prototype, 'isWellFormed', {
            value: function () {
                if (this == null) {
                    throw new TypeError('String.prototype.isWellFormed called on null or undefined');
                }
                var str = String(this);
                var i;
                for (i = 0; i < str.length; i++) {
                    var code = str.charCodeAt(i);
                    if (code >= 0xD800 && code <= 0xDBFF) {
                        if (i + 1 >= str.length) return false;
                        var next = str.charCodeAt(i + 1);
                        if (next < 0xDC00 || next > 0xDFFF) return false;
                        i++;
                    } else if (code >= 0xDC00 && code <= 0xDFFF) {
                        return false;
                    }
                }
                return true;
            },
            writable: true,
            configurable: true
        });
    }

    if (!String.prototype.toWellFormed) {
        Object.defineProperty(String.prototype, 'toWellFormed', {
            value: function () {
                if (this == null) {
                    throw new TypeError('String.prototype.toWellFormed called on null or undefined');
                }
                var str = String(this);
                var out = '';
                var i, code, next;
                for (i = 0; i < str.length; i++) {
                    code = str.charCodeAt(i);
                    if (code >= 0xD800 && code <= 0xDBFF) {
                        if (i + 1 < str.length) {
                            next = str.charCodeAt(i + 1);
                            if (next >= 0xDC00 && next <= 0xDFFF) {
                                out += str.charAt(i) + str.charAt(i + 1);
                                i++;
                                continue;
                            }
                        }
                        out += '\uFFFD';
                    } else if (code >= 0xDC00 && code <= 0xDFFF) {
                        out += '\uFFFD';
                    } else {
                        out += str.charAt(i);
                    }
                }
                return out;
            },
            writable: true,
            configurable: true
        });
    }
}
})();
