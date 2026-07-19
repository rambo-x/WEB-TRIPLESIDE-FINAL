"""Iteration 6 - VST license backend contract with FORM-ENCODED requests.

HISE's Server.callWithPOST sends application/x-www-form-urlencoded by default.
This suite verifies the backend accepts form-encoded bodies for
/api/license/activate and /api/license/verify (and their trailing-slash
variants without dropping the body via 307 redirect), plus revoke flow,
plus a JSON regression check.

Ordering matters (same license state is mutated across tests):
  activate happy (HW-PC-1) -> idempotent (HW-PC-1) -> conflict (HW-PC-2) ->
  invalid -> trailing-slash-idempotent -> trailing-slash-404 ->
  verify valid -> verify mismatch -> revoke -> verify revoked (form + json).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    fe = "/app/frontend/.env"
    if os.path.exists(fe):
        with open(fe) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                    break

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"

FORM_HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}
JSON_HEADERS = {"Content-Type": "application/json"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def admin_token(api):
    r = api.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers=JSON_HEADERS,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("token")
    return data["token"]


@pytest.fixture(scope="module")
def customer(api):
    """Register a fresh customer for the free-claim -> license flow."""
    unique = uuid.uuid4().hex[:8]
    email = f"TEST_licform_{unique}@example.com"
    r = api.post(
        f"{BASE_URL}/api/customer/register",
        json={"name": "TEST FormLic Buyer", "email": email, "password": "secret123"},
        headers=JSON_HEADERS,
    )
    assert r.status_code == 200, f"Customer register failed: {r.status_code} {r.text}"
    d = r.json()
    return {"id": d["customer"]["id"], "token": d["token"], "email": email}


@pytest.fixture(scope="module")
def free_licensed_product(api, admin_token):
    payload = {
        "name": f"TEST HISE FormPlugin {uuid.uuid4().hex[:6]}",
        "category": "vst",
        "image_url": "https://placehold.co/300",
        "description": "TEST free plugin for FORM license contract tests.",
        "price": 0,
        "is_free": True,
        "requires_license": True,
        "preview_audio_url": "",
        "download_url": "https://example.com/plugin.zip",
    }
    r = api.post(
        f"{BASE_URL}/api/admin/products",
        json=payload,
        headers={**JSON_HEADERS, "Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, f"Product create failed: {r.status_code} {r.text}"
    product = r.json()
    assert product.get("is_free") is True and product.get("requires_license") is True
    yield product
    try:
        api.delete(
            f"{BASE_URL}/api/admin/products/{product['id']}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
    except Exception:
        pass


@pytest.fixture(scope="module")
def claimed_license(api, free_licensed_product, customer):
    """Free-claim the product; return the auto-generated license row."""
    hdr = {"Authorization": f"Bearer {customer['token']}"}
    r = api.post(f"{BASE_URL}/api/free-claim/{free_licensed_product['id']}", headers=hdr)
    assert r.status_code == 200, f"free-claim failed: {r.status_code} {r.text}"

    r2 = api.get(f"{BASE_URL}/api/customer/licenses", headers=hdr)
    assert r2.status_code == 200
    items = r2.json()
    lic = next((x for x in items if x.get("product_id") == free_licensed_product["id"]), None)
    assert lic is not None, f"No license row for product in {items}"
    assert lic.get("license_key")
    assert lic.get("status") == "unactivated"
    return lic


# ---------- Sanity: public-key still up (form suite is self-contained) ----------
class TestPublicKey:
    def test_public_key_endpoint(self, api):
        r = api.get(f"{BASE_URL}/api/license/public-key")
        assert r.status_code == 200
        d = r.json()
        assert d.get("public_key_pem", "").startswith("-----BEGIN PUBLIC KEY-----") \
            or "BEGIN PUBLIC KEY" in d.get("public_key_pem", "")
        assert d.get("algorithm")


# ---------- FORM-ENCODED activate ----------
class TestFormActivate:
    def test_form_activate_happy_path(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/activate",
            data=f"license_key={key}&hardware_id=HW-PC-1&machine_name=HISE",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("already_activated") is False
        assert d.get("license"), "signed license payload missing"

    def test_form_activate_idempotent_same_hw(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/activate",
            data=f"license_key={key}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("already_activated") is True
        assert d.get("license")

    def test_form_activate_different_hw_conflict(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/activate",
            data=f"license_key={key}&hardware_id=HW-PC-2&machine_name=OTHER",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"

    def test_form_activate_invalid_key(self, api):
        bogus = "TS-" + uuid.uuid4().hex[:16].upper()
        r = api.post(
            f"{BASE_URL}/api/license/activate",
            data=f"license_key={bogus}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ---------- Trailing-slash routes MUST NOT 307-redirect (body would be lost) ----------
class TestTrailingSlashRoute:
    def test_form_activate_trailing_slash_no_redirect_idempotent(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/activate/",
            data=f"license_key={key}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
            allow_redirects=False,
        )
        # Must be direct 200 (no 307/308 redirect that would strip the body)
        assert r.status_code == 200, (
            f"trailing-slash activate should be 200 (no redirect), got "
            f"{r.status_code} - history={[h.status_code for h in r.history]} body={r.text}"
        )
        assert r.history == [], f"Unexpected redirect chain: {r.history}"
        d = r.json()
        assert d.get("already_activated") is True

    def test_form_activate_trailing_slash_invalid_key_404(self, api):
        bogus = "TS-" + uuid.uuid4().hex[:16].upper()
        r = api.post(
            f"{BASE_URL}/api/license/activate/",
            data=f"license_key={bogus}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
            allow_redirects=False,
        )
        assert r.status_code == 404, (
            f"trailing-slash 404 expected, got {r.status_code} "
            f"history={[h.status_code for h in r.history]}"
        )
        assert r.history == [], f"Unexpected redirect chain: {r.history}"


# ---------- FORM-ENCODED verify ----------
class TestFormVerify:
    def test_form_verify_valid(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/verify",
            data=f"license_key={key}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("valid") is True
        assert d.get("activated_at")

    def test_form_verify_hardware_mismatch(self, api, claimed_license):
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/verify",
            data=f"license_key={key}&hardware_id=HW-PC-2",
            headers=FORM_HEADERS,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("valid") is False
        assert d.get("reason") == "hardware_mismatch"


# ---------- Admin revoke -> verify returns revoked ----------
class TestRevoke:
    def test_admin_revoke_then_verify(self, api, admin_token, claimed_license):
        key = claimed_license["license_key"]
        # Find license_id via admin list
        r = api.get(
            f"{BASE_URL}/api/admin/licenses",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert r.status_code == 200, f"admin list licenses failed: {r.status_code} {r.text}"
        items = r.json()
        row = next((x for x in items if x.get("license_key") == key), None)
        assert row is not None, f"license {key} not present in admin listing"
        license_id = row.get("id")
        assert license_id, f"license row missing id: {row}"

        # Revoke
        rr = api.post(
            f"{BASE_URL}/api/admin/licenses/{license_id}/revoke",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert rr.status_code == 200, f"revoke failed: {rr.status_code} {rr.text}"
        assert rr.json().get("ok") is True

        # FORM verify with the bound HW-PC-1 should now be valid:false reason=revoked
        v = api.post(
            f"{BASE_URL}/api/license/verify",
            data=f"license_key={key}&hardware_id=HW-PC-1",
            headers=FORM_HEADERS,
        )
        assert v.status_code == 200, f"{v.status_code} {v.text}"
        d = v.json()
        assert d.get("valid") is False, f"expected valid=false after revoke, got {d}"
        assert d.get("reason") == "revoked", f"expected reason=revoked, got {d}"


# ---------- JSON regression: body still parsed after revoke ----------
class TestJsonRegression:
    def test_json_verify_still_parsed_after_revoke(self, api, claimed_license):
        """Regression: JSON must still work (not 422). After revoke it will be
        valid:false reason='revoked', which also proves the JSON body was parsed
        (otherwise license_key wouldn't be read and reason would be not_found)."""
        key = claimed_license["license_key"]
        r = api.post(
            f"{BASE_URL}/api/license/verify",
            json={"license_key": key, "hardware_id": "HW-PC-1"},
            headers=JSON_HEADERS,
        )
        assert r.status_code == 200, f"JSON verify failed: {r.status_code} {r.text}"
        d = r.json()
        # After revoke it should be revoked, NOT not_found (which would mean the
        # body wasn't parsed).
        assert d.get("valid") is False
        assert d.get("reason") == "revoked", (
            f"JSON body appears not to be parsed correctly (expected 'revoked' "
            f"after admin revoke, got {d})"
        )
