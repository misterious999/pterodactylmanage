/* db-bridge.js (v7.2)
   Pengganti Firebase SDK. Semua akses data melewati Cloudflare Worker:
     - Auth : /auth/login, /auth/verify, /auth/logout, /auth/change-password
     - Data : /db/<node> (token sesi per role, baca anonim hanya untuk toko)

   Sejarah: rules firebase terbuka ".read: true, .write: true" membuat situs
   di-deface ("HACK BY RANDALUXEVA") dan semua password terbaca. Mulai
   versi ini database dikunci total dan hanya Worker (dengan secret) yang
   boleh menyentuhnya.

   Login: AuthBridge.login(username, password)
   API databasenya sama seperti firebase.database().ref(...) supaya kode
   halaman tidak perlu diubah: once, on, off, set, update, push, remove,
   child, transaction, limitToLast, orderByChild, onDisconnect.
*/
(function () {
    'use strict';

    var TOKEN_KEY = 'fzb_token';
    var WORKER = (typeof GlobalConfig !== 'undefined' && GlobalConfig.getWorkerUrl) ? GlobalConfig.getWorkerUrl() : '';
    if (!WORKER) console.warn('[db-bridge] GlobalConfig.getWorkerUrl() tidak ditemukan.');

    function readToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }
    function saveToken(token) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) {}
    }
    function sessionInfo() {
        var t = readToken().split('.');
        if (t.length !== 3 || t[0] !== 'v1') return null;
        try {
            var s = JSON.parse(decodeURIComponent(escape(atob(t[1].replace(/-/g, '+').replace(/_/g, '/')))));
            return (s && s.e > Date.now()) ? s : null;
        } catch (e) { return null; }
    }

    function api(path, opts, withAuth) {
        opts = opts || {};
        var headers = { 'Content-Type': 'application/json' };
        if (withAuth !== false) {
            var t = readToken();
            if (t) headers['Authorization'] = 'Bearer ' + t;
        }
        var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
        return fetch(WORKER + path, {
            method: opts.method || 'GET',
            headers: headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: ctrl ? ctrl.signal : undefined,
        }).then(function (res) {
            clearTimeout(timer);
            return res.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) {}
                if (!res.ok) {
                    var msg = (data && data.error) ? data.error : 'Koneksi ke server gagal (' + res.status + ')';
                    if (res.status === 401) { saveToken(null); msg = 'Sesi berakhir, silakan login kembali.'; }
                    var err = new Error(msg);
                    err.status = res.status;
                    throw err;
                }
                return data;
            });
        }, function (errFetch) {
            clearTimeout(timer);
            if (errFetch && errFetch.name === 'AbortError') throw new Error('Koneksi ke server lambat. Coba lagi.');
            throw errFetch;
        });
    }

    // ==========================================================
    // API otentikasi
    // ==========================================================
    window.AuthBridge = {
        login: function (username, password) {
            return api('/auth/login', { method: 'POST', body: { username: username, password: password } }, false).then(function (r) {
                saveToken(r.token);
                return r.user;
            });
        },
        verify: function () {
            return api('/auth/verify').then(function (r) { return r.user; });
        },
        logout: function () {
            return api('/auth/logout', { method: 'POST' }).catch(function () {}).then(function () { saveToken(null); });
        },
        changePassword: function (current, next) {
            var body = { next: next };
            if (current) body.current = current;
            return api('/auth/change-password', { method: 'POST', body: body });
        },
        session: sessionInfo,
    };

    // ==========================================================
    // Shim Firebase kompatibel untuk halaman-halaman lama
    // ==========================================================
    function Snapshot(path, value) {
        this._path = path;
        this._value = value;
        var parts = path.split('/');
        this.key = parts[parts.length - 1] || null;
    }
    Snapshot.prototype.val = function () { return this._value; };
    Snapshot.prototype.exists = function () { return this._value !== null && this._value !== undefined; };
    Snapshot.prototype.numChildren = function () { return this._value ? Object.keys(this._value).length : 0; };
    Snapshot.prototype.child = function (k) {
        var v = (this._value && this._value[k] !== undefined) ? this._value[k] : null;
        return new Snapshot(this._path + '/' + k, v);
    };
    Snapshot.prototype.forEach = function (cb) {
        if (!this._value) return false;
        return Object.keys(this._value).some(function (k) {
            var s = new Snapshot(this._path + '/' + k, this._value[k]);
            return cb(s) === true;
        }, this);
    };
    Snapshot.prototype.exportVal = function () { return this._value; };

    function cloneOpts(o) {
        return { orderBy: o ? o.orderBy : null, limitToLast: o ? o.limitToLast : null };
    }

    var listeners = []; // { ref, timer, cb }

    var Ref = function (path, opts) { this._init(path, opts); };
    Ref.prototype._init = function (path, opts) {
        this._path = String(path || '').replace(/^\/+|\/+$/g, '');
        this._opts = cloneOpts(opts);
    };
    Object.defineProperty(Ref.prototype, 'key', {
        get: function () {
            var parts = this._path.split('/');
            return parts[parts.length - 1] || null;
        },
    });
    Ref.prototype.child = function (k) { return new Ref(this._path + '/' + k, this._opts); };
    Ref.prototype.getKey = function () { return new Snapshot(this._path, null).key; };
    Ref.prototype.orderByChild = function (field) {
        var r = new Ref(this._path, this._opts); r._opts.orderBy = field; return r;
    };
    Ref.prototype.orderByKey = function () { return this; };
    Ref.prototype.limitToLast = function (n) {
        var r = new Ref(this._path, this._opts); r._opts.limitToLast = parseInt(n, 10); return r;
    };
    Ref.prototype.limitToFirst = function (n) { return this; };

    function relUrl(path, opts) {
        if (!opts || (!opts.orderBy && !opts.limitToLast)) return '/db/' + path;
        var s = '/db/' + path + '?';
        var parts = [];
        if (opts.orderBy) parts.push('orderBy=' + encodeURIComponent(opts.orderBy));
        if (opts.limitToLast) parts.push('limitToLast=' + opts.limitToLast);
        return s + parts.join('&');
    }

    function fetchValue(path, opts) {
        return api(relUrl(path, opts)).then(function (v) { return new Snapshot(path, v); });
    }

    Ref.prototype.once = function (eventType, cb) {
        var self = this;
        var p = fetchValue(this._path, this._opts).then(function (snap) { if (cb) cb(snap); return snap; });
        return p;
    };
    Ref.prototype.on = function (eventType, cb, cancel) {
        var self = this;
        // Polling tiap 6 detik, supaya halaman lama tetap "realtime" tanpa SDK.
        var id = setInterval(function () {
            fetchValue(self._path, self._opts).then(cb).catch(function (e) {
                if (cancel) cancel(e);
                else cb(new Snapshot(self._path, null)); // nilai kosong memicu guard redirect ke login
            });
        }, 6000);
        listeners.push({ ref: self, timer: id });
        // Nilai pertama dikirim langsung.
        fetchValue(self._path, self._opts).then(cb, function (e) {
            if (cancel) cancel(e);
            else cb(new Snapshot(self._path, null));
        });
        return cb;
    };
    Ref.prototype.off = function () {
        var self = this;
        listeners = listeners.filter(function (l) {
            if (!self._path || l.ref._path === self._path) { clearInterval(l.timer); return false; }
            return true;
        });
    };

    Ref.prototype.set = function (value) { return api('/db/' + this._path, { method: 'PUT', body: value }); };
    Ref.prototype.update = function (value) { return api('/db/' + this._path, { method: 'PATCH', body: value }); };
    Ref.prototype.remove = function () { return api('/db/' + this._path, { method: 'DELETE' }); };

    var PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    function generateKey() {
        var now = Date.now(), out = [];
        for (var i = 7; i >= 0; i--) { out.push(PUSH_CHARS.charAt((now % 64))); now = Math.floor(now / 64); }
        for (var j = 0; j < 4; j++) out.push(PUSH_CHARS.charAt(Math.floor(Math.random() * 64)));
        return out.join('');
    }

    function PushThenable(ref, promise) {
        this.key = ref._path.split('/').pop();
        this._ref = ref;
        this._promise = promise;
    }
    PushThenable.prototype.then = function (ok, fail) { return this._promise.then(ok, fail); };
    PushThenable.prototype.catch = function (f) { return this._promise.catch(f); };

    Ref.prototype.push = function (value) {
        var key = generateKey();
        var child = this.child(key);
        var self = this;
        function postPush(v) {
            return api('/db/' + self._path, { method: 'POST', body: v }).then(function (r) {
                var serverKey = (r && r.key) ? r.key : key;
                return self.child(serverKey);
            });
        }
        if (value !== undefined) return new PushThenable(child, postPush(value));
        // bentuk push() lalu .set(...)
        child.set = function (v) { return postPush(v); };
        return child;
    };

    Ref.prototype.transaction = function (fn, done) {
        var self = this;
        // Implementasi sederhana: baca -> hitung -> tulis (Worker memastikan
        // perubahan statistik toko maksimal ±1 supaya tidak bisa di-spam).
        return fetchValue(self._path, self._opts).then(function (snap) {
            var next = fn(snap.val());
            return api('/db/' + self._path, { method: 'PUT', body: next }).then(function () {
                if (done) done(null, true);
                return { committed: true, snapshot: new Snapshot(self._path, next) };
            }).catch(function (e) {
                if (done) done(e, false);
                return { committed: false, snapshot: null };
            });
        }).catch(function (e) {
            if (done) done(e, false);
            return { committed: false, snapshot: null };
        });
    };

    Ref.prototype.onDisconnect = function () {
        var self = this;
        return {
            set: function () { return Promise.resolve(); }, // tidak ada koneksi persisten; dilepas tanpa efek
            cancel: function () { return Promise.resolve(); },
        };
    };

    window.firebase = {
        apps: [/* placeholder: apps.length != 0 */],
        initializeApp: function () {},
        database: function () {
            return {
                ref: function (p) { return new Ref(p); },
            };
        },
    };
})();
