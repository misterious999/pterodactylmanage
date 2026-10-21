# Firebase Static Website — v7.2 (Pasca-Insiden "HACK BY RANDALUXEVA")

**9 Oktober-lewat + 21 Oktober 2026 = situs `zeroixdarkmarket.web.id` di-deface dan
SEMUA password user terbaca orang.** Penyebabnya: rules database lama memakai
`.read: true, .write: true`, jadi siapa pun bisa membaca/menulis seluruh database.
Aplikasi ini sudah dirombak: **database dikunci total dan semua akses data melewati
Cloudflare Worker.**

---

## 1. Penjelasan arsitektur baru (v7.2)

```
Browser (login.html, index.html, dst.)
    │  fetch + Bearer token sesi (HMAC)
    ▼
Cloudflare Worker  zeroix-gatekeeper
    │  ?auth=FIREBASE_SECRET  (menembus rules)
    ▼
Firebase Realtime Database   ── rules: ".read": false, ".write": false
```

- Password **tidak pernah disimpan plaintext lagi**: PBKDF2-SHA256 (120.000 iterasi,
  salt acak) → format `pbkdf2$<iter>$<salt>$<hash>`. Password lama (plaintext) otomatis
  di-upgrade ke hash saat login pertama setelah Worker baru aktif.
- Password tidak lagi disimpan di browser (tidak ada lagi `localStorage panel_password`).
- Token sesi: `v1.<payload>.<hmac>` bertanda tangan `AUTH_SECRET`, masa berlaku 24 jam,
  role/token dipakai untuk aturan tulis per-node (lihat bagian 4).
- Login gagal lebih dari 10x per IP dalam 10 menit → diblokir (429).

### File yang menyusun sistem

| File | Peran |
|---|---|
| `workers.js` | Deploy ke Cloudflare Worker (di-replace penuh) |
| `db-bridge.js` | Pengganti Firebase SDK di semua halaman (baru) |
| `login.html` | Login lewat `/auth/login` (tanpa baca tabel users) |
| `config.js` | `getWorkerUrl()` dipakai `db-bridge.js` sebagai pusat data |

---

## 2. Yang WAJIB kamu lakukan di console (urutan!)

### Langkah 0 — Kunci database SEKARANG
Firebase Console → **Realtime Database → Rules** → paste:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

Situs lama (sebelum upgrade kode) memang macet — itu memang disengaja supaya
hacker tidak bisa menulis lagi.

### Langkah 1 — Ambil Database Secret
Firebase Console → Project Settings → **Service accounts** → tab **Database secrets**
→ tampilkan secret. Simpan aman.

### Langkah 2 — Pastikan env Cloudflare
Cloudflare Dashboard → Workers & Pages → `zeroix-gatekeeper` → Settings →
**Variables and Secrets**:

| Nama | Isi |
|---|---|
| `FIREBASE_SECRET` | Database secret dari langkah 1 |
| `AUTH_SECRET` | String acak panjang (mis. 40+ karakter), demi token sesi |
| `PRVT_API`, `PUB_API`, `PUB_V2_API`, `RAFLYSHOP_PAY_KEY` | (sudah ada sebelumnya) |

Jika `AUTH_SECRET` tidak diisi, fallback ke `FIREBASE_SECRET` (boleh, tapi lebih baik dipisah).

### Langkah 3 — Deploy `workers.js`
Ganti isi Worker lama dengan file `workers.js` dari repo ini → Deploy.
**Jangan sampai env/secret hilang** saat mereplace.

### Langkah 4 — Upload file statis
Push semua file (termasuk `db-bridge.js` baru) ke deploy statis (Vercel / host domain).
File HTML lama TIDAK BOLEH campur dengan worker lama versi lama.

### Langkah 5 — Bersihkan database (lihat `PANDUAN_PEMBERSIHAN.md`)
Hapus akun `barmods` (jika bukan milikmu), ~10 uid sampah, dan reset password
seluruh user.

---

## 3. Aturan mari "siapa boleh apa" (server-side, di Worker)

| Node | Baca | Tulis |
|---|---|---|
| `store_products`, `store_settings`, `store_stats` | publik/anonim | `pemilik` (stats anonim masih bisa ±1/step untuk counter views/likes) |
| `users/{uid sendiri}` | token pemilik akun | data diri: `isOnline, lastLoginAt, updatedAt, usernameLower, profilePic` (password → hanya via `/auth/change-password`) |
| `users/*` lainnya (buat, edit, hapus) | token | `pemilik`; partner `partner_public(v2)` hanya boleh **membuat** akun baru (bukan role `pemilik`) |
| `pengumuman_global` | token / anonim | **hanya `pemilik`** ← pintu deface tadi |
| `activity_logs` | token | push: semua user; hapus: `pemilik` |
| `notifikasi` | token | hapus per-item: semua user; **osongkan semua**: `pemilik` |
| `ptero_users_expired`, `ptero_servers_expired`, `ptero_sweeper_state` | token | semua role kecuali `demo` |
| node tidak dikenal | token | ditolak |

Role `demo` hanya boleh update `isOnline/lastLoginAt` miliknya. Password plaintext yang
masuk ke `/db` selalu di-hash oleh Worker (hash PBKDF2) sebelum disimpan.

**Auto-logout:** token sesi membawa `iat` (waktu terbit). Baris user bisa menyimpan
`passwordChangedAt`. Kapan pun password user berubah — dari dirinya sendiri lewat
menu ganti sandi, atau di-reset oleh admin/pemilik lewat halaman kelola — Worker mematikan
semua token yang terbit **sebelum** momen itu. Efeknya: perangkat lain (atau selah yang
mencuri token) langsung ditendang ke halaman login, meski token-nya baru 5 menit usianya.
Halaman guard membaca baris user secara live tiap polling, jadi perubahan itu kena dalam
±6 detik. Ganti role user juga berlaku setara (role mismatch = sesi mati).

---

## 4. Endpoint Worker baru

| Endpoint | Fungsi |
|---|---|
| `POST /auth/login` | verifikasi username+password → token sesi |
| `GET /auth/verify` | cek token sesi + data user live (tanpa password) |
| `POST /auth/logout` | offline + catat log |
| `POST /auth/change-password` | `{current?, next}` → hash baru **+ mencabut semua sesi user tsb (auto-logout semua perangkat)** |
| `GET/PUT/PATCH/POST/DELETE /db/<path>` | proxy database (token, aturan per role) |
| `/pay/*` | pembayaran QRIS toko (tidak berubah) |
| `/` proxy panel Pterodactyl | tidak berubah |

---

## 5. Setup akun baru & lisensi (tidak berubah secara konsep)

- `pemilik` bebas expired; aplikasi lain wajib punya `expiredAt` > sekarang.
- `manage_expired.html` tetap hanya untuk `pemilik`.
- Akun baru dibuat melalui `manage_panel_users.html` atau otomatis dari pembayaran toko
  (-author/admin via Worker, masa aktif 30 hari).

---

## 6. Test cepat selesai install

1. Password admin-mu login normal? → pastikan.
2. Buka Firebase Console → Realtime Database → pastikan rules `.read: false`.
3. Buka `https://<worker>/auth/verify` tanpa token → harus 401.
4. Klik "Uji Broadcast" dari dashboard → pesan muncul seperti biasa.
5. Buat user demo dari `manage_panel_users.html` → login demo → coba ganti broadcast → harus ditolak.

---

## 7. Catatan keamanan sisa yang perlu kamu putuskan (jadwal guideline)

1. **IMGBB key** di `manage_products.html` masih plaintext di front-end → dapat dirotate kapan saja & set akun; pindahkan ke Worker kalau ingin sempurna.
2. Rate limit login berjalan per-replica Cloudflare — bukan klik jahat se-juta, tapi cukup memperlambat pelaku. Pertimbangkan Cloudflare WAF rule bila serangan besar.
3. Berikan limit iterasi PBKDF2 & TTL token via konstanta di `workers.js` bila mau diubah.
