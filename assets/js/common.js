// =============================================
// ZEROIXDARK MINECRAFT EDITION - COMMON JS
// Dibuat dengan dedikasi penuh oleh Lina untukmu, Sayang ❤️
/* eslint-disable */
// =============================================

const WORKER_URL = "https://restless-truth-9b75.amisterious09.workers.dev";
const FIREBASE_DB_URL = "https://cobaaja-ac5d0-default-rtdb.firebaseio.com";

// Mode Configuration (WAJIB sesuai permintaanmu)
const modeConfig = {
  private: {
    domain: "privateserverzeroix.bypstar7.web.id",
    api: "ptla_FN9WdJ1WzLH1BlGyzyeoWtZGDl9roNeAd8VVmz7g5tF",
    allowedRoles: ["pemilik", "reseller_private"],
    title: "Kelola Server Private",
    heading: "Manajemen Server Private",
    color: "#5D9C3E"
  },
  public: {
    domain: "publikzero.bypstar7.web.id",
    api: "ptla_YTtzIHJr2S10NFRokBa3SQHHwM5NJrrXLnlSc2JibUv",
    allowedRoles: ["pemilik", "partner_public", "reseller_public"],
    title: "Kelola Server Public",
    heading: "Manajemen Server Public",
    color: "#E3B23C"
  },
  public_v2: {
    domain: "zerropubv2.bypstar7.web.id",
    api: "ptla_eJXEQcFYVuOYBFqhmHDb0bdm7uUaeQbBoqwrRUQbJbh",
    allowedRoles: ["pemilik", "partner_public_v2", "reseller_public_v2"],
    title: "Kelola Server Public V2",
    heading: "Manajemen Server Public V2",
    color: "#4A90E2"
  }
};

// Firebase Init (compat untuk kemudahan)
let firebaseApp;
let database;

function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.error("Firebase SDK belum dimuat!");
    return null;
  }
  if (!firebaseApp) {
    firebaseApp = firebase.initializeApp({
      databaseURL: FIREBASE_DB_URL
    });
    database = firebase.database();
  }
  return database;
}

function getDatabase() {
  if (!database) initFirebase();
  return database;
}

// Helper untuk mendapatkan mode dari URL
function getCurrentMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode && modeConfig[mode]) return mode;
  // Default ke private jika tidak ada atau tidak valid
  if (!mode) {
    // Auto set ke private di URL tanpa reload jika diperlukan
    return 'private';
  }
  return 'private';
}

// Set mode dan update URL
function setMode(newMode) {
  if (!modeConfig[newMode]) return;
  const url = new URL(window.location.href);
  url.searchParams.set('mode', newMode);
  window.history.pushState({}, '', url);
  // Trigger custom event agar halaman bisa listen
  window.dispatchEvent(new CustomEvent('modeChanged', { detail: { mode: newMode } }));
}

// Navigasi antar halaman dengan mempertahankan mode
function navigateTo(page) {
  const mode = getCurrentMode();
  let url = page;
  if (!page.includes('?')) {
    url = `${page}?mode=${mode}`;
  }
  window.location.href = url;
}

// Cek autentikasi
function getCurrentUser() {
  try {
    const userStr = localStorage.getItem('zeroix_user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

function requireAuth() {
  const user = getCurrentUser();
  if (!user || !user.loggedIn) {
    window.location.href = 'login.html';
    return false;
  }
  return user;
}

function logout() {
  localStorage.removeItem('zeroix_user');
  window.location.href = 'login.html';
}

// Notifikasi Minecraft style
function showNotification(message, type = 'success') {
  const notif = document.createElement('div');
  notif.className = `fixed bottom-4 right-4 z-[9999] px-6 py-4 border-4 text-white font-bold flex items-center gap-3 transition-all
    ${type === 'success' ? 'bg-[#5D9C3E] border-[#2E4A1F]' : 
      type === 'error' ? 'bg-red-700 border-red-900' : 'bg-[#E3B23C] border-[#8B5A2B]'}`;
  notif.innerHTML = `
    <span class="text-2xl">${type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️'}</span>
    <span class="font-['Press_Start_2P'] text-sm">${message}</span>
  `;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.opacity = '0';
    setTimeout(() => notif.remove(), 300);
  }, 2800);
}

// Modal Konfirmasi Minecraft Style
function createModal(title, contentHTML, onConfirm, confirmText = "YA, LANJUTKAN") {
  // Hapus modal lama jika ada
  const old = document.getElementById('mc-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'mc-modal';
  modal.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/70 p-4';
  
  modal.innerHTML = `
    <div class="bg-[#3D3D3D] border-4 border-[#222] w-full max-w-lg rounded shadow-2xl overflow-hidden">
      <!-- Header Modal -->
      <div class="bg-[#2C2C2C] px-6 py-4 border-b-4 border-[#222] flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-3xl">⛏️</span>
          <h3 class="font-['Press_Start_2P'] text-[#E3B23C] text-lg">${title}</h3>
        </div>
        <button onclick="document.getElementById('mc-modal').remove()" class="text-[#E0E0E0] hover:text-white text-3xl leading-none">&times;</button>
      </div>
      
      <!-- Body -->
      <div class="p-6 text-[#E0E0E0]">
        ${contentHTML}
      </div>
      
      <!-- Footer -->
      <div class="bg-[#2C2C2C] px-6 py-4 border-t-4 border-[#222] flex gap-3 justify-end">
        <button onclick="document.getElementById('mc-modal').remove()" 
                class="px-6 py-3 bg-[#4A4A4A] hover:bg-[#5A5A5A] border-2 border-[#222] text-white font-bold text-sm transition-all active:translate-y-0.5">
          BATAL
        </button>
        <button id="modal-confirm-btn"
                class="px-8 py-3 bg-[#5D9C3E] hover:bg-[#4A7A2E] border-4 border-[#2E4A1F] text-white font-['Press_Start_2P'] text-sm transition-all active:translate-y-1">
          ${confirmText}
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const confirmBtn = modal.querySelector('#modal-confirm-btn');
  if (confirmBtn && onConfirm) {
    confirmBtn.onclick = () => {
      modal.remove();
      onConfirm();
    };
  }
  
  return modal;
}

// Wrapper untuk memanggil Pterodactyl API via Cloudflare Worker
async function pteroApiCall(mode, path, method = 'GET', data = null) {
  const config = modeConfig[mode];
  if (!config) throw new Error("Mode tidak valid");

  const targetUrl = `https://${config.domain}/api/application${path}`;
  const proxyUrl = `${WORKER_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

  const headers = {
    'Authorization': `Bearer ${config.api}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  };

  const options = {
    method: method,
    headers: headers
  };

  if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(proxyUrl, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pterodactyl API Error (${response.status}): ${errorText}`);
    }
    
    if (response.status === 204) return { success: true };
    return await response.json();
  } catch (err) {
    console.error("Ptero API Call Failed:", err);
    throw err;
  }
}

// Firebase Helpers
function getUsersRef(mode) {
  return getDatabase().ref(`zeroixdark/managed_users/${mode}`);
}

function getServersRef(mode) {
  return getDatabase().ref(`zeroixdark/managed_servers/${mode}`);
}

function getExpiredRef(mode) {
  return getDatabase().ref(`zeroixdark/expired/${mode}`);
}

function getLogsRef() {
  return getDatabase().ref('zeroixdark/activity_logs');
}

// Simpan / Update User ke Firebase
async function saveManagedUser(mode, userData) {
  const ref = getUsersRef(mode);
  if (userData.id) {
    // Update existing
    await ref.child(userData.id).update(userData);
    return userData.id;
  } else {
    // Create new with push key
    const newRef = ref.push();
    await newRef.set({
      ...userData,
      created_at: new Date().toISOString()
    });
    return newRef.key;
  }
}

// Simpan Server
async function saveManagedServer(mode, serverData) {
  const ref = getServersRef(mode);
  if (serverData.id) {
    await ref.child(serverData.id).update(serverData);
    return serverData.id;
  } else {
    const newRef = ref.push();
    await newRef.set({
      ...serverData,
      created_at: new Date().toISOString()
    });
    return newRef.key;
  }
}

// Log Aktivitas
async function logActivity(action, details = {}, mode = null) {
  const user = getCurrentUser();
  const logRef = getLogsRef();
  
  await logRef.push({
    action,
    details,
    mode: mode || getCurrentMode(),
    username: user ? user.username : 'unknown',
    timestamp: new Date().toISOString()
  });
}

// Format tanggal
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('id-ID', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Cek apakah expired
function isExpired(expiredAt) {
  if (!expiredAt) return false;
  return new Date(expiredAt) < new Date();
}

// Tambah hari ke expired
function addDaysToDate(dateStr, days) {
  const date = new Date(dateStr || Date.now());
  date.setDate(date.getDate() + parseInt(days));
  return date.toISOString();
}

// Loading state sederhana
function setLoading(element, isLoading, loadingText = "MEMUAT...") {
  if (!element) return;
  if (isLoading) {
    element.dataset.originalText = element.innerHTML;
    element.innerHTML = `<span class="animate-pulse">⛏️ ${loadingText}</span>`;
    element.disabled = true;
  } else {
    element.innerHTML = element.dataset.originalText || element.innerHTML;
    element.disabled = false;
  }
}

// Inisialisasi mode switcher (panggil di setiap halaman)
function initModeSwitcher() {
  const currentMode = getCurrentMode();
  const switcherContainer = document.getElementById('mode-switcher');
  if (!switcherContainer) return;

  switcherContainer.innerHTML = '';
  
  Object.keys(modeConfig).forEach(modeKey => {
    const cfg = modeConfig[modeKey];
    const btn = document.createElement('button');
    btn.className = `px-4 py-2 text-xs font-bold border-2 transition-all flex items-center gap-2
      ${currentMode === modeKey 
        ? 'bg-[#5D9C3E] border-[#2E4A1F] text-white' 
        : 'bg-[#3D3D3D] border-[#222] text-[#E0E0E0] hover:bg-[#4A4A4A]'}`;
    
    btn.innerHTML = `
      <span>${modeKey === 'private' ? '🔒' : modeKey === 'public' ? '🌍' : '🌐'}</span>
      <span>${cfg.title.replace('Kelola Server ', '')}</span>
    `;
    
    btn.onclick = () => {
      setMode(modeKey);
      // Reload halaman agar data fresh
      window.location.reload();
    };
    
    switcherContainer.appendChild(btn);
  });
}

// Inisialisasi header umum (topbar + sidebar nav)
function initCommonUI() {
  const user = getCurrentUser();
  if (!user) return;

  // Topbar user info
  const userInfoEl = document.getElementById('user-info');
  if (userInfoEl) {
    userInfoEl.innerHTML = `
      <div class="hidden md:flex items-center gap-3 bg-[#2C2C2C] border-2 border-[#222] px-4 py-2 rounded">
        <div class="w-8 h-8 bg-[#5D9C3E] flex items-center justify-center text-white text-xl border border-[#2E4A1F]">👤</div>
        <div>
          <div class="text-[#E3B23C] text-sm font-bold">${user.username.toUpperCase()}</div>
          <div class="text-[#888] text-[10px]">ROLE: ${user.role.toUpperCase()}</div>
        </div>
        <button onclick="logout()" class="ml-4 text-red-400 hover:text-red-500 text-xs px-3 py-1 border border-red-900 hover:bg-red-950">KELUAR</button>
      </div>
    `;
  }

  // Inisialisasi mode switcher
  initModeSwitcher();

  // Highlight menu aktif
  const currentPage = window.location.pathname.split('/').pop();
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.includes(currentPage)) {
      link.classList.add('!bg-[#5D9C3E]', '!border-[#2E4A1F]', 'text-white');
      link.classList.remove('bg-[#3D3D3D]');
    }
  });
}

// Auto init Firebase saat script dimuat
if (typeof firebase !== 'undefined') {
  initFirebase();
}

// Expose global untuk debug jika perlu
window.ZeroixDark = { getCurrentMode, modeConfig, pteroApiCall, logActivity };

// ==================== GLOBAL HAMBURGER MENU (reusable untuk semua halaman) ====================
function initHamburgerMenu() {
  const btn = document.getElementById('hamburger-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    let drawer = document.getElementById('mobile-drawer');
    if (drawer) {
      drawer.remove();
      return;
    }

    const mode = getCurrentMode();
    const user = getCurrentUser();

    drawer = document.createElement('div');
    drawer.id = 'mobile-drawer';
    drawer.className = 'fixed inset-0 z-[99999] bg-black/70 md:hidden';
    drawer.innerHTML = `
      <div class="absolute right-0 top-0 h-full w-72 bg-[#2C2C2C] border-l-4 border-[#222] p-6 overflow-y-auto">
        <div class="flex justify-between items-center mb-6">
          <span class="mc-font text-[#E3B23C] text-xl">MENU</span>
          <button onclick="document.getElementById('mobile-drawer').remove()" class="text-3xl text-[#888]">&times;</button>
        </div>

        <div class="mb-6 p-4 bg-[#1C2526] border border-[#222]">
          <div class="text-[#E3B23C] font-bold">${user ? user.username.toUpperCase() : ''}</div>
          <div class="text-xs text-[#888]">ROLE: ${user ? user.role.toUpperCase() : ''}</div>
        </div>

        <div class="mb-2 text-xs text-[#E3B23C] tracking-wider">GANTI MODE</div>
        <div class="space-y-2 mb-6">
          ${Object.keys(modeConfig).map(m => {
            const cfg = modeConfig[m];
            const active = m === mode ? 'bg-[#5D9C3E] text-white border-[#2E4A1F]' : 'bg-[#3D3D3D] text-[#E0E0E0] border-[#222]';
            return `
              <button onclick="switchModeFromDrawer('${m}')" 
                      class="w-full flex items-center gap-3 px-4 py-3 border-2 ${active} text-left text-sm">
                <span>${m === 'private' ? '🔒' : m === 'public' ? '🌍' : '🌐'}</span>
                <span>${cfg.title}</span>
              </button>
            `;
          }).join('')}
        </div>

        <button onclick="logout(); document.getElementById('mobile-drawer').remove();" 
                class="w-full py-3 text-sm border-2 border-red-900 text-red-400 hover:bg-red-950">
          KELUAR DARI PANEL
        </button>
      </div>
    `;
    document.body.appendChild(drawer);

    drawer.addEventListener('click', (e) => {
      if (e.target === drawer) drawer.remove();
    });
  });
}

function switchModeFromDrawer(newMode) {
  const drawer = document.getElementById('mobile-drawer');
  if (drawer) drawer.remove();
  setMode(newMode);
  window.location.reload();
}

// Auto init hamburger di semua halaman (jika tombol ada)
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (document.getElementById('hamburger-btn')) {
      initHamburgerMenu();
    }
  }, 400);
});
