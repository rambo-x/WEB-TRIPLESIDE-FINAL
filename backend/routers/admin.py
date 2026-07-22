"""Admin CRUD: songs, gear, products, coupons + listings (customers, transactions) + file upload."""
from typing import List
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from core import (
    db,
    verify_admin,
    now_iso,
    logger,
    Song,
    SongInput,
    Gear,
    GearInput,
    DigitalProduct,
    ProductInput,
    Coupon,
    CouponInput,
    BlogPost,
    BlogPostInput,
)
from services.storage_service import upload_file, CLOUDINARY_CONFIGURED
from services.email_service import send_campaign_email

router = APIRouter(dependencies=[Depends(verify_admin)])


def _slugify(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-") or uuid.uuid4().hex[:8]


# ---- Songs ----
@router.post("/songs", response_model=Song)
async def create_song(body: SongInput):
    song = Song(**body.model_dump())
    await db.songs.insert_one(song.model_dump())
    return song


@router.put("/songs/{song_id}", response_model=Song)
async def update_song(song_id: str, body: SongInput):
    updated = await db.songs.find_one_and_update(
        {"id": song_id}, {"$set": body.model_dump()}, return_document=True, projection={"_id": 0}
    )
    if not updated:
        raise HTTPException(404, "Song not found")
    return updated


@router.delete("/songs/{song_id}")
async def delete_song(song_id: str):
    r = await db.songs.delete_one({"id": song_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Song not found")
    return {"ok": True}


# ---- Gear ----
@router.post("/gear", response_model=Gear)
async def create_gear(body: GearInput):
    gear = Gear(**body.model_dump())
    await db.gear.insert_one(gear.model_dump())
    return gear


@router.put("/gear/{gear_id}", response_model=Gear)
async def update_gear(gear_id: str, body: GearInput):
    updated = await db.gear.find_one_and_update(
        {"id": gear_id}, {"$set": body.model_dump()}, return_document=True, projection={"_id": 0}
    )
    if not updated:
        raise HTTPException(404, "Gear not found")
    return updated


@router.delete("/gear/{gear_id}")
async def delete_gear(gear_id: str):
    r = await db.gear.delete_one({"id": gear_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Gear not found")
    return {"ok": True}


# ---- Products ----
def _product_status(value: str) -> str:
    return "published" if value == "published" else "draft"


@router.get("/products", response_model=List[DigitalProduct])
async def admin_list_products():
    # Admin sees drafts and published products. Existing products without a status
    # are treated as published so the live catalog is not disrupted.
    items = await db.products.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for item in items:
        item.setdefault("status", "published")
        item.setdefault("updated_at", item.get("created_at", now_iso()))
    return items


@router.post("/products", response_model=DigitalProduct)
async def create_product(body: ProductInput):
    data = body.model_dump()
    data["status"] = _product_status(data.get("status"))
    data["published_at"] = now_iso() if data["status"] == "published" else None
    product = DigitalProduct(**data)
    await db.products.insert_one(product.model_dump())
    return product


@router.put("/products/{product_id}", response_model=DigitalProduct)
async def update_product(product_id: str, body: ProductInput):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Product not found")
    updates = body.model_dump()
    updates["status"] = _product_status(updates.get("status"))
    updates["updated_at"] = now_iso()
    if updates["status"] == "published" and not existing.get("published_at"):
        updates["published_at"] = now_iso()
    updated = await db.products.find_one_and_update(
        {"id": product_id}, {"$set": updates}, return_document=True, projection={"_id": 0}
    )
    return updated


@router.post("/products/{product_id}/publish", response_model=DigitalProduct)
async def publish_product(product_id: str):
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": {"status": "published", "published_at": now_iso(), "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not updated:
        raise HTTPException(404, "Product not found")
    return updated


@router.post("/products/{product_id}/unpublish", response_model=DigitalProduct)
async def unpublish_product(product_id: str):
    updated = await db.products.find_one_and_update(
        {"id": product_id},
        {"$set": {"status": "draft", "updated_at": now_iso()}},
        return_document=True,
        projection={"_id": 0},
    )
    if not updated:
        raise HTTPException(404, "Product not found")
    return updated


@router.delete("/products/{product_id}")
async def delete_product(product_id: str):
    r = await db.products.delete_one({"id": product_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Product not found")
    return {"ok": True}


# ---- Listings ----
@router.get("/transactions")
async def list_transactions():
    return await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/customers")
async def list_customers():
    return await db.customers.find(
        {}, {"_id": 0, "password_hash": 0}
    ).sort("created_at", -1).to_list(1000)


# ---- Coupons ----
@router.get("/coupons", response_model=List[Coupon])
async def list_coupons():
    return await db.coupons.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/coupons", response_model=Coupon)
async def create_coupon(body: CouponInput):
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(400, "Code required")
    if body.discount_type not in ("percent", "amount"):
        raise HTTPException(400, "discount_type must be 'percent' or 'amount'")
    if body.discount_value <= 0:
        raise HTTPException(400, "discount_value must be > 0")
    if await db.coupons.find_one({"code": code}, {"_id": 0}):
        raise HTTPException(409, "Coupon code already exists")
    coupon = Coupon(**{**body.model_dump(), "code": code})
    await db.coupons.insert_one(coupon.model_dump())
    return coupon


@router.put("/coupons/{coupon_id}", response_model=Coupon)
async def update_coupon(coupon_id: str, body: CouponInput):
    updates = body.model_dump()
    updates["code"] = updates["code"].strip().upper()
    updated = await db.coupons.find_one_and_update(
        {"id": coupon_id}, {"$set": updates}, return_document=True, projection={"_id": 0}
    )
    if not updated:
        raise HTTPException(404, "Coupon not found")
    return updated


@router.delete("/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str):
    r = await db.coupons.delete_one({"id": coupon_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Coupon not found")
    return {"ok": True}


# ---- File upload (Cloudinary) ----
@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    folder: str = Form("tripleside/products"),
):
    if not CLOUDINARY_CONFIGURED:
        raise HTTPException(503, "Cloudinary not configured. Set CLOUDINARY_API_SECRET in backend/.env")
    contents = await file.read()
    if not contents:
        raise HTTPException(400, "Empty file")
    try:
        return await upload_file(contents, file.filename or "upload", folder=folder)
    except Exception as e:
        logger.exception("Cloudinary upload failed")
        raise HTTPException(500, f"Upload failed: {e}")


# ---- Blog (Markdown CMS) ----
@router.get("/blog")
async def admin_list_blog():
    return await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


async def _ensure_unique_slug(base: str, exclude_id: str = "") -> str:
    slug = base
    n = 2
    while True:
        existing = await db.blog_posts.find_one({"slug": slug}, {"_id": 0, "id": 1})
        if not existing or existing.get("id") == exclude_id:
            return slug
        slug = f"{base}-{n}"
        n += 1


@router.post("/blog", response_model=BlogPost)
async def admin_create_blog(body: BlogPostInput):
    if not body.title.strip() or not body.content.strip():
        raise HTTPException(400, "Title and content are required")
    base_slug = _slugify(body.slug or body.title)
    slug = await _ensure_unique_slug(base_slug)
    post = BlogPost(
        slug=slug,
        title=body.title.strip(),
        excerpt=(body.excerpt or "").strip(),
        content=body.content,
        featured_image=body.featured_image,
        tags=body.tags or [],
        status=body.status if body.status in ("draft", "published") else "draft",
        author=body.author or "TripleSide Studio",
        published_at=now_iso() if body.status == "published" else None,
    )
    await db.blog_posts.insert_one(post.model_dump())
    return post


@router.put("/blog/{post_id}", response_model=BlogPost)
async def admin_update_blog(post_id: str, body: BlogPostInput):
    existing = await db.blog_posts.find_one({"id": post_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Post not found")
    base_slug = _slugify(body.slug or body.title)
    slug = await _ensure_unique_slug(base_slug, exclude_id=post_id)
    update = {
        "title": body.title.strip(),
        "slug": slug,
        "excerpt": (body.excerpt or "").strip(),
        "content": body.content,
        "featured_image": body.featured_image,
        "tags": body.tags or [],
        "status": body.status if body.status in ("draft", "published") else "draft",
        "author": body.author or "TripleSide Studio",
        "updated_at": now_iso(),
    }
    if body.status == "published" and not existing.get("published_at"):
        update["published_at"] = now_iso()
    updated = await db.blog_posts.find_one_and_update(
        {"id": post_id}, {"$set": update}, return_document=True, projection={"_id": 0}
    )
    return updated


@router.delete("/blog/{post_id}")
async def admin_delete_blog(post_id: str):
    r = await db.blog_posts.delete_one({"id": post_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Post not found")
    return {"ok": True}



# ==========================================================
# EMAIL CAMPAIGN
# ==========================================================

@router.post("/email-campaign/send")
async def send_email_campaign(body: dict):
    """
    Body:
    {
        "subject": "...",
        "message": "...",
        "target":"all"
    }

    target:
        all
        paid
        full
        trial
    """

    subject = body.get("subject", "").strip()
    message = body.get("message", "").strip()
    target = body.get("target", "all")

    if not subject:
        raise HTTPException(400, "Subject required")

    if not message:
        raise HTTPException(400, "Message required")

    emails = []

    # -------------------------------------
    # ALL CUSTOMERS
    # -------------------------------------

    if target == "all":

        customers = await db.customers.find(
            {},
            {
                "_id": 0,
                "email": 1,
            },
        ).to_list(5000)

        emails = [
            c["email"]
            for c in customers
            if c.get("email")
        ]

    # -------------------------------------
    # PAID CUSTOMER
    # -------------------------------------

    elif target == "paid":

        trx = await db.payment_transactions.find(
            {
                "payment_status": "paid"
            },
            {
                "_id": 0,
                "customer_email": 1,
            },
        ).to_list(5000)

        emails = list(
            {
                t["customer_email"]
                for t in trx
                if t.get("customer_email")
            }
        )

    # -------------------------------------
    # FULL LICENSE
    # -------------------------------------

    elif target == "full":

        licenses = await db.licenses.find(
            {
                "license_type": "full"
            },
            {
                "_id": 0,
                "customer_email": 1,
            },
        ).to_list(5000)

        emails = list(
            {
                l["customer_email"]
                for l in licenses
                if l.get("customer_email")
            }
        )

    # -------------------------------------
    # TRIAL LICENSE
    # -------------------------------------

    elif target == "trial":

        licenses = await db.licenses.find(
            {
                "license_type": "trial"
            },
            {
                "_id": 0,
                "customer_email": 1,
            },
        ).to_list(5000)

        emails = list(
            {
                l["customer_email"]
                for l in licenses
                if l.get("customer_email")
            }
        )

    else:
        raise HTTPException(400, "Unknown target")

    if len(emails) == 0:
        raise HTTPException(404, "No recipient found")

    result = await send_campaign_email(
        recipients=emails,
        subject=subject,
        message=message,
    )

    return result
