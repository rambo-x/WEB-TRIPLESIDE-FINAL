# Perubahan versi siap lokal/deploy

- Menghapus dependency privat `emergentintegrations`.
- Mengganti checkout, status, dan webhook Stripe dengan SDK resmi `stripe`.
- Menambahkan verifikasi webhook melalui `STRIPE_WEBHOOK_SECRET`.
- Menangani nilai Stripe untuk mata uang zero-decimal seperti IDR dengan benar.
- Membersihkan `backend/requirements.txt` menjadi dependency yang benar-benar dipakai.
- Menghapus package dan script visual editor Emergent dari frontend.
- Menambahkan contoh konfigurasi `backend/.env.example` dan `frontend/.env.example`.
- Menambahkan panduan lengkap `LOCAL_SETUP.md`.
- Pemeriksaan sintaks seluruh file Python berhasil (`compileall`).

## Hal yang tetap membutuhkan konfigurasi pengguna

- MongoDB harus terpasang/aktif.
- Nilai rahasia di `.env` harus diisi.
- Stripe/Midtrans/Resend/Cloudinary memerlukan kredensial akun masing-masing.
