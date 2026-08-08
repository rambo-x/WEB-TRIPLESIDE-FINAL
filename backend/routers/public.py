"""Public catalog and crawler endpoints (no auth)."""
from datetime import datetime
from typing import List
from urllib.parse import quote
from xml.sax.saxutils import escape

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from core import db, Song, Gear, product_download_options

router = APIRouter()

SITE_URL = "https://triplesidestudio.com"
SITEMAP_STATIC_PATHS = ("/", "/songs", "/gear", "/shop", "/blog")

PRIVATE_PRODUCT_FIELDS = {
    "download_url",
    "product_storage_key",
    "product_download_filename",
    "windows_download_url",
    "windows_storage_key",
    "windows_download_filename",
    "macos_download_url",
    "macos_storage_key",
    "macos_download_filename",
}


def _public_product(item: dict) -> dict:
    item = dict(item)
    item["available_platforms"] = list(product_download_options(item))
    for field in PRIVATE_PRODUCT_FIELDS:
        item.pop(field, None)
    return item


def _sitemap_lastmod(value) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value or "").strip()
    return text[:10] if len(text) >= 10 else ""


def _sitemap_url(path: str, lastmod="") -> str:
    lines = ["  <url>", f"    <loc>{escape(f'{SITE_URL}{path}')}</loc>"]
    normalized_lastmod = _sitemap_lastmod(lastmod)
    if normalized_lastmod:
        lines.append(f"    <lastmod>{normalized_lastmod}</lastmod>")
    lines.append("  </url>")
    return "\n".join(lines)


@router.get("/")
async def root():
    return {"message": "TripleSide Studio API", "status": "ok"}


@router.head("/sitemap.xml", include_in_schema=False)
async def sitemap_head():
    return Response(
        status_code=200,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/sitemap.xml", include_in_schema=False)
async def sitemap():
    product_filter = {"$or": [{"status": "published"}, {"status": {"$exists": False}}]}
    products = await db.products.find(
        product_filter,
        {"_id": 0, "id": 1, "updated_at": 1, "published_at": 1, "created_at": 1},
    ).to_list(500)
    posts = await db.blog_posts.find(
        {"status": "published"},
        {"_id": 0, "slug": 1, "updated_at": 1, "published_at": 1, "created_at": 1},
    ).to_list(500)

    entries = [_sitemap_url(path) for path in SITEMAP_STATIC_PATHS]
    entries.extend(
        _sitemap_url(
            f"/shop/{quote(str(item['id']), safe='')}",
            item.get("updated_at") or item.get("published_at") or item.get("created_at"),
        )
        for item in products
        if item.get("id")
    )
    entries.extend(
        _sitemap_url(
            f"/blog/{quote(str(item['slug']), safe='-._~')}",
            item.get("updated_at") or item.get("published_at") or item.get("created_at"),
        )
        for item in posts
        if item.get("slug")
    )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/songs", response_model=List[Song])
async def list_songs():
    return await db.songs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/gear", response_model=List[Gear])
async def list_gear():
    return await db.gear.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/products")
async def list_products():
    items = await db.products.find(
        {"$or": [{"status": "published"}, {"status": {"$exists": False}}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return [_public_product(item) for item in items]


@router.get("/products/{product_id}")
async def get_product(product_id: str):
    item = await db.products.find_one(
        {"id": product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]},
        {"_id": 0},
    )
    if not item:
        raise HTTPException(404, "Product not found")
    return _public_product(item)
