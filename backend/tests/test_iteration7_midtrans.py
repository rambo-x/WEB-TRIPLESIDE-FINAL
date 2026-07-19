"""Iteration 7 — Midtrans + IDR Stripe integration tests.

Covers:
  * Stripe IDR happy path (price=150000)
  * Stripe tiny-amount graceful 400 (price=50)
  * Midtrans /session unconfigured -> 503
  * Midtrans webhook invalid signature -> 401
  * Midtrans webhook valid signature (empty server key) -> 200 {ok:true}
  * Midtrans status unknown order -> 404
  * Free-claim still works (auto-license created)

The Midtrans server key is intentionally EMPTY (user will add it later),
so the full Snap flow is NOT exercised.
"""
import hashlib
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tripleside-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"


# ------------------------- Fixtures -------------------------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"] if "access_token" in r.json() else r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def customer_ctx():
    """Fresh customer per module: {token, headers, email}"""
    email = f"TEST_it7_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{API}/customer/register",
        json={"name": "Test Iter7", "email": email, "password": "secret123"},
        timeout=15,
    )
    assert r.status_code == 200, f"customer register failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    return {"token": tok, "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, "email": email}


def _create_product(headers, **overrides):
    payload = {
        "name": f"TEST_iter7_{uuid.uuid4().hex[:6]}",
        "category": "vst",
        "image_url": "https://example.com/img.png",
        "description": "test product iteration 7",
        "price": 150000,
        "is_free": False,
        "requires_license": False,
        "preview_audio_url": "",
        "download_url": "tmp.zip",
    }
    payload.update(overrides)
    r = requests.post(f"{API}/admin/products", json=payload, headers=headers, timeout=15)
    assert r.status_code == 200, f"create product failed: {r.status_code} {r.text}"
    return r.json()


def _delete_product(headers, product_id):
    # No trailing slash on purpose
    r = requests.delete(f"{API}/admin/products/{product_id}", headers=headers, timeout=15, allow_redirects=False)
    # Accept 200 OK; 404 if already deleted
    assert r.status_code in (200, 204, 404), f"delete failed: {r.status_code} {r.text}"


# ------------------------- Stripe (IDR) -------------------------
class TestStripeIDR:
    def test_stripe_idr_success_returns_stripe_url(self, admin_headers, customer_ctx):
        product = _create_product(admin_headers, price=150000)
        try:
            r = requests.post(
                f"{API}/checkout/session",
                json={"product_id": product["id"], "origin_url": BASE_URL},
                headers=customer_ctx["headers"],
                timeout=25,
            )
            assert r.status_code == 200, f"Stripe checkout expected 200 got {r.status_code}: {r.text}"
            data = r.json()
            assert "url" in data and isinstance(data["url"], str) and data["url"], "expected Stripe URL"
            assert "checkout.stripe.com" in data["url"], f"expected stripe host in url, got {data['url']}"
            assert "session_id" in data
        finally:
            _delete_product(admin_headers, product["id"])

    def test_stripe_tiny_amount_graceful_400_indonesian_message(self, admin_headers, customer_ctx):
        product = _create_product(admin_headers, price=50)
        try:
            r = requests.post(
                f"{API}/checkout/session",
                json={"product_id": product["id"], "origin_url": BASE_URL},
                headers=customer_ctx["headers"],
                timeout=25,
            )
            assert r.status_code == 400, f"expected 400 for tiny amount, got {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            # Indonesian message per checkout.py
            assert "Nominal terlalu kecil" in detail or "Midtrans" in detail, f"unexpected detail: {detail}"
        finally:
            _delete_product(admin_headers, product["id"])


# ------------------------- Midtrans -------------------------
class TestMidtrans:
    def test_midtrans_session_unconfigured_503(self, admin_headers, customer_ctx):
        product = _create_product(admin_headers, price=150000)
        try:
            r = requests.post(
                f"{API}/checkout/midtrans/session",
                json={"product_id": product["id"], "origin_url": BASE_URL},
                headers=customer_ctx["headers"],
                timeout=15,
            )
            assert r.status_code == 503, f"expected 503 got {r.status_code}: {r.text}"
            detail = r.json().get("detail", "")
            assert detail == "Midtrans belum dikonfigurasi. Hubungi admin.", f"bad detail: {detail!r}"
        finally:
            _delete_product(admin_headers, product["id"])

    def test_midtrans_webhook_invalid_signature_401(self):
        r = requests.post(
            f"{API}/webhook/midtrans",
            json={"order_id": "ORD-X", "status_code": "200", "gross_amount": "1000", "signature_key": "bad"},
            timeout=15,
        )
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text}"
        assert "Invalid signature" in r.json().get("detail", "")

    def test_midtrans_webhook_valid_signature_empty_server_key_200(self):
        # server key is empty by design
        order_id = f"ORD-{uuid.uuid4().hex[:10].upper()}"
        status_code = "200"
        gross_amount = "1000"
        server_key = ""  # empty
        sig = hashlib.sha512(f"{order_id}{status_code}{gross_amount}{server_key}".encode()).hexdigest()
        r = requests.post(
            f"{API}/webhook/midtrans",
            json={"order_id": order_id, "status_code": status_code, "gross_amount": gross_amount, "signature_key": sig},
            timeout=25,
        )
        assert r.status_code == 200, f"expected 200 got {r.status_code}: {r.text}"
        assert r.json() == {"ok": True}

    def test_midtrans_status_unknown_order_404(self):
        r = requests.get(f"{API}/checkout/midtrans/status/ORD-DOESNOTEXIST", timeout=15)
        assert r.status_code == 404, f"expected 404 got {r.status_code}: {r.text}"


# ------------------------- Free claim -------------------------
class TestFreeClaim:
    def test_free_claim_creates_license(self, admin_headers):
        # Fresh customer to avoid duplicate-claim collisions
        email = f"TEST_it7free_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(
            f"{API}/customer/register",
            json={"name": "Free Claimer", "email": email, "password": "secret123"},
            timeout=15,
        )
        assert r.status_code == 200, f"register failed: {r.text}"
        c_headers = {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}

        product = _create_product(
            admin_headers,
            price=0,
            is_free=True,
            requires_license=True,
            download_url="freebie.zip",
        )
        try:
            r = requests.post(f"{API}/free-claim/{product['id']}", headers=c_headers, timeout=15)
            assert r.status_code == 200, f"free-claim failed: {r.status_code} {r.text}"
            data = r.json()
            assert "transaction_id" in data
            assert data.get("already_claimed") is False

            # Verify license auto-created
            r2 = requests.get(f"{API}/customer/licenses", headers=c_headers, timeout=15)
            assert r2.status_code == 200, f"licenses list failed: {r2.status_code} {r2.text}"
            licenses = r2.json()
            assert isinstance(licenses, list)
            matching = [lic for lic in licenses if lic.get("product_id") == product["id"]]
            assert len(matching) >= 1, f"expected license for product {product['id']}, got {licenses}"
            assert matching[0].get("status") in ("unactivated", "active")
        finally:
            _delete_product(admin_headers, product["id"])
