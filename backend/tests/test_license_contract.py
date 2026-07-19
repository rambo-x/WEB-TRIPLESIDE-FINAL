"""VST license backend contract tests (iteration 5).

Covers the HISE plugin -> backend surface:
- GET  /api/license/public-key
- POST /api/free-claim/{product_id}  (auto-generates license when requires_license=true)
- GET  /api/customer/licenses
- POST /api/license/activate         (bind, idempotent, hardware conflict, not-found)
- POST /api/license/verify           (valid, hardware_mismatch, not_found)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # frontend .env is the source of truth for the public URL
    frontend_env = "/app/frontend/.env"
    if os.path.exists(frontend_env):
        with open(frontend_env) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(f"{BASE_URL}/api/auth/login",
                 json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["token"]
    return data["token"]


@pytest.fixture(scope="module")
def customer(api):
    """Register a fresh customer and return (customer_id, token, email)."""
    unique = uuid.uuid4().hex[:8]
    email = f"TEST_lic_{unique}@example.com"
    r = api.post(f"{BASE_URL}/api/customer/register", json={
        "name": "TEST License Buyer",
        "email": email,
        "password": "secret123",
    })
    assert r.status_code == 200, f"Customer register failed: {r.status_code} {r.text}"
    d = r.json()
    assert d.get("token")
    assert d.get("customer", {}).get("id")
    return {"id": d["customer"]["id"], "token": d["token"], "email": email}


@pytest.fixture(scope="module")
def free_licensed_product(api, admin_token):
    """Admin creates a FREE digital product with requires_license=true. Cleanup at end."""
    payload = {
        "name": f"TEST HISE Plugin {uuid.uuid4().hex[:6]}",
        "category": "vst",
        "image_url": "https://placehold.co/300",
        "description": "TEST free plugin for license contract tests.",
        "price": 0,
        "is_free": True,
        "requires_license": True,
        "preview_audio_url": "",
        "download_url": "https://example.com/plugin.zip",
    }
    r = api.post(
        f"{BASE_URL}/api/admin/products",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, f"Product create failed: {r.status_code} {r.text}"
    product = r.json()
    assert product["is_free"] is True
    assert product["requires_license"] is True
    assert product["id"]
    yield product
    # teardown
    try:
        api.delete(
            f"{BASE_URL}/api/admin/products/{product['id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
    except Exception:
        pass


@pytest.fixture(scope="module")
def claimed_license(api, free_licensed_product, customer):
    """Customer claims the free product; return the auto-generated license row."""
    hdr = {"Authorization": f"Bearer {customer['token']}"}
    r = api.post(
        f"{BASE_URL}/api/free-claim/{free_licensed_product['id']}",
        headers=hdr,
    )
    assert r.status_code == 200, f"free-claim failed: {r.status_code} {r.text}"
    body = r.json()
    assert "transaction_id" in body

    # GET /api/customer/licenses should now contain a license for this product
    r2 = api.get(f"{BASE_URL}/api/customer/licenses", headers=hdr)
    assert r2.status_code == 200
    items = r2.json()
    assert isinstance(items, list) and len(items) > 0
    lic = next((x for x in items if x.get("product_id") == free_licensed_product["id"]), None)
    assert lic is not None, f"No license row for product {free_licensed_product['id']} in {items}"
    assert lic.get("license_key"), "license_key missing on license row"
    assert lic.get("status") == "unactivated"
    assert lic.get("hardware_id", "") in ("", None)
    return lic


# ---------- Public key ----------
class TestPublicKey:
    def test_public_key_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/license/public-key")
        assert r.status_code == 200
        d = r.json()
        assert "public_key_pem" in d and d["public_key_pem"]
        assert "algorithm" in d and d["algorithm"]
        assert "BEGIN PUBLIC KEY" in d["public_key_pem"]


# ---------- Free-claim license auto-creation ----------
class TestFreeClaimLicense:
    def test_license_created_on_free_claim(self, claimed_license):
        # Just asserts fixture succeeded — the important fields
        assert claimed_license["license_key"]
        assert claimed_license["status"] == "unactivated"


# ---------- Activate ----------
class TestActivate:
    def test_activate_happy_path(self, api, claimed_license):
        r = api.post(f"{BASE_URL}/api/license/activate", json={
            "license_key": claimed_license["license_key"],
            "hardware_id": "HWTEST-AAA",
            "machine_name": "WIN",
        })
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("already_activated") is False
        assert d.get("license"), "signed license file missing"

    def test_activate_same_machine_idempotent(self, api, claimed_license):
        r = api.post(f"{BASE_URL}/api/license/activate", json={
            "license_key": claimed_license["license_key"],
            "hardware_id": "HWTEST-AAA",
            "machine_name": "WIN",
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("already_activated") is True
        assert d.get("license")

    def test_activate_different_machine_rejected(self, api, claimed_license):
        r = api.post(f"{BASE_URL}/api/license/activate", json={
            "license_key": claimed_license["license_key"],
            "hardware_id": "HWTEST-BBB",
            "machine_name": "WIN2",
        })
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"

    def test_activate_invalid_key(self, api):
        bogus = "TS-" + uuid.uuid4().hex[:16].upper()
        r = api.post(f"{BASE_URL}/api/license/activate", json={
            "license_key": bogus,
            "hardware_id": "HWTEST-AAA",
            "machine_name": "WIN",
        })
        assert r.status_code == 404


# ---------- Verify ----------
class TestVerify:
    def test_verify_valid(self, api, claimed_license):
        r = api.post(f"{BASE_URL}/api/license/verify", json={
            "license_key": claimed_license["license_key"],
            "hardware_id": "HWTEST-AAA",
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("valid") is True
        assert d.get("activated_at")

    def test_verify_hardware_mismatch(self, api, claimed_license):
        r = api.post(f"{BASE_URL}/api/license/verify", json={
            "license_key": claimed_license["license_key"],
            "hardware_id": "HWTEST-BBB",
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("valid") is False
        assert d.get("reason") == "hardware_mismatch"

    def test_verify_unknown_key(self, api):
        bogus = "TS-" + uuid.uuid4().hex[:16].upper()
        r = api.post(f"{BASE_URL}/api/license/verify", json={
            "license_key": bogus,
            "hardware_id": "HWTEST-AAA",
        })
        assert r.status_code == 200
        d = r.json()
        assert d.get("valid") is False
        assert d.get("reason") == "not_found"
