/*
 * ZeroixDark Page Loader
 * Animasi loading "ZeroixDark Marketplace" yang tampil setiap kali halaman dibuka / berpindah halaman.
 * Pasang tepat setelah <body>:  <script src="page-loader.js"></script>
 * (Harus synchronous, jangan pakai defer/async, supaya menutupi halaman sebelum sempat tampil.)
 */
(function () {
    if (window.__zxLoader) return;
    window.__zxLoader = true;

    const MIN_SHOW = 1600; // ms minimal animasi tampil
    const MAX_SHOW = 6000; // ms batas aman kalau event load tidak kunjung datang
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const css = `
        #zxLoader { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 0 16px; background: radial-gradient(circle at 50% 45%, #0b2a2a 0%, #0f172a 60%, #070b16 100%); overflow: hidden; cursor: pointer; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; transition: opacity .55s ease, visibility .55s ease; }
        #zxLoader.zx-hide { opacity: 0; visibility: hidden; pointer-events: none; }
        #zxLoader.zx-hide .zx-content { transform: scale(1.08); filter: blur(6px); }
        #zxLoader.zx-enter { opacity: 0; }
        #zxLoader::before { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(13,148,136,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(13,148,136,.07) 1px, transparent 1px); background-size: 40px 40px; -webkit-mask-image: radial-gradient(circle at center, #000 0%, transparent 70%); mask-image: radial-gradient(circle at center, #000 0%, transparent 70%); animation: zxGrid 3s linear infinite; }
        #zxLoader .zx-content { position: relative; display: flex; flex-direction: column; align-items: center; gap: 18px; transition: transform .55s ease, filter .55s ease; }
        #zxLoader .zx-ring { position: relative; width: 84px; height: 84px; border-radius: 50%; display: flex; align-items: center; justify-content: center; opacity: 0; animation: zxPop .6s cubic-bezier(.2,.9,.3,1.3) .05s forwards; }
        #zxLoader .zx-ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid transparent; border-top-color: #0d9488; border-right-color: rgba(13,148,136,.4); animation: zxSpin 1.1s linear infinite; }
        #zxLoader .zx-ring::after { content: ''; position: absolute; inset: 10px; border-radius: 50%; background: rgba(13,148,136,.12); box-shadow: 0 0 40px rgba(13,148,136,.4), inset 0 0 20px rgba(13,148,136,.3); }
        #zxLoader .zx-ring span { position: relative; z-index: 1; font-size: 34px; font-weight: 800; background: linear-gradient(135deg, #fff, #0d9488); -webkit-background-clip: text; background-clip: text; color: transparent; }
        #zxLoader .zx-title { margin: 0; font-size: clamp(30px, 8vw, 56px); font-weight: 800; letter-spacing: -1px; line-height: 1.05; white-space: nowrap; }
        #zxLoader .zx-ch { display: inline-block; opacity: 0; transform: translateY(30px) rotateX(90deg); filter: blur(8px); animation: zxChar .5s cubic-bezier(.2,.8,.2,1) forwards; background: linear-gradient(180deg, #fff 30%, #5eead4); -webkit-background-clip: text; background-clip: text; color: transparent; }
        #zxLoader .zx-ch.zx-accent { background: linear-gradient(180deg, #5eead4, #0d9488); -webkit-background-clip: text; background-clip: text; }
        #zxLoader .zx-sub { margin: 0; font-size: clamp(11px, 3vw, 14px); font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; opacity: 0; animation: zxSub .8s ease .6s forwards; }
        #zxLoader .zx-bar { width: min(220px, 60vw); height: 3px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; opacity: 0; animation: zxFade .3s ease .65s forwards; }
        #zxLoader .zx-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #0d9488, #5eead4); box-shadow: 0 0 12px #0d9488; animation: zxLoad .85s ease-in-out .7s forwards; }
        #zxLoader .zx-skip { position: absolute; bottom: 28px; left: 0; right: 0; text-align: center; font-size: 11px; color: rgba(148,163,184,.5); letter-spacing: 1px; opacity: 0; animation: zxFade .4s ease 1s forwards; }
        @keyframes zxChar { to { opacity: 1; transform: none; filter: none; } }
        @keyframes zxPop { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
        @keyframes zxSpin { to { transform: rotate(360deg); } }
        @keyframes zxSub { from { opacity: 0; letter-spacing: 2px; } to { opacity: 1; letter-spacing: 8px; } }
        @keyframes zxFade { to { opacity: 1; } }
        @keyframes zxLoad { to { width: 100%; } }
        @keyframes zxGrid { to { background-position: 0 40px, 40px 0; } }
        html.zx-lock, html.zx-lock body { overflow: hidden !important; }
        @media (prefers-reduced-motion: reduce) {
            #zxLoader *, #zxLoader::before { animation-duration: .01s !important; animation-delay: 0s !important; }
        }
    `;

    const style = document.createElement('style');
    style.id = 'zxLoaderStyle';
    style.textContent = css;
    document.head.appendChild(style);

    const title = [...'ZeroixDark'].map((c, i) =>
        `<span class="zx-ch${i >= 6 ? ' zx-accent' : ''}" style="animation-delay:${(0.15 + i * 0.04).toFixed(2)}s">${c}</span>`
    ).join('');

    function buildLoader() {
        const el = document.createElement('div');
        el.id = 'zxLoader';
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `
            <div class="zx-content">
                <div class="zx-ring"><span>Z</span></div>
                <h1 class="zx-title">${title}</h1>
                <p class="zx-sub">Marketplace</p>
                <div class="zx-bar"><i></i></div>
            </div>
            <div class="zx-skip">ketuk untuk lewati</div>`;
        return el;
    }

    // ---- Tampil saat halaman dibuka ----
    let loader = buildLoader();
    (document.body || document.documentElement).appendChild(loader);
    document.documentElement.classList.add('zx-lock');

    const startedAt = Date.now();
    let closed = false;

    function closeLoader() {
        if (closed) return;
        closed = true;
        const el = loader;
        el.classList.add('zx-hide');
        document.documentElement.classList.remove('zx-lock');
        setTimeout(() => el.remove(), 600);
    }

    function closeWhenReady() {
        const wait = reduce ? 0 : Math.max(0, MIN_SHOW - (Date.now() - startedAt));
        setTimeout(closeLoader, wait);
    }

    if (document.readyState === 'complete') closeWhenReady();
    else window.addEventListener('load', closeWhenReady, { once: true });
    setTimeout(closeLoader, MAX_SHOW);
    loader.addEventListener('click', closeLoader);

    // Kalau user kembali pakai tombol Back (halaman dari cache), pastikan loader tidak nyangkut
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        document.querySelectorAll('#zxLoader').forEach(n => n.remove());
        document.documentElement.classList.remove('zx-lock');
    });

    // ---- Tampil saat user klik link ke halaman lain ----
    function isInternalPageLink(a, e) {
        if (!a || e.defaultPrevented || e.button !== 0) return false;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
        if (a.target && a.target !== '_self') return false;
        if (a.hasAttribute('download')) return false;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin) return false;
        if (url.pathname === location.pathname && url.search === location.search) return false; // cuma ganti hash
        return true;
    }

    document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!isInternalPageLink(a, e)) return;
        e.preventDefault();
        const exit = buildLoader();
        exit.classList.add('zx-enter');
        exit.style.cursor = 'default';
        document.body.appendChild(exit);
        requestAnimationFrame(() => requestAnimationFrame(() => exit.classList.remove('zx-enter')));
        setTimeout(() => { location.href = a.href; }, reduce ? 0 : 350);
    });
})();
