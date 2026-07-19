# TripleSide Studio — Local Setup (Windows + Git Bash)

## 1. Prerequisites

- Python 3.11
- Node.js 20 LTS
- MongoDB Community Server (running locally)
- Git Bash

## 2. Backend

From the project root:

```bash
py -3.11 -m venv venv
source venv/Scripts/activate
cd backend
cp .env.example .env
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --reload --host 127.0.0.1 --port 8000
```

API: `http://127.0.0.1:8000`
OpenAPI docs: `http://127.0.0.1:8000/docs`

## 3. Frontend

Open a second Git Bash terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

Website: `http://localhost:3000`

## 4. Stripe local webhook (optional)

Install Stripe CLI, log in, then run:

```bash
stripe listen --forward-to localhost:8000/api/webhook/stripe
```

Copy the displayed `whsec_...` value into `backend/.env` as `STRIPE_WEBHOOK_SECRET`.
Use a Stripe test secret key (`sk_test_...`) for `STRIPE_API_KEY`.

## 5. Production notes

Before deployment, replace all secrets, set production URLs, use MongoDB authentication,
and put FastAPI behind Nginx with HTTPS. Never commit `.env` files.
