/* ZeroixDark PWA Service Worker */
const CACHE_NAME = 'zeroixdark-v78';

const PRECACHE_ASSETS = [
    '/manifest.json',
    '/favicon.svg?v=9.4',
    '/favicon-512.png?v=9.4',
    '/default-product.svg',
    '/config.js?v=76',
    '/ui-confirm.js?v=76',
    '/page-loader.js?v=76',
    '/ptero-ui.css?v=9.4',
    '/404.html'
];

const PUBLIC_NAV_ALLOWLIST = new Set([
    '/',
    '/index.html',
    '/store',
    '/store.html',
    '/status',
    '/status.html',
    '/promo-video',
    '/promo-video.html',
    '/syarat-ketentuan',
    '/syarat-ketentuan.html',
    '/privasi',
    '/privasi.html',
    '/login',
    '/login.html'
]);

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sedang Offline — ZeroixDark</title>
  <meta name="theme-color" content="#060b1a">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #060b1a; color: #e9eeff;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; text-align: center;
    }
    .card {
      max-width: 420px; width: 100%; padding: 34px 26px; border-radius: 22px;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    }
    h1 { font-size: 1.5rem; margin-bottom: 10px; color: #5eead4; }
    p { font-size: 0.94rem; color: #8d97b8; line-height: 1.6; margin-bottom: 22px; }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    button, a {
      padding: 11px 20px; border-radius: 12px; font-weight: 700; font-size: 0.88rem;
      cursor: pointer; text-decoration: none; border: none;
    }
    button {
      background: linear-gradient(135deg, #5eead4, #818cf8); color: #060b1a;
    }
    a {
      background: rgba(255,255,255,0.06); color: #e9eeff;
      border: 1px solid rgba(255,255,255,0.12);
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Koneksi Terputus</h1>
    <p>Sepertinya perangkat Anda sedang offline. Periksa koneksi internet Anda lalu muat ulang halaman ini.</p>
    <div class="actions">
      <button type="button" onclick="location.reload()">Coba Lagi</button>
      <a href="/store">Buka Toko</a>
    </div>
  </main>
</body>
</html>`;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(
                PRECACHE_ASSETS.map((url) =>
                    cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
                )
            )
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((k) => k.startsWith('zeroixdark-') && k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const p = url.pathname;
    if (
        p === '/sw.js' ||
        p === '/workers.js' ||
        p.startsWith('/api/') ||
        p.startsWith('/auth/') ||
        p.startsWith('/db/') ||
        p.startsWith('/pay/') ||
        p.startsWith('/admin/')
    ) {
        return;
    }

    // Navigasi halaman: Network-first, hanya cache rute publik
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).then((res) => {
                if (res && res.ok && PUBLIC_NAV_ALLOWLIST.has(p)) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
                }
                return res;
            }).catch(async () => {
                if (PUBLIC_NAV_ALLOWLIST.has(p)) {
                    const cached = await caches.match(req);
                    if (cached) return cached;
                }
                return new Response(OFFLINE_HTML, {
                    status: 503,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' }
                });
            })
        );
        return;
    }

    // Gambar / ikon lokal: Cache-first dengan refresh di latar
    if (/\.(svg|png|ico|webp)$/i.test(p)) {
        event.respondWith(
            caches.match(req).then((cached) => {
                const net = fetch(req).then((res) => {
                    if (res && res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
                    }
                    return res;
                }).catch(() => cached);
                return cached || net;
            })
        );
        return;
    }

    // Asset JS/CSS/JSON lokal: Network-first supaya update selalu langsung masuk
    if (/\.(js|css|json)$/i.test(p)) {
        event.respondWith(
            fetch(req).then((res) => {
                if (res && res.ok) {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
                }
                return res;
            }).catch(() => caches.match(req))
        );
    }
});
