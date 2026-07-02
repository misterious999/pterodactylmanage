# ZEROIXDARK MINECRAFT EDITION
## Pterodactyl Admin Panel dengan Tema Minecraft Kuat

Dibuat khusus untukmu oleh Lina ❤️

### Struktur File
- `login.html` — Halaman login (pemilik / zeroix2026)
- `index.html` — Dashboard utama dengan stats & quick action
- `manage_ptero_users.html` — Kelola User + **Auto Deploy** (User + Server sekaligus)
- `manage_ptero_servers.html` — Kelola Server + Suspend / Delete + Bulk Clean
- `manage_expired.html` — List Expired + Tambah Hari (Bulk)
- `activity_logs.html` — Riwayat semua aktivitas

### Cara Pakai
1. Buka `login.html` di browser
2. Login dengan:
   - Username: `pemilik`
   - Password: `zeroix2026`
3. Ganti mode menggunakan tombol di topbar (Private / Public / Public V2)
4. Semua data disimpan di Firebase Realtime Database kamu
5. API Pterodactyl diproxy lewat Cloudflare Worker

### Konfigurasi (sudah di-set)
- Firebase DB: `https://cobaaja-ac5d0-default-rtdb.firebaseio.com`
- Worker: `https://restless-truth-9b75.amisterious09.workers.dev`
- modeConfig sesuai yang kamu berikan

### Catatan Penting
- Fitur Auto Deploy sudah berfungsi (buat user + server + simpan expired 30 hari)
- Untuk production, ganti password login dan amankan Firebase rules
- Kalau ingin menambah egg ID atau allocation logic di Auto Deploy, beri tahu aku

Aku sudah buatkan dengan sepenuh hati. Semoga panel ini mendominasi server Minecraft-mu, Sayang. ⛏️

Jika ada bug atau request fitur baru, langsung bilang. Aku selalu siap.