# PANDUAN PEMBERSIHAN & PEMULIHAN — Insiden 21 Oktober 2026

> Screenshot di `Screenshot_20261021-202105.jpg` menampilkan popup broadcast:
> "HACK BY RANDALUXEVA ... AKUN PEMILIK SUDAH DI TANGAN RANDALUXEVA".
> Penyebab: database sebelumnya terbuka untuk dibaca/ditulis siapa pun.
> **Pintunya sudah ditutup oleh refactor v7.2** — tapi sisa pertanggungannya
> wajib malam ini juga.

---

## 1. Jejak yang ditemukan (21 Okt ~20:00–20:30 WIB)

- `pengumuman_global` ditulis bukan oleh kamu: awalnya "HACK BY RANDALUXEVAAA...",
  lalu diganti `"barmods": "ayo semangat ayooo.🔥🔥🔥"` — dua pelaku berbeda atau orang yang sama.
- User `barmods` bergelar **`role: pemilik`** (dibuat 2 Jul). Login terakhir
  **HARI INI jam 20:30 WIB** — persis dulu broadcast-nya muncul.
- Ada user `Randa` (`partner_public_v2`, dibuat 10 Okt) — kemungkinan penting bagi RANDALUXEVA.
- ~10 entri sampah di `users` (uid tanpa isi / duplikat username).

## 2. Malam ini juga (urutan wajib)

1. **Ganti rules database** menjadi kunci total (lihat README_FIREBASE.md — langkah 0).
2. **Login sebagai admin dan GANTI PASSWORD** — password lama admin sudah
   dibaca lancar oleh pelaku, jadi LANGKAH INI PERTAMA. Kalau kamu tidak bisa login,
   pelaku bisa jadi sudah mengubahnya; mini-panik: makanya lakukan
   langkah 1 dulu agar mereka tak bisa menulis apa-apa lagi.
3. Buka `manage_panel_users.html` setelah deploy kode baru (hanya `pemilik`):
   - **hapus akun `barmods`** (bukan akunmu?) ✔
   - pertimbangkan mencabut role/hapus akun `Randa` bila asing
   - hapus 10 entri sampah berikut (uid persis, disalin dari database):

   ```
   -OxA7CBI3uAcMnqj1AeK
   -OxAOheRQ7bTeRJJyArX
   -OxAhf8jalOepUJxlGLR
   -OxL8I8qT6YxfOFs2z5i
   -OzfNaGKt_6640BN_ThU
   -P-i7f3WO3bF473HgiEG
   -P0th9vC9pTZuxEr_jA1
   -P3_QniThc5FZ9iOJBIs
   -P3jXYjsrSipu3YLyAQx
   bianz      (duplikat username; uid sejati: -P1KMY1G8_bgK27wXufo)
   yadya_publik
   ```
4. **Reset password semua user** lain via manage pages — data password lama
   sudah lewat ancaman; user aktif wajib diberi sandi baru.
5. **Rotasi API key Pterodactyl** setiap panelnya (application API keys) →
   isi ulang env Cloudflare `PRVT_API / PUB_API / PUB_V2_API`.
6. **Rotate IMGBB key** di `manage_products.html` (v7.2: bisa dirotat kapan pun).
7. Lihat activity_logs: cari aksi asing (`dibuatOleh`, log push/hapus) bila
   ingin mengejar jejak pelaku.

## 3. Setelah data dikunci total — apa yang hilang sementara?

- Situs tak bisa.. dibaca/ditulis siapa pun sampai Worker baru + rule baru
  (yaitu semua data lewat worker) di-deploy. Toko ordernya tetap jalan karena
  provision pakai secret di Worker.
- Kalau membaca store lama masih jalan tapi dashboard macet, berarti kode
  statis-mu belum updated — upload file hasil refactor (termasuk `db-bridge.js`).

## 4. Kilat — pemeriksaan pasca deploy (ringkas)

- [ ] login `admin` password baru OK
- [ ] password user lain berhasil direset
- [ ] `barmods` & sampah tak lag
- [ ] broadcast hanya bisa diubah kamu
- [ ] login salah 10x → diblokir (silakan coba)
- [ ] database rules `.read: false`
