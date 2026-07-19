# TripleSide Studio - PRD

## Problem Statement
"buatkan saya website untuk studio musik saya bernama TripleSide Studio yang didalamnya terdapat menu katalog lagu, katalog gear yang saya gunakan dan menu download untuk katalog produk digital yang saya jual. buat dengan design modern"

## Architecture
- Frontend: React 19 + React Router 7 + Tailwind + Shadcn UI (dark mode, Outfit + Manrope fonts)
- Backend: FastAPI + Motor (MongoDB)
- Auth: JWT with role claim ('admin' or 'customer'), bcrypt hashed passwords
- Payments: Stripe Checkout via emergentintegrations library

## User Personas
- Visitor: browse songs/gear/shop, play song previews
- Customer: register/login, buy digital products via Stripe, download purchases from dashboard
- Admin: manage catalog (CRUD songs/gear/products), view customers + transactions

## Implemented (2026-05-12)
### Iteration 1 - MVP
- Hero homepage with cinematic dark theme
- Songs catalog with global audio player (play across pages)
- Gear catalog with category filtering
- Digital shop with product detail pages
- Stripe checkout integration
- Admin login + dashboard with CRUD for songs/gear/products
- Sample data seeding on startup

### Iteration 2 - Customer Auth System
- Customer registration (name + email/phone + password, either email or phone required)
- Customer login by email OR phone identifier
- Customer Dashboard: profile (view/edit) + purchase history with downloads
- Navbar shows Login/Register or Account menu (Admin link removed from public navbar)
- Buy Now requires customer login (redirects with return URL)
- Admin dashboard now has Customers tab
- Bug fix: /api/checkout/status no longer returns 500 on Stripe lookup failure

## Backlog (P0/P1)
- P1: Real digital file storage (S3 or similar) - currently download_url is filename placeholder
- P1: Email confirmations after successful purchase (Resend/SendGrid integration)
- P2: Forgot password flow
- P2: Customer order receipts/invoices
- P2: Admin: edit/delete customers
- P2: Product reviews & ratings
- P2: Coupon codes / discounts

## Credentials
See /app/memory/test_credentials.md

### Iteration 3 - Storage / Email / Invoice / Coupons (2026-05-12)
- **Resend email integration**: purchase confirmation + password reset emails (Indonesian-friendly HTML templates with brand styling). Currently in Resend test mode — only sends to verified address (rambox034@gmail.com) until domain is verified at resend.com/domains.
- **Cloudinary file upload**: endpoint `/api/admin/upload` ready, admin UI has Upload button on product Download URL field. WAITING FOR `CLOUDINARY_API_SECRET` from user — currently returns 503.
- **Invoice PDF**: `/api/customer/invoice/{transaction_id}` returns branded dark-mode PDF (reportlab). "Invoice" button on each paid order in customer dashboard.
- **Coupon system**: full CRUD in admin (percent or fixed amount discount, expiry date, max uses, active flag). Customer applies code on product detail page — sees real-time discount preview. Coupon code + discount stored in payment_transaction. times_used auto-incremented on successful payment.
- **Forgot / Reset Password**: `/forgot-password` & `/reset-password?token=...` pages. Reset tokens are 32-byte URL-safe, 1-hour expiry, single-use. Email leaks no existence info.
- **Auth tightening**: `/api/download/{id}` now requires customer JWT and verifies ownership.

### Backlog after iteration 3
- P0: User to provide CLOUDINARY_API_SECRET → enable real file uploads
- P0: User to verify Resend sender domain at resend.com/domains → enable email to any recipient
- P1: Split server.py into routers (auth/, products/, checkout/, customer/, admin/)
- P2: Inconsistency: verify_customer 403 vs verify_admin 401 for missing token

### Iteration 4 - Cloudinary live + Modular split + Rate limiting (2026-05-12)
- **Cloudinary aktif**: API Secret diterima dari user, upload file dari admin panel sekarang langsung jalan ke `res.cloudinary.com/dzlw5dueu/...`. Verified via integration test.
- **Modular refactor**: `server.py` dipecah dari ~1000 baris menjadi 40 baris. Struktur baru: `core/` (config + models + auth + db + seed + rate_limit) dan `routers/` (public, admin_auth, customer, admin, checkout). 57/58 regression tests pass (1 obsolete test removed).
- **Rate limiting**:
  - `/api/customer/forgot-password`: 3 requests / 15 menit / IP → 429 dengan Retry-After
  - `/api/customer/login` + `/api/customer/register` + `/api/auth/login` (admin): shared limiter 10 requests / 5 menit / IP
  - In-memory dict, respects `X-Forwarded-For` (kita di belakang ingress)

### Backlog after iteration 4
- P1: Bundle Deals (paket produk dengan harga diskon untuk upsell)
- P2: Verifikasi domain Resend supaya email bisa kirim ke siapa saja
- P2: Migrate rate limiter ke Redis sebelum horizontal scale
- P3: 401 vs 403 inconsistency between verify_admin and verify_customer

### Iteration 6 - VST Plugin RSA License System (2026-05-12)
- **RSA-2048 keypair** auto-generated dan tersimpan di `/app/backend/keys/` (private + public PEM)
- **Public key endpoint** `/api/license/public-key` untuk embed di HISE plugin
- **Auto license generation**: setelah paid transaction produk `requires_license=true`, license key format `TS-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` otomatis dibuat
- **Activation**: `POST /api/license/activate` bind hardware_id ke license (1 komputer = 1 license). Idempotent untuk mesin sama, 409 untuk mesin lain
- **Verify**: `POST /api/license/verify` untuk online periodic check
- **Signed license file**: JSON payload + RSA-PSS-SHA256 signature (344 char) — plugin verify offline dengan public key
- **Admin panel**: tab "Licenses" — reset hardware binding, revoke, delete
- **Customer dashboard**: "My VST Licenses" section — copy license key ke clipboard
- **HISE Integration Guide**: `/app/memory/HISE_LICENSE_INTEGRATION.md` — panduan lengkap dengan contoh script HISE

### Fitur juga selesai iterasi ini
- Free digital products dengan is_free flag + /api/free-claim endpoint
- Blog system dengan markdown editor (react-markdown + remark-gfm)
- YouTube & Spotify embed di Songs catalog (track_type: audio/youtube/spotify)
- DELETE /api/customer/orders/{id} untuk hapus pending orders dari dashboard
- Resend SENDER_EMAIL updated ke admin@triplesidestudio.com (domain verified)

### Backlog
- P1: Midtrans payment (di-defer oleh user)
- P1: Cloudinary "Restrict PDF/ZIP delivery" perlu diaktifkan/dinonaktifkan sesuai keputusan user
- P2: Email verification flow untuk registrasi customer (block disposable email domains)
- P2: Force domain-restricted delivery pakai signed Cloudinary URL
- P3: HISE-side integration: user perlu compile & test script di project HISE mereka

### Iteration 7 - HISE 4.9.1 License Script (Opsi A: Online Activation) (2026-02)
- User pakai **HISE 4.9.1**, minta script lisensi VST yang pasti compatible & langsung dipakai.
- Temuan penting: HISE native `Unlocker` HANYA menerima RSA key format JUCE (dibuat via Tools -> Create RSA Key Pair), BUKAN RSA-PEM standar yang dihasilkan backend Python kita.
- User memilih **Opsi A (Online Activation)** — plugin panggil endpoint `/api/license/activate` + `/verify` yang sudah ada, simpan bukti aktivasi ke file lokal untuk launch offline. TANPA perubahan backend.
- Script final ditulis pakai API resmi HISE 4.9.1: `Server.setBaseURL/setHttpHeader/callWithPOST`, `FileSystem.getSystemId/getFolder`, `File.writeObject/loadAsObject/isFile`, gate audio pakai Simple Gain `LicenseGate`.
- Kontrak API diverifikasi via curl (verify key salah -> 200 {valid:false}, activate key salah -> 404).
- Guide lengkap: `/app/memory/HISE_LICENSE_INTEGRATION.md`. Verifikasi final harus user tes di HISE.
- Ditolak: Opsi B (native Unlocker offline) — butuh key format JUCE + ubah backend algoritma applyToValue.

### Iteration 8 - HISE Online License (Opsi B online) + form-encoded backend (2026-02)
- User kirim script HISE referensi yang terbukti jalan; minta script online, **1 plugin = 1 komputer**, dan `Server.callWithPOST` dikonfirmasi bisa.
- Verifikasi dokumentasi resmi: `FileSystem.getSystemId()` ADA (machine ID); `Server.callWithPOST` kirim **form-encoded** (default) & butuh `Server.setBaseURL`.
- Backend: `/api/license/activate` & `/verify` sekarang menerima **JSON + form-encoded** via helper `_read_payload` (pakai urllib parse_qs, TANPA python-multipart). Ditambah dual decorator route `/activate` + `/activate/` (dan verify) agar TAHAN trailing-slash tanpa 307 redirect yang membuang body POST — penting untuk HISE.
- Script HISE final: pakai HANYA fungsi dari referensi user (`showControl`, file API, named inline `setControlCallback`, `component.setValue`) + `Server.setBaseURL/callWithPOST` + `FileSystem.getSystemId()`. Callback server anonymous & self-contained (hindari gotcha `local`-tak-ter-capture & inline-in-callback). Simpan `license.txt`+`machine.txt` untuk offline; hardware lock dienforce server (409).
- Testing agent: 20/20 lulus (iter5 JSON 9 + iter6 form 11). Test files: `/app/backend/tests/test_license_contract.py`, `test_license_form_contract.py`.
- Guide: `/app/memory/HISE_LICENSE_INTEGRATION.md`. Verifikasi final tetap perlu user tes di HISE.
