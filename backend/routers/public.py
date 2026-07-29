"""Public catalog endpoints: songs, gear, products (no auth)."""
from typing import List
from fastapi import APIRouter, HTTPException
from core import db, Song, Gear, product_download_options

router = APIRouter()

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


@router.get("/")
async def root():
    return {"message": "TripleSide Studio API", "status": "ok"}


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
