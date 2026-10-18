// config.js - Konfigurasi Terpusat Enterprise (Bebas Cache)
const GlobalConfig = {
    // URL Worker & Firebase ditanam statis
    getWorkerUrl: () => "https://zeroix-gatekeeper.benak211.workers.dev",
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
