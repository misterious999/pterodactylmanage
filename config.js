// config.js - Konfigurasi Terpusat Enterprise (Bebas Cache)
const GlobalConfig = {
    // ============================================================
    // URL Cloudflare Worker (API) — ditanam statis
    // ============================================================
    // INSIDEN 25 Okt 2026: banyak ISP Indonesia (terbukti XL/Axis) memblokir
    // *.workers.dev di level DNS dengan mengarahkannya ke
    // "blockpage.xlaxiata.id". Karena yang diblokir lewat DNS, TLS-nya juga
    // ikut gagal (sertifikat milik blockpage, bukan milik Worker):
    //
    //   curl: SSL: no alternative certificate subject name matches target hostname
    //   browser: TypeError: Failed to fetch     (bukan HTTP error!)
    //
    // Akibatnya dashboard berhenti di "⏳"/"Err" dan login gagal, padahal
    // Worker sendiri sehat. Situs tetap terbuka karena halaman statis ada di
    // domain sendiri; yang hilang cuma semua panggilan API.
    //
    // SOLUSI PERMANEN: pasang Custom Domain untuk Worker — domain sendiri
    // tidak kena blokir DNS ISP.
    //   Cloudflare Dashboard -> Workers & Pages -> zeroix-gatekeeper
    //   -> Settings -> Domains & Routes -> Add -> Custom domain
    //   -> isi: api.zeroixdarkmarket.web.id  (tunggu status Active)
    WORKER_URL_PRIMARY: 'https://api.zeroixdarkmarket.web.id',

    // Domain workers.dev LAMA sengaja dipertahankan sebagai cadangan otomatis
    // (lihat workerFetch di bawah). Jadi kalau custom domain belum dipasang,
    // belum aktif, atau suatu saat gagal, permintaan otomatis dialihkan ke
    // sana — situs tidak pernah jadi "mati total" hanya karena satu domain.
    // Di jaringan yang tidak memblokir (WiFi/kampus/VPN), cadangan ini tetap
    // berfungsi penuh.
    WORKER_URL_FALLBACK: 'https://zeroix-gatekeeper.benak211.workers.dev',

    // Override tanpa deploy ulang lewat console browser (dipakai untuk uji cepat):
    //   localStorage.setItem('zeroix_worker_url', 'https://api.zeroixdarkmarket.web.id')
    //   localStorage.removeItem('zeroix_worker_url')
    getWorkerUrl: () => {
        try {
            const override = localStorage.getItem('zeroix_worker_url');
            if (override && override.trim()) return override.trim().replace(/[\/?]+$/, '');
        } catch (e) { /* localStorage bisa diblokir di mode privat */ }
        return GlobalConfig.WORKER_URL_PRIMARY;
    },
    getWorkerFallbackUrl: () => GlobalConfig.WORKER_URL_FALLBACK,

    // Endpoint yang terbukti bisa dijangkau di sesi browser ini (in-memory saja,
    // di-reset tiap reload supaya tidak menyimpan keadaan yang basi).
    _workerActive: null,

    // --------------------------------------------------------
    // workerFetch(path, opts) — pengirim request ke Worker dengan
    // auto-fallback antar domain. Dipakai SEMUA halaman lewat GlobalConfig,
    // supaya perilakunya seragam.
    //
    // ATURAN PENTING: hanya GAGAL JARINGAN (TypeError dari fetch — DNS diblokir,
    // TLS gagal, offline) yang dicoba ulang ke domain cadangan.
    // Respons HTTP apa pun (401/403/500) TIDAK diulang, karena itu jawaban
    // asli dari server. Kalau diulang, endpoint /pay/* bisa membuat
    // tagihan QRIS dobel — jadi aturan ini wajib dipatuhi.
    // --------------------------------------------------------
    workerFetch: (path, opts) => {
        const urls = [];
        const push = (u) => { if (u && urls.indexOf(u) < 0) urls.push(u); };
        // Domain yang sudah terbukti jalan didahulukan biar hemat waktu.
        push(GlobalConfig._workerActive);
        push(GlobalConfig.getWorkerUrl());
        push(GlobalConfig.getWorkerFallbackUrl());

        const attempt = (i) => {
            if (i >= urls.length) {
                return Promise.reject(new Error('Tidak dapat terhubung ke server. Periksa koneksi internetmu.'));
            }
            return fetch(urls[i] + path, opts).then((res) => {
                GlobalConfig._workerActive = urls[i]; // ingat untuk request berikutnya
                return res;
            }, (err) => {
                // AbortError = kehabisan waktu; mengulang ke domain lain hanya
                // menambah waktu tunggu, jadi tidak usah.
                if (err && err.name === 'TypeError' && i + 1 < urls.length) {
                    console.warn('[workerFetch] ' + urls[i] + ' gagal di level jaringan, mencoba cadangan: ' + urls[i + 1]);
                    return attempt(i + 1);
                }
                throw err;
            });
        };
        return attempt(0);
    },

    getFirebaseUrl: () => "https://cobaaja-ac5d0-default-rtdb.firebaseio.com",
    
    // Domain dipastikan bersih dari https://
    getPteroDomain: (mode = 'private') => {
        const domains = {
            private: "zerosystempriv.bypstar7.web.id",
            public: "assistantzeroix.bypstar7.online",
            public_v2: "zeropublikv2.bypstar7.online"
        };
        return domains[mode] || "localhost";
    },

    // Masa tenggang setelah expired: server di-suspend dulu, dihapus permanen setelah X hari.
    // Harus sama dengan GRACE_DAYS di workers.js
    getGraceDays: () => 3,

    // Jenis pesanan toko, ditentukan dari kategori + nama produk. Harus sama dengan jenisProduk() di workers.js
    //   Kategori "Panel Private/Publik/Publik V2" + nama "3Gb Ram" / "Unlimited Ram" -> panel Pterodactyl
    //   Kategori "Role Panel" + nama "Reseller Private" / "Partner Publik V2"     -> akun login website
    //   product.panel (diisi manual di manage_products.html) menimpa spesifikasi otomatis
    //   null -> pesanan manual via WhatsApp
    jenisProduk: (p) => {
        const norm = (s) => String(s || '').toLowerCase().replace(/publik/g, 'public').replace(/privat\b/g, 'private').replace(/reseler/g, 'reseller');
        const kat = norm(p?.kategori), nama = norm(p?.nama);
        const area = (s) => /\bv2\b/.test(s) ? 'public_v2' : /private/.test(s) ? 'private' : /public/.test(s) ? 'public' : null;

        if (/\brole\b/.test(kat)) {
            const tier = /partner/.test(nama) ? 'partner' : /reseller/.test(nama) ? 'reseller' : null;
            const role = tier && area(nama) ? `${tier}_${area(nama)}` : null;
            const roles = ['reseller_private', 'reseller_public', 'partner_public', 'reseller_public_v2', 'partner_public_v2'];
            return roles.includes(role) ? { type: 'role', role } : null;
        }
        if (p?.panel?.mode) return { type: 'panel', ...p.panel };
        if (/\bpanel\b/.test(kat) && area(kat)) {
            const gb = nama.match(/(\d+)\s*gb/);
            if (/unli/.test(nama)) return { type: 'panel', mode: area(kat), ram: 0, disk: 0, cpu: 0 };
            if (gb) return { type: 'panel', mode: area(kat), ram: gb[1] * 1024, disk: gb[1] * 1024, cpu: 100 };
        }
        return null;
    },

    // Parameter statis default
    getDefaultDeploy: () => ({
        locationId: "1",
        eggId: "15",
        nodeId: "1",
        nestId: "5"
    })
};
