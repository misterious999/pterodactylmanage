// ==========================================
// 🛡️ POPUP KONFIRMASI & PESAN (pengganti confirm() / alert() bawaan browser)
//   const ya = await konfirmasi({ judul, pesan, label, bahaya })  → true / false
//   await beritahu({ judul, pesan, tipe: 'error' | 'success' })
// Memakai variabel warna yang sudah ada di setiap halaman (--danger, --card-bg, dst).
// ==========================================
(function () {
    const CSS = `
        #uiOverlay { position: fixed; inset: 0; z-index: 1000000; display: none; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; background: rgba(7, 11, 20, 0.85); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); font-family: 'Inter', system-ui, sans-serif; }
        #uiOverlay.show { display: flex; animation: uiFade .2s ease; }
        #uiBox { position: relative; width: 100%; max-width: 360px; box-sizing: border-box; padding: 28px 24px 22px; text-align: center; background: var(--card-bg, rgba(15,23,42,.9)); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); border: 1px solid rgba(255,255,255,.08); border-top-width: 4px; border-radius: 20px; box-shadow: 0 30px 60px rgba(0,0,0,.6); color: var(--text-main, #f8fafc); animation: uiPop .25s cubic-bezier(.2,.9,.3,1.2); }
        #uiBox .ui-icon { width: 48px; height: 48px; margin: 0 auto 14px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
        #uiBox .ui-icon svg { width: 26px; height: 26px; fill: currentColor; }
        #uiBox h3 { margin: 0 0 8px; font-size: 15px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
        #uiBox p { margin: 0 0 20px; font-size: 13px; line-height: 1.6; color: var(--text-sub, #94a3b8); white-space: pre-line; word-break: break-word; }
        #uiBox .ui-actions { display: flex; gap: 10px; }
        #uiBox button { flex: 1; margin: 0; padding: 12px; border: none; border-radius: 10px; font-size: 12px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; cursor: pointer; transition: .2s; font-family: inherit; }
        #uiBox .ui-ok { color: #fff; }
        #uiBox .ui-ok.danger { background: var(--danger, #ef4444); box-shadow: 0 5px 15px rgba(239,68,68,.3); }
        #uiBox .ui-ok.danger:hover { box-shadow: 0 8px 20px rgba(239,68,68,.45); transform: translateY(-2px); }
        #uiBox .ui-ok.normal { background: var(--primary, #0d9488); box-shadow: 0 5px 15px rgba(13,148,136,.3); }
        #uiBox .ui-ok.normal:hover { transform: translateY(-2px); }
        #uiBox .ui-cancel { background: rgba(255,255,255,.05); color: var(--text-sub, #94a3b8); border: 1px solid var(--border-color, rgba(255,255,255,.08)); }
        #uiBox .ui-cancel:hover { color: var(--text-main, #f8fafc); }
        @keyframes uiFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes uiPop { from { opacity: 0; transform: scale(.94) translateY(8px); } to { opacity: 1; transform: none; } }
        body.lite-mode #uiBox { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--card-solid, #1e293b); }
        @media (prefers-reduced-motion: reduce) { #uiOverlay.show, #uiBox { animation: none; } }
    `;

    const IKON = {
        bahaya: { warna: 'var(--danger, #ef4444)', svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>' },
        error:  { warna: 'var(--danger, #ef4444)', svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>' },
        success:{ warna: 'var(--success, #10b981)', svg: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>' },
        info:   { warna: 'var(--primary, #0d9488)', svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>' },
    };

    let overlay = null;

    function pastikanDOM() {
        if (overlay) return overlay;
        const style = document.createElement('style');
        style.id = 'uiConfirmStyle';
        style.textContent = CSS;
        document.head.appendChild(style);

        overlay = document.createElement('div');
        overlay.id = 'uiOverlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.innerHTML = `<div id="uiBox"><div class="ui-icon"><svg viewBox="0 0 24 24"></svg></div><h3 id="uiJudul"></h3><p id="uiPesan"></p><div class="ui-actions"></div></div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    // Tampilkan popup, kembalikan Promise yang selesai saat tombol ditekan
    function tampil({ judul, pesan, tipe, tombol }) {
        const el = pastikanDOM();
        const ikon = IKON[tipe] || IKON.info;
        const box = el.querySelector('#uiBox');
        box.style.borderTopColor = ikon.warna;
        const wrap = box.querySelector('.ui-icon');
        wrap.style.color = ikon.warna;
        wrap.style.background = 'rgba(255,255,255,.04)';
        wrap.querySelector('svg').innerHTML = ikon.svg;
        el.querySelector('#uiJudul').textContent = judul || '';
        el.querySelector('#uiJudul').style.color = ikon.warna;
        el.querySelector('#uiPesan').textContent = pesan || '';

        const aksi = el.querySelector('.ui-actions');
        aksi.innerHTML = '';

        return new Promise((resolve) => {
            const selesai = (hasil) => {
                el.classList.remove('show');
                document.removeEventListener('keydown', onKey);
                el.removeEventListener('click', onKlikLuar);
                resolve(hasil);
            };
            const onKey = (e) => { if (e.key === 'Escape') selesai(false); };
            const onKlikLuar = (e) => { if (e.target === el) selesai(false); };

            if (tombol.batal) {
                const b = document.createElement('button');
                b.className = 'ui-cancel';
                b.textContent = tombol.batal;
                b.onclick = () => selesai(false);
                aksi.appendChild(b);
            }
            const ok = document.createElement('button');
            ok.className = `ui-ok ${tombol.bahaya ? 'danger' : 'normal'}`;
            ok.textContent = tombol.label;
            ok.onclick = () => selesai(true);
            aksi.appendChild(ok);

            document.addEventListener('keydown', onKey);
            el.addEventListener('click', onKlikLuar);
            el.classList.add('show');
            setTimeout(() => ok.focus(), 50);
        });
    }

    window.konfirmasi = function ({ judul = 'Konfirmasi', pesan = '', label = 'Lanjutkan', batal = 'Batal', bahaya = true } = {}) {
        return tampil({ judul, pesan, tipe: bahaya ? 'bahaya' : 'info', tombol: { label, batal, bahaya } });
    };

    window.beritahu = function ({ judul = 'Info', pesan = '', tipe = 'info' } = {}) {
        return tampil({ judul, pesan, tipe, tombol: { label: 'OK', batal: '', bahaya: tipe === 'error' } });
    };
})();
