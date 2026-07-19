import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tripleside-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Public listing ----------
def test_list_songs():
    r = requests.get(f"{API}/songs", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 6
    assert "id" in data[0] and "audio_url" in data[0]


def test_list_gear():
    r = requests.get(f"{API}/gear", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 6
    assert "category" in data[0]


def test_list_products():
    r = requests.get(f"{API}/products", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 6
    assert "price" in data[0]


def test_get_single_product():
    r = requests.get(f"{API}/products", timeout=30)
    pid = r.json()[0]["id"]
    r2 = requests.get(f"{API}/products/{pid}", timeout=30)
    assert r2.status_code == 200
    assert r2.json()["id"] == pid


def test_get_product_not_found():
    r = requests.get(f"{API}/products/nonexistent-id", timeout=30)
    assert r.status_code == 404


# ---------- Auth ----------
def test_login_success(token):
    assert isinstance(token, str) and len(token) > 10


def test_login_wrong_password():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=30)
    assert r.status_code == 401


def test_auth_me_valid(auth_headers):
    r = requests.get(f"{API}/auth/me", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


def test_auth_me_no_token():
    r = requests.get(f"{API}/auth/me", timeout=30)
    assert r.status_code == 401


# ---------- Admin CRUD for songs ----------
def test_admin_song_crud(auth_headers):
    payload = {
        "title": "TEST_Song", "artist": "TEST", "genre": "Test", "duration": "1:00",
        "cover_url": "https://example.com/c.jpg", "audio_url": "https://example.com/a.mp3",
        "release_year": 2025, "description": "test"
    }
    c = requests.post(f"{API}/admin/songs", json=payload, headers=auth_headers, timeout=30)
    assert c.status_code == 200, c.text
    sid = c.json()["id"]
    # Update
    payload["title"] = "TEST_Song_Updated"
    u = requests.put(f"{API}/admin/songs/{sid}", json=payload, headers=auth_headers, timeout=30)
    assert u.status_code == 200
    assert u.json()["title"] == "TEST_Song_Updated"
    # Verify via GET
    g = requests.get(f"{API}/songs", timeout=30)
    assert any(s["id"] == sid and s["title"] == "TEST_Song_Updated" for s in g.json())
    # Delete
    d = requests.delete(f"{API}/admin/songs/{sid}", headers=auth_headers, timeout=30)
    assert d.status_code == 200


def test_admin_song_create_unauthorized():
    r = requests.post(f"{API}/admin/songs", json={"title": "x", "artist": "x", "genre": "x", "duration": "1:00", "cover_url": "x", "audio_url": "x"}, timeout=30)
    assert r.status_code == 401


def test_admin_gear_create(auth_headers):
    payload = {"name": "TEST_Gear", "brand": "TB", "category": "Microphone",
               "image_url": "https://example.com/i.jpg", "description": "test", "specs": ["a", "b"]}
    c = requests.post(f"{API}/admin/gear", json=payload, headers=auth_headers, timeout=30)
    assert c.status_code == 200
    gid = c.json()["id"]
    requests.delete(f"{API}/admin/gear/{gid}", headers=auth_headers, timeout=30)


def test_admin_product_create(auth_headers):
    payload = {"name": "TEST_Product", "category": "Sample Pack",
               "image_url": "https://example.com/p.jpg", "description": "test",
               "price": 5.99, "preview_audio_url": "", "download_url": "test.zip"}
    c = requests.post(f"{API}/admin/products", json=payload, headers=auth_headers, timeout=30)
    assert c.status_code == 200
    pid = c.json()["id"]
    requests.delete(f"{API}/admin/products/{pid}", headers=auth_headers, timeout=30)


# ---------- Stripe checkout ----------
def test_create_checkout_session():
    products = requests.get(f"{API}/products", timeout=30).json()
    pid = products[0]["id"]
    r = requests.post(f"{API}/checkout/session",
                      json={"product_id": pid, "origin_url": BASE_URL, "buyer_email": "test@example.com"},
                      timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "url" in data and "session_id" in data
    assert data["url"].startswith("http")
    # Now poll status
    sid = data["session_id"]
    s = requests.get(f"{API}/checkout/status/{sid}", timeout=30)
    assert s.status_code == 200
    sd = s.json()
    assert "payment_status" in sd
    return sid


def test_checkout_invalid_product():
    r = requests.post(f"{API}/checkout/session",
                      json={"product_id": "bad-id", "origin_url": BASE_URL}, timeout=30)
    assert r.status_code == 404


def test_admin_transactions(auth_headers):
    r = requests.get(f"{API}/admin/transactions", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_transactions_unauthorized():
    r = requests.get(f"{API}/admin/transactions", timeout=30)
    assert r.status_code == 401



# ---------- Customer Auth & Profile ----------
import uuid as _uuid


@pytest.fixture(scope="session")
def customer_data():
    """Create a fresh customer for the session."""
    unique = _uuid.uuid4().hex[:8]
    payload = {
        "name": "TEST Customer",
        "email": f"TEST_cust_{unique}@example.com",
        "phone": f"+62812{unique[:7]}",
        "password": "secret123",
    }
    r = requests.post(f"{API}/customer/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    return {**payload, "token": body["token"], "id": body["customer"]["id"]}


@pytest.fixture
def customer_headers(customer_data):
    return {"Authorization": f"Bearer {customer_data['token']}"}


def test_customer_register_full(customer_data):
    assert customer_data["token"] and customer_data["id"]


def test_customer_register_email_only():
    payload = {"name": "TEST EmailOnly", "email": f"TEST_eo_{_uuid.uuid4().hex[:8]}@x.com", "password": "secret123"}
    r = requests.post(f"{API}/customer/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["customer"]["email"] == payload["email"].lower()
    assert r.json()["customer"]["phone"] == ""


def test_customer_register_phone_only():
    import random
    phone = "+62811" + "".join(str(random.randint(0, 9)) for _ in range(7))
    payload = {"name": "TEST PhoneOnly", "phone": phone, "password": "secret123"}
    r = requests.post(f"{API}/customer/register", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["customer"]["email"] == ""
    assert r.json()["customer"]["phone"] == phone


def test_customer_register_missing_identifier():
    r = requests.post(f"{API}/customer/register", json={"name": "X", "password": "secret123"}, timeout=30)
    assert r.status_code == 400


def test_customer_register_short_password():
    r = requests.post(f"{API}/customer/register",
                      json={"name": "X", "email": f"TEST_short_{_uuid.uuid4().hex[:6]}@x.com", "password": "abc"}, timeout=30)
    assert r.status_code == 400


def test_customer_register_duplicate_email(customer_data):
    payload = {"name": "Dup", "email": customer_data["email"], "password": "secret123"}
    r = requests.post(f"{API}/customer/register", json=payload, timeout=30)
    assert r.status_code == 409


def test_customer_login_by_email(customer_data):
    r = requests.post(f"{API}/customer/login",
                      json={"identifier": customer_data["email"], "password": customer_data["password"]}, timeout=30)
    assert r.status_code == 200, r.text
    assert "token" in r.json()


def test_customer_login_by_phone(customer_data):
    r = requests.post(f"{API}/customer/login",
                      json={"identifier": customer_data["phone"], "password": customer_data["password"]}, timeout=30)
    assert r.status_code == 200, r.text


def test_customer_login_wrong_password(customer_data):
    r = requests.post(f"{API}/customer/login",
                      json={"identifier": customer_data["email"], "password": "WRONGPASS"}, timeout=30)
    assert r.status_code == 401


def test_customer_me(customer_headers, customer_data):
    r = requests.get(f"{API}/customer/me", headers=customer_headers, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["id"] == customer_data["id"]
    assert r.json()["email"] == customer_data["email"].lower()


def test_customer_me_with_admin_token_forbidden(auth_headers):
    r = requests.get(f"{API}/customer/me", headers=auth_headers, timeout=30)
    assert r.status_code == 403


def test_auth_me_with_customer_token_forbidden(customer_headers):
    r = requests.get(f"{API}/auth/me", headers=customer_headers, timeout=30)
    assert r.status_code == 403


def test_admin_endpoint_rejects_customer_jwt(customer_headers):
    payload = {"title": "x", "artist": "x", "genre": "x", "duration": "1:00", "cover_url": "x", "audio_url": "x"}
    r = requests.post(f"{API}/admin/songs", json=payload, headers=customer_headers, timeout=30)
    assert r.status_code == 403


def test_customer_update_profile(customer_headers):
    new_name = f"TEST Updated {_uuid.uuid4().hex[:5]}"
    r = requests.put(f"{API}/customer/me", json={"name": new_name}, headers=customer_headers, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == new_name
    # Verify via GET
    g = requests.get(f"{API}/customer/me", headers=customer_headers, timeout=30)
    assert g.json()["name"] == new_name


def test_customer_orders_empty(customer_headers):
    r = requests.get(f"{API}/customer/orders", headers=customer_headers, timeout=30)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_list_customers(auth_headers):
    r = requests.get(f"{API}/admin/customers", headers=auth_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "password_hash" not in data[0]


def test_admin_list_customers_unauthorized():
    r = requests.get(f"{API}/admin/customers", timeout=30)
    assert r.status_code == 401


def test_checkout_session_with_customer_jwt(customer_headers, customer_data):
    products = requests.get(f"{API}/products", timeout=30).json()
    pid = products[0]["id"]
    r = requests.post(f"{API}/checkout/session",
                      json={"product_id": pid, "origin_url": BASE_URL},
                      headers=customer_headers, timeout=60)
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    # Verify customer_id stored & order shows in /customer/orders
    orders = requests.get(f"{API}/customer/orders", headers=customer_headers, timeout=30).json()
    assert any(o.get("session_id") == sid for o in orders)


def test_checkout_status_no_500_for_new_session():
    """Verify the bug fix: status returns 200 + pending even if Stripe lookup fails."""
    products = requests.get(f"{API}/products", timeout=30).json()
    pid = products[0]["id"]
    r = requests.post(f"{API}/checkout/session",
                      json={"product_id": pid, "origin_url": BASE_URL}, timeout=60)
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    s = requests.get(f"{API}/checkout/status/{sid}", timeout=30)
    assert s.status_code == 200, f"checkout_status should not 500 anymore, got {s.status_code}: {s.text}"
    sd = s.json()
    assert "payment_status" in sd
    assert sd["payment_status"] in ("pending", "paid", "unpaid", "no_payment_required")


def test_checkout_status_unknown_session_404():
    r = requests.get(f"{API}/checkout/status/cs_unknown_xxx", timeout=30)
    assert r.status_code == 404
