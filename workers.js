// zeroix-gatekeeper - Proxy aman ke Pterodactyl Application API
// API key disimpan di Cloudflare: Settings -> Variables and Secrets (PRVT_API, PUB_API, PUB_V2_API)

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
