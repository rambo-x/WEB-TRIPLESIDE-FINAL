"""Iteration 4 tests:
- /api/admin/upload now returns 200 + Cloudinary URL (was 503 in it3)
- Rate limiting on forgot-password (3/15min) and login (10/5min)
- Rate limiter respects X-Forwarded-For header
- Regression on modular split (admin auth still works after refactor)
"""
import io
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tripleside-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"


def _unique_ip(prefix: str = "192") -> str:
    n = uuid.uuid4().int
    return f"{prefix}.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250 + 1}"


# -----------------------------------------------------------------------------
# Modular-split regression: admin auth path still works at /api/auth/login
# -----------------------------------------------------------------------------
@pytest.fixture(scope="module")
def admin_token():
    ip = _unique_ip("172")
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"X-Forwarded-For": ip},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_admin_login_after_refactor(admin_token):
    assert isinstance(admin_token, str) and len(admin_token) > 10


def test_auth_me_after_refactor(admin_token):
    r = requests.get(
        f"{API}/auth/me",
        headers={"Authorization": f"Bearer {admin_token}", "X-Forwarded-For": _unique_ip("172")},
        timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


def test_public_endpoints_after_refactor():
    """All three public listings + product detail still respond 200."""
    for path in ("/songs", "/gear", "/products"):
        r = requests.get(f"{API}{path}", timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code}"
        assert isinstance(r.json(), list)
    pid = requests.get(f"{API}/products", timeout=30).json()[0]["id"]
    r2 = requests.get(f"{API}/products/{pid}", timeout=30)
    assert r2.status_code == 200
    assert r2.json()["id"] == pid


# -----------------------------------------------------------------------------
# /api/admin/upload — NEW: should now return 200 with Cloudinary URL
# -----------------------------------------------------------------------------
def test_admin_upload_returns_cloudinary_url(admin_token):
    file_bytes = b"hello tripleside iteration 4 upload test"
    files = {"file": ("it4_test.txt", io.BytesIO(file_bytes), "text/plain")}
    data = {"folder": "tripleside/tests"}
    r = requests.post(
        f"{API}/admin/upload",
        files=files,
        data=data,
        headers={"Authorization": f"Bearer {admin_token}", "X-Forwarded-For": _unique_ip("172")},
        timeout=60,
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert "url" in body, f"Response missing 'url': {body}"
    assert body["url"].startswith("https://res.cloudinary.com/"), f"URL not cloudinary: {body['url']}"
    assert "public_id" in body
    # Verify the uploaded file is fetchable
    head = requests.head(body["url"], timeout=30)
    assert head.status_code == 200, f"Uploaded file not reachable: {head.status_code}"


def test_admin_upload_unauthorized():
    files = {"file": ("x.txt", io.BytesIO(b"x"), "text/plain")}
    r = requests.post(f"{API}/admin/upload", files=files, timeout=30)
    assert r.status_code == 401


def test_admin_upload_empty_file(admin_token):
    files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
    r = requests.post(
        f"{API}/admin/upload",
        files=files,
        headers={"Authorization": f"Bearer {admin_token}", "X-Forwarded-For": _unique_ip("172")},
        timeout=30,
    )
    assert r.status_code == 400


# -----------------------------------------------------------------------------
# Rate limit: /api/customer/forgot-password — 3/15min
# -----------------------------------------------------------------------------
class TestForgotPasswordRateLimit:
    def test_forgot_password_4th_request_429(self):
        ip = _unique_ip("203")  # dedicated IP for this test
        headers = {"X-Forwarded-For": ip}
        # 3 allowed requests
        for i in range(3):
            r = requests.post(
                f"{API}/customer/forgot-password",
                json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com"},
                headers=headers,
                timeout=30,
            )
            assert r.status_code == 200, f"Request {i+1} should succeed, got {r.status_code}: {r.text}"
        # 4th must be rate-limited
        r4 = requests.post(
            f"{API}/customer/forgot-password",
            json={"email": "nobody@example.com"},
            headers=headers,
            timeout=30,
        )
        assert r4.status_code == 429, f"Expected 429 on 4th request, got {r4.status_code}: {r4.text}"
        assert "Retry-After" in r4.headers, f"Missing Retry-After header. Headers: {dict(r4.headers)}"
        assert int(r4.headers["Retry-After"]) > 0


# -----------------------------------------------------------------------------
# Rate limit: customer login — 10/5min (shared with register + admin login)
# -----------------------------------------------------------------------------
class TestLoginRateLimit:
    def test_customer_login_11th_request_429(self):
        ip = _unique_ip("204")
        headers = {"X-Forwarded-For": ip}
        # 10 allowed (each fails 401 because creds bad, but counts toward limit)
        for i in range(10):
            r = requests.post(
                f"{API}/customer/login",
                json={"identifier": "noone@example.com", "password": "bad"},
                headers=headers,
                timeout=30,
            )
            assert r.status_code in (401, 200), f"Request {i+1} unexpected: {r.status_code}"
        # 11th must 429
        r11 = requests.post(
            f"{API}/customer/login",
            json={"identifier": "noone@example.com", "password": "bad"},
            headers=headers,
            timeout=30,
        )
        assert r11.status_code == 429, f"Expected 429 on 11th, got {r11.status_code}: {r11.text}"
        assert "Retry-After" in r11.headers

    def test_admin_login_shares_same_limiter(self):
        """A single IP that hits customer/login 10x should also be limited from /api/auth/login."""
        ip = _unique_ip("205")
        headers = {"X-Forwarded-For": ip}
        for _ in range(10):
            requests.post(
                f"{API}/customer/login",
                json={"identifier": "x@x.com", "password": "bad"},
                headers=headers,
                timeout=30,
            )
        r = requests.post(
            f"{API}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 429, f"Shared limiter not enforced for admin login: {r.status_code}: {r.text}"

    def test_customer_register_shares_same_limiter(self):
        ip = _unique_ip("206")
        headers = {"X-Forwarded-For": ip}
        for _ in range(10):
            requests.post(
                f"{API}/customer/login",
                json={"identifier": "x@x.com", "password": "bad"},
                headers=headers,
                timeout=30,
            )
        r = requests.post(
            f"{API}/customer/register",
            json={
                "name": "TEST_it4",
                "email": f"TEST_it4_{uuid.uuid4().hex[:6]}@example.com",
                "password": "secret123",
            },
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 429, f"Register not limited under shared limiter: {r.status_code}: {r.text}"


# -----------------------------------------------------------------------------
# Rate limiter respects X-Forwarded-For: two different IPs should not interfere
# -----------------------------------------------------------------------------
def test_rate_limiter_isolates_by_xff():
    ip_a = _unique_ip("207")
    ip_b = _unique_ip("208")
    # Exhaust ip_a's forgot-password quota
    for _ in range(3):
        requests.post(
            f"{API}/customer/forgot-password",
            json={"email": "nobody@example.com"},
            headers={"X-Forwarded-For": ip_a},
            timeout=30,
        )
    r_a = requests.post(
        f"{API}/customer/forgot-password",
        json={"email": "nobody@example.com"},
        headers={"X-Forwarded-For": ip_a},
        timeout=30,
    )
    assert r_a.status_code == 429
    # ip_b should still be fresh
    r_b = requests.post(
        f"{API}/customer/forgot-password",
        json={"email": "nobody@example.com"},
        headers={"X-Forwarded-For": ip_b},
        timeout=30,
    )
    assert r_b.status_code == 200, f"Fresh IP unexpectedly limited: {r_b.status_code}: {r_b.text}"
