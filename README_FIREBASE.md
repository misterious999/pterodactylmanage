# Firebase Static Website — User Expired + Public V2

Project ini adalah static HTML site untuk Vercel dengan Firebase Realtime Database.

## Model expired terbaru

Expired sekarang berlaku **per user**, bukan per role.

Path data utama:

```txt
/users/{uid}/expiredAt
/users/{uid}/expiredNote
/users/{uid}/expiredUpdatedAt
/users/{uid}/expiredUpdatedBy
/users/{uid}/expiredUpdatedByUid
/users/{uid}/expiredStatus
```

Aturan login:

1. Role `pemilik` selalu exempt dari expired.
2. User non-`pemilik` wajib punya `expiredAt`.
3. Jika `expiredAt` belum ada atau bernilai kosong, user tidak bisa login.
4. Jika `expiredAt <= Date.now()`, user tidak bisa login.
5. Jika `expiredAt > Date.now()`, user bisa login.
6. Jika user sedang login lalu expired-nya dihapus atau sudah lewat, guard halaman akan logout otomatis.

## Fitur addexpired, listexpired, deleteexpired

Halaman: `manage_expired.html`

Hanya role `pemilik` yang bisa membuka halaman ini.

- `addexpired`: tambah/update expired untuk user tertentu.
- `listexpired`: tampilkan semua user non-pemilik dan status login-nya.
- `deleteexpired`: hapus expired dari user. Efeknya user tersebut tidak bisa login sampai diberi expired baru.

## Role yang tersedia

Role lama:

- `pemilik`
- `partner_public`
- `reseller_private`
- `reseller_public`
- `reseller`
- `demo`

Role baru V2:

- `partner_public_v2`
- `reseller_public_v2`

## Halaman baru V2

- `manage_ptero_users_pub_v2.html`
- `manage_ptero_servers_pub_v2.html`

Akses:

- `pemilik`: semua halaman.
- `partner_public_v2`: halaman Public V2 + kelola akses web untuk membuat `reseller_public_v2`.
- `reseller_public_v2`: halaman Public V2.

Catatan: file V2 saat ini memakai konstanta domain/API yang sama dengan Public V1 sebagai placeholder. Jika panel Public V2 punya domain/API berbeda, ubah di dua file berikut:

```js
const PTERO_DOMAIN = "...";
const PTERO_API = "...";
```

## Setup Firebase

1. Buka Firebase Console.
2. Buat Realtime Database.
3. Import `firebase-seed.json` jika database kosong.
4. Upload rules dari `firebase-database.rules.open-static.json` untuk mode static custom-login.
5. Login default:
   - Username: `admin`
   - Password: `pstar7@123`
6. Setelah masuk, segera ganti password admin dari dashboard.

## Catatan keamanan

Karena project ini static custom-login, config Firebase dan API panel ada di frontend. Ini cukup untuk kebutuhan internal/bisnis kecil, tetapi bukan standar keamanan produksi besar. Untuk sistem publik serius, migrasi ke Firebase Auth + Cloud Functions atau backend server-side.
