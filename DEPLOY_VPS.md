# Deploy TripleSide Studio ke VPS Ubuntu

Project ini sudah disiapkan untuk:
- React production build melalui Nginx
- FastAPI pada `127.0.0.1:8000`
- MongoDB lokal
- PM2 menjalankan Uvicorn (bukan `python server.py`)
- API frontend memakai relative URL `/api`

## 1. Upload dan ekstrak

Upload folder sebagai:

```bash
/home/triplesidestudio/tripleside
```

Pastikan file konfigurasi rahasia tersedia di:

```bash
/home/triplesidestudio/tripleside/backend/.env
```

## 2. Pastikan layanan dasar terpasang

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nginx mongodb-org curl
sudo systemctl enable --now nginx mongod
```

Pastikan Node.js, npm, dan PM2 sudah tersedia:

```bash
node -v
npm -v
pm2 -v
```

## 3. Jalankan instalasi otomatis

```bash
cd /home/triplesidestudio/tripleside
chmod +x deploy/install-from-clean-vps.sh
./deploy/install-from-clean-vps.sh
```

## 4. Pasang atau pertahankan HTTPS

Jika sertifikat domain sudah ada:

```bash
sudo certbot --nginx -d triplesidestudio.com -d www.triplesidestudio.com
```

## 5. Verifikasi

```bash
pm2 list
curl http://127.0.0.1:8000/api/
curl https://triplesidestudio.com/api/products
sudo nginx -t
```

Pada browser, request produk harus menuju:

```text
https://triplesidestudio.com/api/products
```

bukan `127.0.0.1`.

## Catatan penting

Jangan menjalankan backend dengan:

```bash
pm2 start backend/server.py --interpreter python
```

`server.py` hanya mendefinisikan aplikasi FastAPI dan akan langsung selesai. Gunakan `ecosystem.config.cjs`, yang menjalankan Uvicorn dengan benar.
