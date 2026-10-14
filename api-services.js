// api-services.js - Kelas Pusat Manajemen Pterodactyl API
class PteroAPI {
    constructor(mode) {
        this.mode = mode || 'private';
        this.domain = GlobalConfig.getPteroDomain(this.mode);
        this.workerUrl = GlobalConfig.getWorkerUrl().replace(/[\/?]+$/, '');
    }

    // Engine utama pengirim request ke Worker Gatekeeper
    async _request(endpoint, method = 'GET', body = null) {
        const targetUrl = `https://${this.domain}${endpoint}`;
        const fetchUrl = `${this.workerUrl}/?url=${encodeURIComponent(targetUrl)}`;
        
        const options = {
            method: method,
            headers: {
                // Header rahasia buat ngasih tau Worker kunci mana yang harus dipakai
                'X-Panel-Mode': this.mode 
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(fetchUrl, options);
            const text = await response.text();
            
            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${text}`);
            }
            
            // Pterodactyl sering kirim respons kosong saat DELETE/Suspend, ini nge-handle hal itu
            return text ? JSON.parse(text) : null;
        } catch (error) {
            console.error(`[PteroAPI] Gagal eksekusi ${method} ${endpoint}:`, error);
            throw error;
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
    async getServers(page = 1) { 
        return this._request(`/api/application/servers?page=${page}`); 
    }
    
    async createServer(payload) { 
        return this._request('/api/application/servers', 'POST', payload); 
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
}

// ==========================================
// ⏳ COUNTDOWN MASA AKTIF (dipakai halaman server & user)
// Aktif -> SUSPEND (masa tenggang) -> MENUNGGU DIHAPUS. Eksekusinya dikerjakan Worker Cron.
// ==========================================
function renderCountdownExpired(el, expiredAt) {
    const now = Date.now();
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
