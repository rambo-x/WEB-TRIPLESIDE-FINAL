# TripleSide Studio — 404 Fix

Perbaikan ini tidak mengubah fondasi backend, database, RSA key, atau struktur project.

## Diperbaiki

- Menambahkan `frontend/.env` untuk development lokal:
  - `REACT_APP_BACKEND_URL=http://127.0.0.1:8000`
- Menambahkan fallback aman di `frontend/src/lib/api.js` jika `.env` frontend belum terbaca.
- Menambahkan timeout dan pesan error API yang lebih jelas.
- Menangani kegagalan request di Home, Songs, Gear, dan Shop agar tidak memunculkan React runtime error overlay.
- Menggunakan satu sumber `BACKEND_URL` untuk download invoice.
- Menghapus blok komentar PostHog yang rusak di `frontend/public/index.html`.

## Hasil pengujian

- Python backend compile: berhasil.
- Frontend production build (`npm run build`): berhasil.

## Menjalankan

Backend (terminal 1):

```bash
cd backend
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

Frontend (terminal 2):

```bash
cd frontend
npm install
npm start
```

Setelah mengganti file konfigurasi frontend, hentikan proses lama dengan Ctrl+C lalu jalankan `npm start` kembali.
