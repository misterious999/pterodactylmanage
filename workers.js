// zeroix-gatekeeper - Proxy aman ke Pterodactyl Application API
// API key disimpan di Cloudflare: Settings -> Variables and Secrets (PRVT_API, PUB_API, PUB_V2_API)
// + endpoint /pay/* untuk pembayaran QRIS toko (secret RAFLYSHOP_PAY_KEY)

// Website yang boleh memakai Worker ini
const ALLOWED_ORIGINS = [
    'https://pterodactylmanage.vercel.app',
];

// Setiap mode HANYA boleh diteruskan ke domain panelnya sendiri
const PANELS = {
    private:   { host: 'zerosystempriv.bypstar7.web.id',  key: 'PRVT_API' },
    public:    { host: 'assistantzeroix.bypstar7.online', key: 'PUB_API' },
    public_v2: { host: 'zeropublikv2.bypstar7.online',    key: 'PUB_V2_API' },
};

const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS.join(', ') + ', OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Panel-Mode',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
    };
}

function reply(body, status, headers) {
    return new Response(typeof body === 'string' ? JSON.stringify({ error: body }) : body, {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';

        // 1. Tolak request yang bukan dari website kita
        if (!ALLOWED_ORIGINS.includes(origin)) {
            return reply('Forbidden origin', 403, {});
        }
        const cors = corsHeaders(origin);

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }
        if (!ALLOWED_METHODS.includes(request.method)) {
            return reply('Method not allowed', 405, cors);
        }

        // Pembayaran QRIS toko (store.html) -> RaflyShop Payment
        const pathname = new URL(request.url).pathname;
        if (pathname.startsWith('/pay/')) {
            return handlePayment(pathname, request, env, cors);
        }

        // 2. Mode panel harus salah satu yang terdaftar
        const panel = PANELS[request.headers.get('X-Panel-Mode') || 'private'];
        if (!panel) {
            return reply('Invalid panel mode', 400, cors);
        }
        const apiKey = env[panel.key];
        if (!apiKey) {
            return reply('Panel API key not configured in Worker', 500, cors);
        }

        // 3. Target harus domain panel milik mode itu + hanya Application API
        let target;
        try {
            target = new URL(new URL(request.url).searchParams.get('url') || '');
        } catch {
            return reply('Invalid target URL', 400, cors);
        }
        const targetValid =
            target.protocol === 'https:' &&
            target.hostname === panel.host &&
            target.port === '' &&
            target.username === '' &&
            target.password === '' &&
            target.pathname.startsWith('/api/application/');
        if (!targetValid) {
            return reply('Target URL not allowed', 403, cors);
        }

        // 4. Teruskan ke Pterodactyl dengan API key rahasia
        const hasBody = request.method !== 'GET';
        try {
            const upstream = await fetch(target.toString(), {
                method: request.method,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: hasBody ? await request.text() : undefined,
                redirect: 'manual', // jangan ikuti redirect, supaya key tidak terbawa ke domain lain
            });
            return new Response(await upstream.text(), {
                status: upstream.status,
                headers: {
                    ...cors,
                    'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
                },
            });
        } catch (error) {
            return reply(error.message, 502, cors);
        }
    },

    // Dijalankan otomatis oleh Cron Trigger (Settings -> Triggers -> Cron, misal: */5 * * * *)
    async scheduled(event, env, ctx) {
        ctx.waitUntil(sweepExpired(env, event.scheduledTime));
    },
};

// ==========================================
// PEMBAYARAN QRIS (RaflyShop Payment) untuk store.html
//   Secret key disimpan di Cloudflare: Settings -> Variables and Secrets (RAFLYSHOP_PAY_KEY)
//   Harga diambil dari Firebase store_products di sini, bukan dari browser, supaya tidak bisa diubah pembeli.
//   Order dicatat di Firebase store_orders/{nexpay_transaction_id}
// ==========================================
// Catatan: docs.html menulis /charge/..., tapi endpoint aslinya ada di /api/charge/...
const PAY_API = 'https://raflyshop.officialteam.my.id/api';
const NEX_ID = /^NEX-[A-Za-z0-9-]{1,64}$/;

// Status asli dari gateway: pending, settlement, cancelled, expired (docs menulis "cancel")
const payStatus = (data) => String(data?.status || '').toLowerCase();

async function firebaseRest(env, path, method = 'GET', body) {
    const auth = env.FIREBASE_SECRET ? `?auth=${env.FIREBASE_SECRET}` : '';
    const res = await fetch(`${FIREBASE_URL}/${path}.json${auth}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Firebase ${method} ${path}: ${res.status}`);
    return res.json();
}

async function payApi(env, endpoint, body) {
    const res = await fetch(`${PAY_API}${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${env.RAFLYSHOP_PAY_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'manual', // jangan ikuti redirect, supaya key tidak terbawa ke domain lain
    });
    let result = null;
    try { result = await res.json(); } catch {}
    if (!res.ok || !result?.success || !result.data) {
        throw new Error(result?.message || `Payment gateway error ${res.status}`);
    }
    return result.data;
}

// Error dengan HTTP status, pesannya aman ditampilkan ke pembeli
class PayError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}

// Tanda tangan order dibuat Worker saat tagihan dibuat. Firebase bisa ditulis dari browser,
// jadi order tanpa tanda tangan yang cocok tidak boleh dipakai untuk membuat panel.
async function signOrder(env, nexId, productId, amount) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(env.RAFLYSHOP_PAY_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${nexId}|${productId}|${amount}`));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handlePayment(pathname, request, env, cors) {
    if (request.method !== 'POST') return reply('Method not allowed', 405, cors);
    if (!env.RAFLYSHOP_PAY_KEY) return reply('Payment key not configured in Worker', 500, cors);

    let input;
    try { input = await request.json(); } catch { return reply('Invalid JSON', 400, cors); }
    const ok200 = (data) => new Response(JSON.stringify({ success: true, data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
    });

    try {
        // ---------- BUAT TAGIHAN ----------
        if (pathname === '/pay/create') {
            const productId = String(input.productId || '');
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(productId)) return reply('Produk tidak valid', 400, cors);
            const product = await firebaseRest(env, `store_products/${productId}`);
            const amount = parseInt(product?.harga);
            if (!product || !(amount > 0)) return reply('Produk tidak ditemukan', 404, cors);

            // Gateway kadang membalas "fetch failed" (gangguan di sisi mereka), coba sekali lagi
            const data = await payApi(env, '/charge/qris', { amount })
                .catch(e => e.message === 'fetch failed' ? payApi(env, '/charge/qris', { amount }) : Promise.reject(e));
            const nexId = data.nexpay_transaction_id;
            const order = {
                productId,
                productName: product.nama || '-',
                amount: data.amount,
                fee: data.fee ?? null,
                invoice: data.merchant_order_id,
                status: payStatus(data) || 'pending',
                expiresAt: data.expires_at || null,
                createdAt: Date.now(),
                sig: await signOrder(env, nexId, productId, data.amount),
            };
            await firebaseRest(env, `store_orders/${nexId}`, 'PUT', order);
            return ok200({
                nexpay_transaction_id: nexId,
                invoice: order.invoice,
                productName: order.productName,
                amount: order.amount,
                status: order.status,
                qr_string: data.qr_string,
                qr_image: data.qr_image, // URL gambar QR (.jpg) dari gateway
                expires_at: order.expiresAt,
            });
        }

        // ---------- CEK STATUS / BATALKAN / BUAT PANEL (hanya order yang dibuat lewat Worker ini) ----------
        if (!['/pay/status', '/pay/cancel', '/pay/provision'].includes(pathname)) return reply('Not found', 404, cors);
        const nexId = String(input.nexpay_transaction_id || '');
        if (!NEX_ID.test(nexId)) return reply('ID transaksi tidak valid', 400, cors);
        const order = await firebaseRest(env, `store_orders/${nexId}`);
        if (!order) return reply('Order tidak ditemukan', 404, cors);

        if (pathname === '/pay/provision') {
            return ok200(await provisionPanel(env, nexId, order, input));
        }

        // Sudah final (lunas/batal), tidak perlu tanya gateway lagi
        if (order.status !== 'pending') {
            return ok200({ nexpay_transaction_id: nexId, invoice: order.invoice, status: order.status });
        }

        const data = await payApi(env, pathname === '/pay/status' ? '/charge/status' : '/charge/cancel', { nexpay_transaction_id: nexId });
        const status = payStatus(data) || order.status;
        if (status !== order.status) {
            await firebaseRest(env, `store_orders/${nexId}`, 'PATCH', { status, updatedAt: Date.now() });
        }
        return ok200({ nexpay_transaction_id: nexId, invoice: order.invoice, status });
    } catch (error) {
        return reply(error.message, error.status || 502, cors);
    }
}

// ==========================================
// PESANAN OTOMATIS SETELAH LUNAS
//   Jenis produk ditentukan jenisProduk(): panel Pterodactyl (user + server) atau akun login website.
//   Author = "admin", masa aktif PANEL_DAYS hari. Untuk panel ditulis ke ptero_users_expired
//   (Auto-Sweeper yang mengurus suspend/hapus), untuk akun website ke users/{id}/expiredAt.
// ==========================================
const PANEL_DAYS = 30;
const PANEL_AUTHOR = 'admin';
const PAID_STATUSES = ['settlement', 'paid', 'success', 'completed'];
const DEPLOY = { locationId: 1, nestId: 5 }; // sama dengan GlobalConfig.getDefaultDeploy()
const EGG_IMAGES = { 15: 'ghcr.io/parkervcp/yolks:nodejs_20', 20: 'ghcr.io/parkervcp/yolks:python_3.9' };
// Sama persis dengan startup di manage_ptero_users.html
const STARTUP = "if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == \"1\" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ ! -z${CUSTOM_ENVIRONMENT_VARIABLES} ]]; then vars=$(echo${CUSTOM_ENVIRONMENT_VARIABLES} | tr \";\" \"\\n\"); for line in $vars; do export$line; done fi; /usr/local/bin/${CMD_RUN};";
const PROVISION_LOCK_MS = 3 * 60 * 1000; // kunci "processing" dianggap macet setelah 3 menit
const WEB_LOGIN_URL = `${ALLOWED_ORIGINS[0]}/login`;

// Harus sama dengan GlobalConfig.jenisProduk() di config.js
function jenisProduk(p) {
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
}

// Akun login website (sama dengan buatAkunWeb() di manage_panel_users.html), author "admin", aktif PANEL_DAYS hari
async function buatAkunWebsite(env, nexId, order, jenis, { username, password, phone }) {
    const users = await firebaseRest(env, 'users') || {};
    const dipakai = Object.values(users).some(u => String(u?.username || '').trim().toLowerCase() === username);
    if (dipakai) throw new PayError('Username sudah dipakai, pilih username lain.', 409);

    const createdAt = Date.now();
    const expiredAt = createdAt + PANEL_DAYS * 24 * 60 * 60 * 1000;
    const res = await fetch(`${FIREBASE_URL}/users.json${env.FIREBASE_SECRET ? `?auth=${env.FIREBASE_SECRET}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            usernameLower: username,
            password,
            role: jenis.role,
            maker: PANEL_AUTHOR,
            phone,
            isOnline: false,
            profilePic: '',
            timestamp: createdAt,
            createdAt,
            lastLoginAt: 0,
            expiredStatus: 'active',
            expiredAt,
            expiredNote: `Lisensi otomatis ${PANEL_DAYS} Hari dari pembelian toko (${order.invoice}).`,
            expiredUpdatedAt: createdAt,
            expiredUpdatedBy: 'Sistem',
            expiredUpdatedByUid: 'system',
        }),
    });
    if (!res.ok) throw new Error(`Firebase POST users: ${res.status}`);
    const uid = (await res.json()).name;

    const pesan = `Toko: akun website ${username} (${jenis.role}) dibuat otomatis untuk ${phone}, invoice ${order.invoice}. Expired ${tanggalWIB(expiredAt)}.`;
    const result = { kind: 'role', username, role: jenis.role, phone, uid, loginUrl: WEB_LOGIN_URL, createdAt, expiredAt };
    try {
        await firebaseRest(env, '', 'PATCH', {
            [`store_orders/${nexId}/provision`]: { status: 'done', ...result },
            [`activity_logs/store_${createdAt}`]: { uid: 'system', username: 'Toko Otomatis', role: 'system', action: pesan, timestamp: createdAt },
            [`notifikasi/${createdAt}_toko`]: { tipe: 'toko', pesan, maker: PANEL_AUTHOR, timestamp: createdAt },
        });
    } catch {
        throw new PayError(`Akun sudah dibuat tapi gagal dicatat. Hubungi admin dengan invoice ${order.invoice}.`, 500);
    }
    return { ...result, productName: order.productName, invoice: order.invoice };
}

const tanggalWIB = (ms) => new Date(ms).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) + ' WIB';

function pteroClient(panel, apiKey) {
    return async (path, method = 'GET', body) => {
        const res = await fetch(`https://${panel.host}/api/application${path}`, {
            method,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: body ? JSON.stringify(body) : undefined,
            redirect: 'manual',
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) {
            const detail = data?.errors?.map(e => e.detail).join('; ') || text.slice(0, 200);
            throw new PayError(`Panel error ${res.status}: ${detail}`, 502);
        }
        return data;
    };
}

// Kunci order supaya 1 pembayaran hanya menghasilkan 1 panel (pakai ETag Firebase)
async function claimProvision(env, nexId) {
    const auth = env.FIREBASE_SECRET ? `?auth=${env.FIREBASE_SECRET}` : '';
    const url = `${FIREBASE_URL}/store_orders/${nexId}/provision.json${auth}`;
    const cur = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    if (!cur.ok) throw new Error(`Firebase GET provision: ${cur.status}`);
    const state = await cur.json();
    if (state?.status === 'done') throw new PayError('Pesanan ini sudah diproses sebelumnya.', 409);
    if (state?.status === 'processing' && Date.now() - state.at < PROVISION_LOCK_MS) {
        throw new PayError('Pesanan sedang diproses, tunggu sebentar lalu coba lagi.', 409);
    }
    const put = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'if-match': cur.headers.get('ETag') },
        body: JSON.stringify({ status: 'processing', at: Date.now() }),
    });
    if (put.status === 412) throw new PayError('Pesanan sedang diproses, tunggu sebentar lalu coba lagi.', 409);
    if (!put.ok) throw new Error(`Firebase PUT provision: ${put.status}`);
}

async function provisionPanel(env, nexId, order, input) {
    // 1. Validasi input pembeli
    const username = String(input.username || '').trim().toLowerCase();
    const password = String(input.password || '');
    const serverName = String(input.serverName || '').trim();
    const phone = String(input.phone || '').replace(/\D/g, '');
    const eggId = parseInt(input.eggId);
    if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username)) throw new PayError('Username 3-30 karakter: huruf kecil, angka, titik, strip, atau underscore.');
    if (password.length < 8 || password.length > 72) throw new PayError('Password minimal 8 karakter.');
    if (!/^\d{9,15}$/.test(phone)) throw new PayError('Nomor telepon tidak valid.');

    // 2. Order harus asli dari Worker ini dan produknya bisa diproses otomatis
    if (!order.sig || order.sig !== await signOrder(env, nexId, order.productId, order.amount)) {
        throw new PayError('Order tidak valid.', 403);
    }
    const product = await firebaseRest(env, `store_products/${order.productId}`);
    const spec = jenisProduk(product);
    if (!spec) throw new PayError('Produk ini tidak bisa diproses otomatis. Hubungi admin.', 400);
    const panel = spec.type === 'panel' ? PANELS[spec.mode] : null;
    if (spec.type === 'panel') {
        if (!serverName || serverName.length > 50) throw new PayError('Nama server wajib diisi (maks. 50 karakter).');
        if (!EGG_IMAGES[eggId]) throw new PayError('Lingkungan server tidak valid.');
        if (!panel) throw new PayError('Panel untuk produk ini tidak dikenal. Hubungi admin.', 400);
    }
    const apiKey = panel && env[panel.key];
    if (panel && !apiKey) throw new PayError('Panel API key not configured in Worker', 500);

    // 3. Cek ulang ke gateway, jangan percaya status di Firebase
    const pay = await payApi(env, '/charge/status', { nexpay_transaction_id: nexId });
    if (!PAID_STATUSES.includes(payStatus(pay)) || Number(pay.amount) !== Number(order.amount)) {
        throw new PayError('Pembayaran belum terverifikasi lunas.', 402);
    }

    await claimProvision(env, nexId);
    if (spec.type === 'role') {
        try {
            return await buatAkunWebsite(env, nexId, order, spec, { username, password, phone });
        } catch (error) {
            if (!(error instanceof PayError && error.status === 500)) {
                await firebaseRest(env, `store_orders/${nexId}/provision`, 'DELETE').catch(() => {});
            }
            throw error;
        }
    }
    const ptero = pteroClient(panel, apiKey);
    let userId = null;
    let serverDibuat = false;
    try {
        // 4. Username harus unik; email = nomor telepon @gmail.com (kalau sudah dipakai, pakai alias +kode)
        const sama = (list, field, value) => (list?.data || []).some(u => String(u.attributes?.[field]).toLowerCase() === value);
        if (sama(await ptero(`/users?filter[username]=${encodeURIComponent(username)}`), 'username', username)) {
            throw new PayError('Username sudah dipakai, pilih username lain.', 409);
        }
        let email = `${phone}@gmail.com`;
        if (sama(await ptero(`/users?filter[email]=${encodeURIComponent(email)}`), 'email', email)) {
            email = `${phone}+${nexId.slice(-6)}@gmail.com`;
        }

        const createdAt = Date.now();
        const expiredAt = createdAt + PANEL_DAYS * 24 * 60 * 60 * 1000;

        const user = await ptero('/users', 'POST', {
            email, username, first_name: username, last_name: PANEL_AUTHOR, password, root_admin: false,
        });
        userId = user.attributes.id;

        // 5. Cari port kosong (sama dengan getFreeNodeAndAllocation)
        const nodes = (await ptero('/nodes'))?.data || [];
        let nodesInLoc = nodes.filter(n => parseInt(n.attributes?.location_id) === DEPLOY.locationId);
        if (!nodesInLoc.length) nodesInLoc = nodes;
        let alloc = null;
        for (const node of nodesInLoc) {
            for (let page = 1, total = 1; page <= total && !alloc; page++) {
                const res = await ptero(`/nodes/${node.attributes.id}/allocations?page=${page}`);
                alloc = (res?.data || []).find(a => a.attributes?.assigned === false);
                if (alloc) alloc = { nodeId: node.attributes.id, allocId: alloc.attributes.id };
                total = res?.meta?.pagination?.total_pages || 1;
            }
            if (alloc) break;
        }
        if (!alloc) throw new PayError('Semua port panel sedang penuh. Hubungi admin.', 503);

        // 6. Environment egg (sama dengan getDynamicEnvironment)
        let environment = { INST: 'npm', USER_UPLOAD: '0', AUTO_UPDATE: '0', CMD_RUN: 'npm start' };
        try {
            const egg = await ptero(`/nests/${DEPLOY.nestId}/eggs/${eggId}?include=variables`);
            const preset = { PY_FILE: 'app.py', REQUIREMENTS_FILE: 'requirements.txt', MAIN_FILE: 'index.js', CMD_RUN: 'npm start', INST: 'npm', USER_UPLOAD: '0', AUTO_UPDATE: '0' };
            environment = {};
            for (const v of egg.attributes.relationships.variables.data) {
                const a = v.attributes;
                if (a.env_variable in preset) environment[a.env_variable] = preset[a.env_variable];
                else if (a.rules.includes('required')) environment[a.env_variable] = a.default_value || 'default';
            }
        } catch {}

        const server = await ptero('/servers', 'POST', {
            name: serverName,
            description: `Pembelian toko: ${order.productName} (${order.invoice}). Dibuat: ${tanggalWIB(createdAt)}. Expired: ${tanggalWIB(expiredAt)}.`,
            user: userId,
            node: alloc.nodeId,
            allocation: { default: alloc.allocId },
            egg: eggId,
            docker_image: EGG_IMAGES[eggId],
            startup: STARTUP,
            environment,
            limits: { memory: parseInt(spec.ram) || 0, swap: 0, disk: parseInt(spec.disk) || 0, io: 500, cpu: parseInt(spec.cpu) || 0 },
            feature_limits: { databases: 5, backups: 5, allocations: 1 },
        });
        serverDibuat = true;

        // 7. Catat expired (dibaca Auto-Sweeper), order, log aktivitas, notifikasi
        const domainKey = panel.host.replace(/\./g, '_');
        const pesan = `[${spec.mode}] Toko: panel ${username} (${order.productName}) dibuat otomatis untuk ${phone}, invoice ${order.invoice}. Expired ${tanggalWIB(expiredAt)}.`;
        const result = {
            kind: 'panel', username, email, phone, serverName,
            userId, serverId: server.attributes.id, mode: spec.mode,
            panelUrl: `https://${panel.host}`,
            ram: parseInt(spec.ram) || 0, disk: parseInt(spec.disk) || 0, cpu: parseInt(spec.cpu) || 0,
            createdAt, expiredAt,
        };
        await firebaseRest(env, '', 'PATCH', {
            [`ptero_users_expired/${domainKey}/${userId}`]: { expiredAt, username, maker: PANEL_AUTHOR },
            [`store_orders/${nexId}/provision`]: { status: 'done', ...result },
            [`store_orders/${nexId}/status`]: payStatus(pay),
            [`activity_logs/store_${createdAt}`]: { uid: 'system', username: 'Toko Otomatis', role: 'system', action: pesan, timestamp: createdAt },
            [`notifikasi/${createdAt}_toko`]: { tipe: 'toko', pesan, maker: PANEL_AUTHOR, timestamp: createdAt },
        });
        return { ...result, productName: order.productName, invoice: order.invoice };
    } catch (error) {
        // Server sudah jadi tapi gagal dicatat: jangan dihapus, biar admin yang membereskan
        if (serverDibuat) throw new PayError(`Panel sudah dibuat tapi gagal dicatat. Hubungi admin dengan invoice ${order.invoice}.`, 500);
        // Gagal di tengah jalan: hapus user yang terlanjur dibuat dan lepas kunci supaya pembeli bisa coba lagi
        if (userId) await ptero(`/users/${userId}`, 'DELETE').catch(() => {});
        await firebaseRest(env, `store_orders/${nexId}/provision`, 'DELETE').catch(() => {});
        throw error;
    }
}

// ==========================================
// AUTO-SWEEPER EXPIRED (jalan di Cloudflare, tidak perlu ada yang buka website)
//   expiredAt tercapai            -> server di-SUSPEND (masa tenggang dimulai)
//   expiredAt + GRACE_DAYS lewat  -> server/user DIHAPUS permanen
//   diperpanjang / timer dihapus  -> server yang di-suspend sweeper otomatis di-UNSUSPEND
//   Notifikasi: ditulis ke Firebase `notifikasi/` dan ditampilkan sebagai lonceng di website
// ==========================================
const FIREBASE_URL = 'https://cobaaja-ac5d0-default-rtdb.firebaseio.com';

// Harus sama dengan GlobalConfig.getGraceDays() di config.js
const GRACE_DAYS = 3;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;
const WARN_MS = GRACE_MS; // pengingat: expired dalam 3 hari ke depan masuk ringkasan harian

// Cloudflare free plan membatasi 50 subrequest per eksekusi.
const SUBREQUEST_BUDGET = 45;

const ok = (status) => status === 204 || status === 200 || status === 404; // 404 = sudah tidak ada

async function sweepExpired(env, scheduledTime) {
    let budget = SUBREQUEST_BUDGET;
    const now = Date.now();
    const updates = {}; // ditulis sekaligus ke Firebase di akhir (1 request)
    const aksi = [];    // ringkasan jumlah aksi untuk log konsol
    const segeraExpired = []; // akan expired dalam WARN_MS (untuk ringkasan harian)
    const jumlahTenggang = {}; // per mode: server/user yang sedang masa tenggang
    let logSeq = 0;

    const firebase = async (path, method = 'GET', body) => {
        budget--;
        const auth = env.FIREBASE_SECRET ? `?auth=${env.FIREBASE_SECRET}` : '';
        const res = await fetch(`${FIREBASE_URL}/${path}.json${auth}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) throw new Error(`Firebase ${method} ${path}: ${res.status}`);
        return res.json();
    };

    // Satu aksi = dua catatan: Log Aktivitas (riwayat) dan notifikasi (lonceng di website)
    const log = (action, maker) => {
        const key = `${now}_${logSeq++}`;
        updates[`activity_logs/sweeper_${key}`] = {
            uid: 'system', username: 'Auto-Sweeper', role: 'system', action, timestamp: Date.now(),
        };
        updates[`notifikasi/${key}`] = { tipe: 'sweeper', pesan: action, maker: maker || 'system', timestamp: Date.now() };
        aksi.push(action);
    };

    for (const [mode, panel] of Object.entries(PANELS)) {
        const apiKey = env[panel.key];
        if (!apiKey || budget < 5) continue;
        const domainKey = panel.host.replace(/\./g, '_');

        const ptero = async (path, method = 'GET') => {
            budget--;
            const res = await fetch(`https://${panel.host}/api/application${path}`, {
                method,
                headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                redirect: 'manual',
            });
            return { status: res.status, data: method === 'GET' && res.ok ? await res.json() : null };
        };

        // Jalankan aksi ke beberapa server; true kalau semuanya berhasil
        const serversAction = async (ids, action) => {
            for (const id of ids) {
                if (budget < 2) return false;
                const path = action === 'delete' ? `/servers/${id}/force` : `/servers/${id}/${action}`;
                const { status } = await ptero(path, action === 'delete' ? 'DELETE' : 'POST');
                if (!ok(status)) return false;
            }
            return true;
        };

        // null = user tidak ada di panel, undefined = gagal baca
        const userServerIds = async (userId) => {
            const { status, data } = await ptero(`/users/${userId}?include=servers`);
            if (status === 404) return null;
            if (status !== 200) return undefined;
            return (data?.attributes?.relationships?.servers?.data || []).map(s => s.attributes.id);
        };

        const [serverRecs, userRecs, state] = await Promise.all([
            firebase(`ptero_servers_expired/${domainKey}`),
            firebase(`ptero_users_expired/${domainKey}`),
            firebase(`ptero_sweeper_state/${domainKey}`),
        ]).then(r => r.map(x => x || {}));
        const serverState = state.servers || {};
        const userState = state.users || {};
        jumlahTenggang[mode] = Object.keys(serverState).length + Object.keys(userState).length;

        const catatSegera = (jenis, id, rec) => {
            const sisa = Number(rec?.expiredAt) - now;
            if (sisa > 0 && sisa <= WARN_MS) {
                segeraExpired.push({ mode, jenis, id, nama: rec?.serverName || rec?.username || '#' + id, maker: rec?.maker, sisa });
            }
        };

        // ---------- SERVER ----------
        for (const id of new Set([...Object.keys(serverRecs), ...Object.keys(serverState)])) {
            if (budget < 3) break;
            const rec = serverRecs[id];
            const suspended = serverState[id];
            const expiredAt = Number(rec?.expiredAt) || 0;
            const recPath = `ptero_servers_expired/${domainKey}/${id}`;
            const statePath = `ptero_sweeper_state/${domainKey}/servers/${id}`;
            const label = `Server #${id} (${rec?.serverName || '-'}) milik ${rec?.maker || '-'}`;

            if (expiredAt && now >= expiredAt + GRACE_MS) {
                if (await serversAction([id], 'delete')) {
                    updates[recPath] = null;
                    updates[statePath] = null;
                    log(`[${mode}] ${label} dihapus permanen (masa tenggang ${GRACE_DAYS} hari habis).`, rec?.maker);
                }
            } else if (expiredAt && now >= expiredAt) {
                if (!suspended && await serversAction([id], 'suspend')) {
                    updates[statePath] = { suspendedAt: now };
                    log(`[${mode}] ${label} di-suspend karena expired. Dihapus permanen dalam ${GRACE_DAYS} hari jika tidak diperpanjang.`, rec?.maker);
                }
            } else if (suspended) {
                // Diperpanjang atau timer dihapus selama masa tenggang
                if (await serversAction([id], 'unsuspend')) {
                    updates[statePath] = null;
                    log(`[${mode}] ${label} dipulihkan (unsuspend) karena masa aktif diperbarui.`, rec?.maker);
                }
            } else {
                catatSegera('server', id, rec);
            }
        }

        // ---------- USER (beserta semua servernya) ----------
        for (const id of new Set([...Object.keys(userRecs), ...Object.keys(userState)])) {
            if (parseInt(id) === 1) continue; // akun root panel tidak pernah disentuh
            if (budget < 4) break;
            const rec = userRecs[id];
            const suspended = userState[id];
            const expiredAt = Number(rec?.expiredAt) || 0;
            const recPath = `ptero_users_expired/${domainKey}/${id}`;
            const statePath = `ptero_sweeper_state/${domainKey}/users/${id}`;
            const label = `User ${rec?.username || '#' + id} milik ${rec?.maker || '-'}`;

            const expired = expiredAt && now >= expiredAt;
            if (!expired && !suspended) { catatSegera('user', id, rec); continue; }
            if (expired && suspended && now < expiredAt + GRACE_MS) continue; // sudah di-suspend, tunggu masa tenggang

            const ids = await userServerIds(id);
            if (ids === undefined) continue; // panel error, coba lagi nanti
            if (ids === null) { // user sudah tidak ada di panel
                updates[recPath] = null;
                updates[statePath] = null;
                continue;
            }

            if (expired && now >= expiredAt + GRACE_MS) {
                if (await serversAction(ids, 'delete') && budget >= 1) {
                    const { status } = await ptero(`/users/${id}`, 'DELETE');
                    if (ok(status)) {
                        updates[recPath] = null;
                        updates[statePath] = null;
                        log(`[${mode}] ${label} beserta ${ids.length} server dihapus permanen (masa tenggang ${GRACE_DAYS} hari habis).`, rec?.maker);
                    }
                }
            } else if (expired) {
                if (!suspended && await serversAction(ids, 'suspend')) {
                    updates[statePath] = { suspendedAt: now };
                    log(`[${mode}] ${label} expired: ${ids.length} server di-suspend. Dihapus permanen dalam ${GRACE_DAYS} hari jika tidak diperpanjang.`, rec?.maker);
                }
            } else if (await serversAction(ids, 'unsuspend')) {
                updates[statePath] = null;
                log(`[${mode}] ${label} dipulihkan: ${ids.length} server di-unsuspend karena masa aktif diperbarui.`, rec?.maker);
            }
        }
    }

    // Ringkasan harian: 08:00 WIB = 01:00 UTC (cron */5, jadi cukup menit 00-04). Hanya untuk pemilik.
    const t = new Date(scheduledTime || now);
    if (t.getUTCHours() === 1 && t.getUTCMinutes() < 5) {
        const soon = segeraExpired.sort((a, b) => a.sisa - b.sisa)
            .map(x => `• [${x.mode}] ${x.jenis === 'user' ? 'User' : 'Server'} ${x.nama} (${x.maker || '-'}), sisa ${(x.sisa / 86400000).toFixed(1)} hari`);
        const tenggang = Object.entries(jumlahTenggang).map(([m, n]) => `• [${m}] ${n}`);
        updates[`notifikasi/${now}_ringkasan`] = {
            tipe: 'ringkasan',
            pesan: `Akan expired dalam ${WARN_MS / 86400000} hari (${soon.length}):\n` + (soon.length ? soon.join('\n') : '• Tidak ada') +
                   `\n\nSedang masa tenggang (suspend):\n` + (tenggang.length ? tenggang.join('\n') : '• Tidak ada'),
            maker: 'system',
            timestamp: now,
        };
    }

    if (Object.keys(updates).length) {
        await firebase('', 'PATCH', updates);
    }
    console.log(`[Sweeper] Selesai. ${aksi.length} aksi, sisa budget ${budget}.`);
}
