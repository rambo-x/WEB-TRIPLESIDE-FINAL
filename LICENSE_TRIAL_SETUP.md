# TripleSide License & Trial Setup

## Fitur
- Batas aktivasi per produk: 1–3 komputer.
- Trial per produk, default 7 hari.
- Satu trial per akun untuk setiap produk.
- Trial terikat ke satu komputer dan memiliki `expires_at` yang ditandatangani RSA.
- Serial penuh dibuat setelah pembayaran sukses dan dikirim lewat email Resend.
- Dashboard customer menampilkan perangkat aktif dan tombol deaktivasi.

## Pengaturan produk di Admin Dashboard
Aktifkan **Requires RSA License**, pilih **Maximum Activations**, aktifkan **Trial Version**, lalu isi **Trial Duration**.

## Endpoint plugin HISE
- `GET /api/license/public-key`
- `POST /api/license/activate`
- `POST /api/license/verify`

Payload aktivasi:
```json
{
  "license_key": "TS-XXXXX-XXXXX-XXXXX-XXXXX",
  "hardware_id": "SYSTEM-ID",
  "machine_name": "Windows"
}
```

Respons bundle RSA sekarang juga memiliki:
- `license_type`: `full` atau `trial`
- `expires_at`: `null` untuk lisensi penuh atau tanggal kedaluwarsa trial

Plugin harus menolak bundle trial saat `expires_at` sudah lewat. Untuk keamanan terbaik, panggil `/api/license/verify` saat online.

## Email
Isi di `backend/.env`:
```env
RESEND_API_KEY=re_xxx
SENDER_EMAIL=TripleSide Studio <license@domain-anda.com>
APP_PUBLIC_URL=https://triplesidestudio.com
```
Domain pengirim harus diverifikasi di Resend.

## Instalasi frontend bersih
Jangan salin `node_modules` dari komputer lain.
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npm start
```
Untuk produksi:
```bash
npm run build
```
