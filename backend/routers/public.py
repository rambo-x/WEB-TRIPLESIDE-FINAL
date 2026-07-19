"""Public catalog endpoints: songs, gear, products (no auth)."""
from typing import List
from fastapi import APIRouter, HTTPException
from core import db, Song, Gear, DigitalProduct

router = APIRouter()


@router.get("/")
async def root():
    return {"message": "TripleSide Studio API", "status": "ok"}


@router.get("/songs", response_model=List[Song])
async def list_songs():
    return await db.songs.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/gear", response_model=List[Gear])
async def list_gear():
    return await db.gear.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/products", response_model=List[DigitalProduct])
async def list_products():
    return await db.products.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/products/{product_id}", response_model=DigitalProduct)
async def get_product(product_id: str):
    item = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Product not found")
    return item
