// api-services.js - Kelas Pusat Manajemen Pterodactyl API
class PteroAPI {
    constructor(mode) {
        this.mode = mode || 'private';
        this.domain = GlobalConfig.getPteroDomain(this.mode);
        this.workerUrl = GlobalConfig.getWorkerUrl().replace(/[\/?]+$/, '');
    }

    // Engine utama pengirim request ke Worker Gatekeeper
    // timeoutMs: jangan biarkan halaman menggantung di "⏳" kalau Worker/panel
    // tidak terjangkau (mis. DNS workers.dev diblokir ISP).
    async _request(endpoint, method = 'GET', body = null, timeoutMs = 15000) {
        const targetUrl = `https://${this.domain}${endpoint}`;
        // Path relatif berisi query ?url=... — Worker menolak target di luar
        // domain panel mode ini, jadi ini tetap aman walau lewat auto-fallback.
        const fetchPath = `?url=${encodeURIComponent(targetUrl)}`;
        
        const options = {
            method: method,
            headers: {
                // Header rahasia buat ngasih tau Worker kunci mana yang harus dipakai
                'X-Panel-Mode': this.mode 
            }
        };

        // Sesi login wajib dibawa: coreGateway (workers.js) menolak proxy panel
        // tanpa token, karena header Origin bisa dipalsukan lewat curl sehingga
        // Origin saja tidak cukup sebagai penjaga. Kunci tokennya sama dengan
        // TOKEN_KEY di db-bridge.js — dibaca langsung dari localStorage supaya
        // tidak bergantung pada urutan pemuatan script (config -> api-services
        // -> db-bridge).
        let sessionToken = '';
        try { sessionToken = localStorage.getItem('fzb_token') || ''; } catch (e) { sessionToken = ''; }
        if (sessionToken) options.headers['Authorization'] = 'Bearer ' + sessionToken;

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;

        try {
            const response = await GlobalConfig.workerFetch(fetchPath, {
                ...options,
                signal: ctrl ? ctrl.signal : undefined
            });
            const text = await response.text();
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${text}`);
            }
            
            // Pterodactyl sering kirim respons kosong saat DELETE/Suspend, ini nge-handle hal itu
            return text ? JSON.parse(text) : null;
        } catch (error) {
            console.error(`[PteroAPI] Gagal eksekusi ${method} ${endpoint}:`, error);
            if (error && error.name === 'AbortError') {
                const detik = timeoutMs >= 1000 ? Math.round(timeoutMs / 1000) : (timeoutMs / 1000);
                throw new Error(`Timeout ${detik} detik — server data tidak merespons.`);
            }
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // ==========================================
    // 👤 MANAJEMEN USER
    // ==========================================
    async getUsers(page = 1) { 
        return this._request(`/api/application/users?page=${page}`); 
    }
    
    async createUser(payload) { 
        return this._request('/api/application/users', 'POST', payload); 
    }
    
    async deleteUser(userId) { 
        return this._request(`/api/application/users/${userId}`, 'DELETE'); 
    }

    // ==========================================
    // 🖥️ MANAJEMEN SERVER
    // ==========================================
    async getServers(page = 1, timeoutMs = 15000) { 
        return this._request(`/api/application/servers?page=${page}`, 'GET', null, timeoutMs); 
    }
    
    async createServer(payload) { 
        // Provisioning server bisa lebih lama dari request biasa; beri 30 dtk
        // supaya tidak dianggap timeout padahal upstream masih bekerja.
        return this._request('/api/application/servers', 'POST', payload, 30000); 
    }
    
    async deleteServer(serverId) { 
        return this._request(`/api/application/servers/${serverId}/force`, 'DELETE'); 
    }
    
    async suspendServer(serverId) { 
        return this._request(`/api/application/servers/${serverId}/suspend`, 'POST'); 
    }
    
    async unsuspendServer(serverId) { 
        return this._request(`/api/application/servers/${serverId}/unsuspend`, 'POST'); 
    }

    // ==========================================
    // 📡 RADAR ALOKASI & NODE (AUTO-DEPLOY)
    // ==========================================
    async getNodes() { 
        return this._request('/api/application/nodes'); 
    }
    
    async getNodeAllocations(nodeId, page = 1) { 
        return this._request(`/api/application/nodes/${nodeId}/allocations?page=${page}`); 
    }
    
    async getEggVariables(nestId, eggId) { 
        return this._request(`/api/application/nests/${nestId}/eggs/${eggId}?include=variables`); 
    }

    // ==========================================
    // 🎮 GANTI GAME (menukar egg server yang sudah ada)
    // ==========================================
    // Daftar nest+egg diambil dari panel setiap saat — ID egg TIDAK sama antar
    // panel (egg 1 = "Forge" di private, tapi "Paper" di public_v2), jadi tidak
    // boleh di-hardcode.
    async getNests() {
        return this._request('/api/application/nests?include=eggs');
    }

    // Jalur resmi Pterodactyl v1 untuk mengganti game: PATCH ini menerima
    // egg + docker image + startup command + environment SEKALIGUS, tanpa
    // menyentuh limits (RAM/disk/CPU), allocation, pemilik, maupun data lama.
    // Sudah diuji langsung: PATCH valid, PUT ditolak 405.
    async updateServerStartup(serverId, payload) {
        return this._request(`/api/application/servers/${serverId}/startup`, 'PATCH', payload, 30000);
    }

    // Menjalankan script instalasi milik egg baru (mengunduh file game).
    async reinstallServer(serverId) {
        return this._request(`/api/application/servers/${serverId}/reinstall`, 'POST', {}, 30000);
    }
}

// ==========================================
// ⏳ COUNTDOWN MASA AKTIF (dipakai halaman server & user)
// Aktif -> SUSPEND (masa tenggang) -> MENUNGGU DIHAPUS. Eksekusinya dikerjakan Worker Cron.
// ==========================================
function renderCountdownExpired(el, expiredAt) {
    const now = Date.now();

    // ---------- VALIDASI DATA (insiden 28 Okt 2026) ----------
    // Beberapa record lama menyimpan expiredAt RUSAK, mis. 8.640008640001794e+24
    // (hasil "string + number" pada kode versi lama, ditulis akun barmods/Randa).
    // Angka itu bukan tanggal. Ketika lewat parseInt("8.64e+24") hasilnya 8,
    // sehingga jatuh ke cabang terakhir dan tampil "MENUNGGU DIHAPUS" —
    // padahal Auto-Sweeper tidak pernah menyentuh user tersebut.
    // Supaya tidak menyesatkan lagi, nilai tidak wajar ditandai terpisah.
    const MIN_TS = Date.UTC(2020, 0, 1);
    const MAX_TS = Date.UTC(2100, 0, 1);
    if (!Number.isFinite(expiredAt) || expiredAt < MIN_TS || expiredAt > MAX_TS) {
        el.innerText = 'DATA EXPIRED RUSAK';
        el.title = 'Nilai expiredAt di database bukan tanggal yang valid. Perbaiki lewat tombol konfigurasi (+) dan masukkan ulang durasi hari.';
        el.style.color = 'var(--warning)';
        el.style.background = 'rgba(245, 158, 11, 0.12)';
        el.style.borderColor = 'var(--warning)';
        return;
    }

    const deleteAt = expiredAt + GlobalConfig.getGraceDays() * 24 * 60 * 60 * 1000;
    const fmt = (ms) => {
        const d = Math.floor(ms / 86400000);
        const h = Math.floor((ms % 86400000) / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return `${d}h ${h}j ${m}m ${s}d`;
    };
    const paint = (color, bg) => {
        el.style.color = color;
        el.style.background = bg;
        el.style.borderColor = color;
    };

    if (now < expiredAt) {
        el.innerText = fmt(expiredAt - now);
        paint('', '');
    } else if (now < deleteAt) {
        el.innerText = `SUSPEND · hapus ${fmt(deleteAt - now)}`;
        el.title = 'Expired. Server di-suspend, dihapus permanen jika tidak diperpanjang.';
        paint('var(--warning)', 'rgba(245, 158, 11, 0.12)');
    } else {
        el.innerText = 'MENUNGGU DIHAPUS';
        paint('var(--danger)', 'rgba(239, 68, 68, 0.15)');
    }
}
