"""Iteration 5 tests: free digital products, blog CRUD/public, YouTube/Spotify song embeds, regressions."""
import os
import uuid
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://tripleside-studio.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = "tripleside2025"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def new_customer():
    """Register a fresh customer dedicated to free-claim 'first claim' tests."""
    suffix = uuid.uuid4().hex[:10]
    email = f"TEST_it5_{suffix}@example.com"
    password = "secret12345"
    r = requests.post(
        f"{API}/customer/register",
        json={"name": f"TEST it5 {suffix}", "email": email, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    return {"email": email, "password": password, "token": token, "headers": {"Authorization": f"Bearer {token}"}}


@pytest.fixture(scope="session")
def existing_free_product():
    r = requests.get(f"{API}/products", timeout=20)
    assert r.status_code == 200
    free = [p for p in r.json() if p.get("is_free")]
    if not free:
        pytest.skip("No free product in DB; cannot run free-claim tests")
    return free[0]


# ---------- Regressions ----------
class TestRegression:
    def test_songs_list(self):
        r = requests.get(f"{API}/songs", timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_gear_list(self):
        r = requests.get(f"{API}/gear", timeout=20)
        assert r.status_code == 200

    def test_products_list(self):
        r = requests.get(f"{API}/products", timeout=20)
        assert r.status_code == 200

    def test_admin_customers(self, admin_headers):
        r = requests.get(f"{API}/admin/customers", headers=admin_headers, timeout=20)
        assert r.status_code == 200

    def test_auth_me(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        assert r.json().get("email") == ADMIN_EMAIL

    def test_customer_me(self, new_customer):
        r = requests.get(f"{API}/customer/me", headers=new_customer["headers"], timeout=20)
        assert r.status_code == 200
        assert r.json()["email"].lower() == new_customer["email"].lower()


# ---------- Songs with track_type youtube/spotify ----------
class TestSongTrackTypes:
    created_ids = []

    def _payload(self, ttype, embed):
        return {
            "title": f"TEST_it5 {ttype} {uuid.uuid4().hex[:6]}",
            "artist": "TEST",
            "genre": "Test",
            "duration": "3:30",
            "cover_url": "https://placehold.co/300",
            "audio_url": "",
            "track_type": ttype,
            "embed_url": embed,
            "release_year": 2026,
            "description": f"{ttype} test",
        }

    def test_create_youtube_song(self, admin_headers):
        body = self._payload("youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        r = requests.post(f"{API}/admin/songs", json=body, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["track_type"] == "youtube"
        assert "youtube.com" in data["embed_url"]
        assert data["id"]
        TestSongTrackTypes.created_ids.append(data["id"])

        # Persisted
        listing = requests.get(f"{API}/songs", timeout=20).json()
        assert any(s["id"] == data["id"] and s["track_type"] == "youtube" for s in listing)

    def test_create_spotify_song(self, admin_headers):
        body = self._payload("spotify", "https://open.spotify.com/track/2takcwOaAZWiXQijPHIx7B")
        r = requests.post(f"{API}/admin/songs", json=body, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["track_type"] == "spotify"
        assert "spotify.com" in data["embed_url"]
        TestSongTrackTypes.created_ids.append(data["id"])

    def test_cleanup_created_songs(self, admin_headers):
        for sid in TestSongTrackTypes.created_ids:
            r = requests.delete(f"{API}/admin/songs/{sid}", headers=admin_headers, timeout=20)
            assert r.status_code in (200, 404)


# ---------- Free Product CRUD ----------
class TestFreeProductCreate:
    created_id = None

    def test_create_free_product(self, admin_headers):
        body = {
            "name": f"TEST_it5 Free {uuid.uuid4().hex[:6]}",
            "category": "Samples",
            "image_url": "https://placehold.co/300",
            "description": "free test product",
            "price": 0,
            "is_free": True,
            "preview_audio_url": "",
            "download_url": "https://example.com/free.zip",
        }
        r = requests.post(f"{API}/admin/products", json=body, headers=admin_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_free"] is True
        assert data["price"] == 0
        TestFreeProductCreate.created_id = data["id"]

        # GET verify
        listing = requests.get(f"{API}/products", timeout=20).json()
        assert any(p["id"] == data["id"] and p.get("is_free") for p in listing)

    def test_cleanup_free_product(self, admin_headers):
        if TestFreeProductCreate.created_id:
            r = requests.delete(
                f"{API}/admin/products/{TestFreeProductCreate.created_id}",
                headers=admin_headers,
                timeout=20,
            )
            assert r.status_code in (200, 404)


# ---------- Free Claim ----------
class TestFreeClaim:
    def test_free_claim_no_auth_401(self, existing_free_product):
        r = requests.post(f"{API}/free-claim/{existing_free_product['id']}", timeout=20)
        # verify_customer raises 401 Missing token via _decode
        assert r.status_code in (401, 403), r.text

    def test_free_claim_non_free_returns_400(self, new_customer):
        # find a paid product
        prods = requests.get(f"{API}/products", timeout=20).json()
        paid = [p for p in prods if not p.get("is_free") and float(p.get("price", 0)) > 0]
        if not paid:
            pytest.skip("No paid product in DB")
        r = requests.post(
            f"{API}/free-claim/{paid[0]['id']}", headers=new_customer["headers"], timeout=20
        )
        assert r.status_code == 400, r.text

    def test_free_claim_first_time(self, new_customer, existing_free_product):
        r = requests.post(
            f"{API}/free-claim/{existing_free_product['id']}",
            headers=new_customer["headers"],
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["already_claimed"] is False
        assert data["transaction_id"]
        # Save txn id on the fixture for the next test
        new_customer["txn_id"] = data["transaction_id"]

    def test_free_claim_idempotent(self, new_customer, existing_free_product):
        first_txn = new_customer.get("txn_id")
        r = requests.post(
            f"{API}/free-claim/{existing_free_product['id']}",
            headers=new_customer["headers"],
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["already_claimed"] is True
        assert data["transaction_id"] == first_txn

    def test_customer_orders_includes_free(self, new_customer):
        r = requests.get(f"{API}/customer/orders", headers=new_customer["headers"], timeout=20)
        assert r.status_code == 200, r.text
        orders = r.json()
        free_txns = [o for o in orders if float(o.get("amount", 0)) == 0 and o.get("payment_status") == "paid"]
        assert len(free_txns) >= 1, f"Expected at least one free transaction, got {orders}"


# ---------- Blog Public ----------
class TestBlogPublic:
    def test_list_only_published(self):
        r = requests.get(f"{API}/blog", timeout=20)
        assert r.status_code == 200, r.text
        posts = r.json()
        assert isinstance(posts, list)
        # All posts must NOT include drafts. Since router projects content out, just check no draft status
        for p in posts:
            assert p.get("status", "published") == "published"

    def test_get_published_post(self):
        # Try the seeded post slug; fall back to first published if seed slug differs
        r = requests.get(f"{API}/blog/tripleside-studio", timeout=20)
        if r.status_code == 200:
            data = r.json()
            assert data["slug"] == "tripleside-studio"
            assert "content" in data
        else:
            # Fallback: get any published
            posts = requests.get(f"{API}/blog", timeout=20).json()
            assert posts, "No published posts and seed slug not found"
            slug = posts[0]["slug"]
            r2 = requests.get(f"{API}/blog/{slug}", timeout=20)
            assert r2.status_code == 200
            assert "content" in r2.json()

    def test_get_nonexistent_404(self):
        r = requests.get(f"{API}/blog/nonexistent-{uuid.uuid4().hex[:6]}", timeout=20)
        assert r.status_code == 404


# ---------- Blog Admin CRUD ----------
class TestBlogAdmin:
    created_ids = []

    def test_admin_create_no_auth_401(self):
        r = requests.post(
            f"{API}/admin/blog",
            json={"title": "x", "content": "x"},
            timeout=20,
        )
        assert r.status_code in (401, 403)

    def test_admin_create_with_auto_slug(self, admin_headers):
        title = f"TEST it5 My First Post {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/admin/blog",
            json={"title": title, "content": "# Hello\n\nMarkdown here.", "status": "draft"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Slug should be lowercase-hyphen
        assert data["slug"].startswith("test-it5-my-first-post")
        assert data["status"] == "draft"
        assert data["published_at"] in (None, "")
        TestBlogAdmin.created_ids.append((data["id"], data["slug"], data["title"]))

    def test_admin_create_duplicate_slug_gets_suffix(self, admin_headers):
        original_id, original_slug, original_title = TestBlogAdmin.created_ids[-1]
        r = requests.post(
            f"{API}/admin/blog",
            json={"title": original_title, "content": "second", "status": "draft"},
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["slug"] != original_slug
        assert data["slug"].startswith(original_slug)
        # Expect -2 suffix appended for first dup
        assert data["slug"].endswith("-2")
        TestBlogAdmin.created_ids.append((data["id"], data["slug"], data["title"]))

    def test_admin_list_returns_drafts(self, admin_headers):
        r = requests.get(f"{API}/admin/blog", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        posts = r.json()
        ids = [p["id"] for p in posts]
        for pid, _, _ in TestBlogAdmin.created_ids:
            assert pid in ids
        # Confirm some drafts exist
        assert any(p.get("status") == "draft" for p in posts)

    def test_admin_update_publishes_post(self, admin_headers):
        post_id, slug, title = TestBlogAdmin.created_ids[0]
        r = requests.put(
            f"{API}/admin/blog/{post_id}",
            json={
                "title": title,
                "slug": slug,
                "content": "# Updated\n\nNow published.",
                "status": "published",
            },
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "published"
        assert data.get("published_at")

        # Now visible publicly
        rp = requests.get(f"{API}/blog/{slug}", timeout=20)
        assert rp.status_code == 200

    def test_admin_delete(self, admin_headers):
        for pid, _, _ in TestBlogAdmin.created_ids:
            r = requests.delete(f"{API}/admin/blog/{pid}", headers=admin_headers, timeout=20)
            assert r.status_code in (200, 404)
