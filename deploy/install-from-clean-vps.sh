#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/triplesidestudio/tripleside"
cd "$APP_DIR"

echo "[1/7] Installing backend environment"
python3 -m venv backend/venv
backend/venv/bin/pip install --upgrade pip
backend/venv/bin/pip install -r backend/requirements.txt

echo "[2/7] Building frontend"
cd frontend
npm ci
rm -rf build
npm run build
cd ..

echo "[3/7] Checking backend syntax"
backend/venv/bin/python -m compileall -q backend

echo "[4/7] Starting backend with PM2"
pm2 delete triplesidestudio-backend >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save

echo "[5/7] Installing Nginx configuration"
sudo cp deploy/nginx-triplesidestudio.conf /etc/nginx/sites-available/triplesidestudio
sudo ln -sfn /etc/nginx/sites-available/triplesidestudio /etc/nginx/sites-enabled/triplesidestudio
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "[6/7] Testing local backend"
sleep 3
curl --fail http://127.0.0.1:8000/api/ >/dev/null

echo "[7/7] Complete"
echo "Open https://triplesidestudio.com and verify /api/products."
