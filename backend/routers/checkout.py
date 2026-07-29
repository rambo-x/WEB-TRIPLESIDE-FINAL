"""Stripe checkout: session, status, webhook, apply-coupon, download, invoice."""
import asyncio
import json
import os
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jwt
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

import stripe

from core import (
    db,
    APP_PUBLIC_URL,
    STRIPE_API_KEY,
    STRIPE_WEBHOOK_SECRET,
    MIDTRANS_CLIENT_KEY,
    MIDTRANS_IS_PRODUCTION,
    optional_customer,
    verify_customer,
    now_iso,
    logger,
    CheckoutRequest,
    PlatformRequest,
    CouponClaimRequest,
    ApplyCouponRequest,
    product_download_options,
    resolve_product_download,
)

from services.paypal_service import (
    is_configured as paypal_is_configured,
    create_order,
    capture_order,
    get_order,
)
from services.email_service import send_email, purchase_confirmation_html
from services.invoice_service import generate_invoice_pdf
from services.license_service import generate_license_key
from services.private_download_service import (
    create_private_download_url,
    decode_private_download_ticket,
)
from services.storage_service import open_private_file, upload_file
from services.manual_payment_service import (
    expire_pending_manual_payments,
    get_payment_settings,
)
from services import midtrans_service
from services import doku_service

router = APIRouter()

MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024
ALLOWED_PAYMENT_PROOF_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
}

try:
    COUPON_TIMEZONE = ZoneInfo(os.getenv("COUPON_TIMEZONE", "Asia/Bangkok"))
except ZoneInfoNotFoundError:
    logger.warning("Coupon timezone is unavailable; falling back to UTC")
    COUPON_TIMEZONE = timezone.utc


def _require_product_platform(product: dict, requested_platform: str) -> str:
    if (product.get("download_mode") or "platform").strip().lower() in {
        "single",
        "product",
    }:
        requested_platform = "product"
    platform, download_url = resolve_product_download(product, requested_platform)
    if platform not in {"windows", "macos", "product"}:
        raise HTTPException(400, "Pilihan download tidak valid")
    if not download_url:
        labels = {"windows": "Windows", "macos": "macOS", "product": "Product"}
        raise HTTPException(
            400,
            f"File {labels.get(platform, 'download')} tidak tersedia untuk produk ini",
        )
    return platform


def _doku_customer_payload(
    customer: dict,
    body: CheckoutRequest,
    customer_id: str,
) -> dict:
    payload = {
        "id": customer_id,
        "name": (customer.get("name") or "Customer")[:255],
    }
    email = (customer.get("email") or body.buyer_email or "").strip()
    phone = "".join(
        character
        for character in str(customer.get("phone") or "")
        if character.isdigit()
    )[:20]
    if email:
        payload["email"] = email[:128]
    if phone:
        payload["phone"] = phone
    return payload


def _coupon_expiry_moment(value: str) -> datetime:
    text_value = str(value or "").strip()
    try:
        if (
            len(text_value) == 10
            and text_value[4] == "-"
            and text_value[7] == "-"
        ):
            expiry_date = date.fromisoformat(text_value)
            return datetime.combine(
                expiry_date + timedelta(days=1),
                time.min,
                tzinfo=COUPON_TIMEZONE,
            )

        expiry = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=COUPON_TIMEZONE)
        return expiry
    except (TypeError, ValueError):
        raise HTTPException(400, "Coupon expiry date is invalid")


# ---- Coupon validation helper ----
async def _validate_coupon(code: str, amount: float, product_id: str = ""):
    code = (code or "").strip().upper()
    if not code:
        return 0.0, None
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(400, "Invalid coupon code")
    if not coupon.get("active", True):
        raise HTTPException(400, "Coupon is inactive")
    exp = coupon.get("expires_at") or ""
    if exp and datetime.now(timezone.utc) >= _coupon_expiry_moment(exp).astimezone(timezone.utc):
        raise HTTPException(400, "Coupon has expired")
    max_uses = coupon.get("max_uses", 0) or 0
    if max_uses and coupon.get("times_used", 0) >= max_uses:
        raise HTTPException(400, "Coupon usage limit reached")

    coupon_type = (coupon.get("coupon_type") or "discount").strip().lower()
    if coupon_type == "trial":
        trial_product_id = str(coupon.get("trial_product_id") or "").strip()
        if not product_id or not trial_product_id or trial_product_id != product_id:
            raise HTTPException(400, "Coupon trial tidak berlaku untuk produk ini")
        trial_days = int(coupon.get("trial_days") or 0)
        if trial_days < 1 or trial_days > 30:
            raise HTTPException(400, "Masa aktif coupon trial tidak valid")
        return 0.0, coupon
    if coupon_type != "discount":
        raise HTTPException(400, "Jenis coupon tidak valid")

    discount_product_id = str(coupon.get("discount_product_id") or "").strip()
    discount_scope = str(
        coupon.get("discount_scope")
        or ("product" if discount_product_id else "all")
    ).strip().lower()
    if discount_scope == "product":
        if not product_id or not discount_product_id or discount_product_id != product_id:
            raise HTTPException(400, "Coupon discount tidak berlaku untuk produk ini")
    elif discount_scope != "all":
        raise HTTPException(400, "Cakupan coupon discount tidak valid")

    if coupon.get("discount_type") == "percent":
        discount = round(amount * (float(coupon["discount_value"]) / 100.0), 2)
    else:
        discount = float(coupon["discount_value"])
    return max(0.0, min(discount, amount)), coupon


def _require_discount_coupon(coupon: Optional[dict]) -> None:
    if coupon and (coupon.get("coupon_type") or "discount") == "trial":
        raise HTTPException(400, "Gunakan tombol trial untuk memakai coupon ini.")


ZERO_DECIMAL_CURRENCIES = {
    "bif", "clp", "djf", "gnf", "idr", "jpy", "kmf", "krw",
    "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
}


def _stripe_unit_amount(amount: float, currency: str) -> int:
    """Convert a display amount to Stripe's smallest currency unit."""
    currency = currency.lower()
    multiplier = 1 if currency in ZERO_DECIMAL_CURRENCIES else 100
    return int(round(amount * multiplier))


def _require_stripe_config() -> None:
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe belum dikonfigurasi. Hubungi admin.")
    stripe.api_key = STRIPE_API_KEY


async def _count_coupon_usage(txn: dict) -> None:
    code = str(txn.get("coupon_code") or "").strip().upper()
    if not code:
        return
    marked = await db.payment_transactions.update_one(
        {
            "id": txn["id"],
            "coupon_usage_counted": {"$ne": True},
        },
        {
            "$set": {
                "coupon_usage_counted": True,
                "coupon_usage_counted_at": now_iso(),
            }
        },
    )
    if marked.modified_count:
        await db.coupons.update_one(
            {"code": code},
            {"$inc": {"times_used": 1}},
        )
        txn["coupon_usage_counted"] = True


async def _on_payment_succeeded(txn):
    try:
        await _count_coupon_usage(txn)
    except Exception as exc:
        logger.warning(f"Coupon usage counter failed: {exc}")

    # Auto-generate license if product requires one
    product = await db.products.find_one({"id": txn.get("product_id")}, {"_id": 0}) or {}
    license_key = ""
    max_activations = max(1, min(3, int(product.get("max_activations", 1))))
    if product.get("requires_license"):
        existing_lic = await db.licenses.find_one({"transaction_id": txn["id"]}, {"_id": 0})
        if existing_lic:
            license_key = existing_lic.get("license_key", "")
            max_activations = int(existing_lic.get("max_activations", max_activations))
        else:
            license_key = generate_license_key()
            lic_doc = {
                "id": str(uuid.uuid4()),
                "license_key": license_key,
                "product_id": product["id"],
                "product_name": product.get("name", ""),
                "customer_id": txn.get("customer_id", ""),
                "customer_name": txn.get("buyer_name", ""),
                "customer_email": txn.get("buyer_email", ""),
                "transaction_id": txn["id"],
                "hardware_id": "",
                "machine_name": "",
                "activated_at": None,
                "activations": [],
                "max_activations": max_activations,
                "license_type": "full",
                "expires_at": None,
                "status": "unactivated",
                "notes": "",
                "created_at": now_iso(),
            }
            await db.licenses.insert_one(lic_doc)
            logger.info(f"License {license_key} created for txn {txn['id']}")

    if not txn.get("email_sent") and txn.get("buyer_email"):
        dashboard_url = f"{APP_PUBLIC_URL}/dashboard" if APP_PUBLIC_URL else "/dashboard"
        html = purchase_confirmation_html(
            customer_name=txn.get("buyer_name") or "there",
            product_name=txn.get("product_name", ""),
            amount=float(txn.get("amount", 0)),
            currency=txn.get("currency", "usd"),
            dashboard_url=dashboard_url,
            license_key=license_key,
            max_activations=max_activations if license_key else 0,
        )
        sent = await send_email(
            to=txn["buyer_email"],
            subject=f"Pembayaran berhasil — {txn.get('product_name', '')}",
            html=html,
        )
        if sent:
            await db.payment_transactions.update_one(
                {"id": txn["id"]}, {"$set": {"email_sent": True, "email_sent_at": now_iso()}}
            )


def _manual_order_response(txn: dict) -> dict:
    return {
        "transaction_id": txn["id"],
        "order_id": txn.get("order_id", ""),
        "product_id": txn.get("product_id", ""),
        "product_name": txn.get("product_name", ""),
        "base_amount": txn.get("base_amount", txn.get("amount", 0)),
        "unique_code": txn.get("unique_code", 0),
        "payable_amount": txn.get("payable_amount", txn.get("amount", 0)),
        "currency": txn.get("currency", "idr"),
        "status": txn.get("status", "awaiting_payment"),
        "payment_status": txn.get("payment_status", "pending"),
        "proof_status": txn.get("proof_status", "not_uploaded"),
        "review_note": txn.get("review_note", ""),
        "expires_at": txn.get("expires_at", ""),
        "bank": txn.get("manual_bank", {}),
    }


@router.get("/checkout/payment-methods")
async def payment_methods():
    settings = await get_payment_settings(db)
    return {
        "doku_enabled": bool(settings["doku_enabled"] and doku_service.is_configured()),
        "doku_setup_required": bool(settings["doku_enabled"] and not doku_service.is_configured()),
        "manual_enabled": False,
        "manual_setup_required": False,
        "midtrans_enabled": bool(settings["midtrans_enabled"] and midtrans_service.is_configured()),
        "paypal_enabled": paypal_is_configured(),
    }


@router.post("/checkout/apply-coupon")
async def apply_coupon(body: ApplyCouponRequest):
    product = await db.products.find_one({"id": body.product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    amount = float(product["price"])
    discount, coupon = await _validate_coupon(body.code, amount, product["id"])
    if not coupon:
        raise HTTPException(400, "Invalid coupon code")
    if (coupon.get("coupon_type") or "discount") == "trial":
        return {
            "valid": True,
            "code": coupon["code"],
            "coupon_type": "trial",
            "trial_days": int(coupon["trial_days"]),
            "trial_product_id": coupon["trial_product_id"],
            "original_amount": amount,
            "final_amount": amount,
            "discount": 0.0,
        }
    return {
        "valid": True,
        "code": coupon["code"],
        "coupon_type": "discount",
        "discount": discount,
        "discount_type": coupon["discount_type"],
        "discount_value": coupon["discount_value"],
        "original_amount": amount,
        "final_amount": round(amount - discount, 2),
    }


@router.post("/free-claim/{product_id}")
async def free_claim(
    product_id: str,
    body: Optional[PlatformRequest] = None,
    customer_id: str = Depends(verify_customer),
):
    """Claim a free product — creates a paid transaction immediately, no Stripe."""
    product = await db.products.find_one({"id": product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.get("is_free") and float(product.get("price", 0)) > 0:
        raise HTTPException(400, "Product is not free")
    platform = _require_product_platform(
        product,
        body.platform if body else "windows",
    )

    # Prevent duplicate claims by the same customer
    existing = await db.payment_transactions.find_one(
        {"customer_id": customer_id, "product_id": product_id, "payment_status": "paid"},
        {"_id": 0},
    )
    if existing:
        await db.payment_transactions.update_one(
            {"id": existing["id"]},
            {"$set": {"download_platform": platform, "updated_at": now_iso()}},
        )
        return {"transaction_id": existing["id"], "already_claimed": True}

    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0}) or {}
    txn = {
        "id": str(uuid.uuid4()),
        "session_id": f"free_{uuid.uuid4().hex[:16]}",
        "product_id": product["id"],
        "product_name": product["name"],
        "amount": 0.0,
        "original_amount": 0.0,
        "discount": 0.0,
        "coupon_code": "",
        "currency": "usd",
        "buyer_email": customer.get("email", ""),
        "buyer_name": customer.get("name", ""),
        "customer_id": customer_id,
        "download_platform": platform,
        "metadata": {
            "free": True,
            "product_id": product["id"],
            "platform": platform,
        },
        "status": "complete",
        "payment_status": "paid",
        "email_sent": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.payment_transactions.insert_one(txn)
    try:
        await _on_payment_succeeded(txn)
    except Exception as e:
        logger.warning(f"Free-claim side effects failed: {e}")
    return {"transaction_id": txn["id"], "already_claimed": False}


@router.post("/coupon-claim/{product_id}")
async def coupon_claim(
    product_id: str,
    body: CouponClaimRequest,
    customer_id: str = Depends(verify_customer),
):
    product = await db.products.find_one(
        {
            "id": product_id,
            "$or": [{"status": "published"}, {"status": {"$exists": False}}],
        },
        {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product not found")
    if product.get("is_free") or float(product.get("price", 0)) <= 0:
        raise HTTPException(400, "Produk ini sudah gratis.")

    platform = _require_product_platform(product, body.platform)
    original_amount = float(product["price"])
    discount, coupon = await _validate_coupon(
        body.coupon_code,
        original_amount,
        product["id"],
    )
    _require_discount_coupon(coupon)
    if not coupon or round(original_amount - discount, 2) > 0:
        raise HTTPException(400, "Coupon ini belum membuat harga produk menjadi gratis.")

    existing = await db.payment_transactions.find_one(
        {
            "customer_id": customer_id,
            "product_id": product_id,
            "payment_status": "paid",
        },
        {"_id": 0},
    )
    if existing:
        await db.payment_transactions.update_one(
            {"id": existing["id"]},
            {"$set": {"download_platform": platform, "updated_at": now_iso()}},
        )
        return {"transaction_id": existing["id"], "already_claimed": True}

    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0}) or {}
    txn = {
        "id": str(uuid.uuid4()),
        "session_id": f"coupon_{uuid.uuid4().hex[:16]}",
        "product_id": product["id"],
        "product_name": product["name"],
        "amount": 0.0,
        "original_amount": original_amount,
        "discount": discount,
        "coupon_code": coupon["code"],
        "currency": "idr",
        "payment_method": "coupon",
        "buyer_email": customer.get("email", ""),
        "buyer_name": customer.get("name", ""),
        "customer_id": customer_id,
        "download_platform": platform,
        "metadata": {
            "coupon_free": True,
            "product_id": product["id"],
            "platform": platform,
        },
        "status": "complete",
        "payment_status": "paid",
        "email_sent": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.payment_transactions.insert_one(txn)
    try:
        await _on_payment_succeeded(txn)
    except Exception as exc:
        logger.warning(f"Coupon-claim side effects failed: {exc}")
    return {"transaction_id": txn["id"], "already_claimed": False}


@router.post("/checkout/session")
async def create_checkout(
    body: CheckoutRequest,
    request: Request,
    customer_id: Optional[str] = Depends(optional_customer),
):
    product = await db.products.find_one(
        {
            "id": body.product_id,
            "$or": [
                {"status": "published"},
                {"status": {"$exists": False}},
            ],
        },
        {"_id": 0},
    )

    if not product:
        raise HTTPException(404, "Product not found")
    platform = _require_product_platform(product, body.platform)

    original_amount = float(product["price"])
    currency = "USD"

    discount, coupon = await _validate_coupon(
        body.coupon_code or "",
        original_amount,
        product["id"],
    )
    _require_discount_coupon(coupon)

    amount = round(original_amount - discount, 2)
    if amount <= 0:
        raise HTTPException(400, "Gunakan tombol gratis untuk mengambil produk ini.")

    buyer_email = body.buyer_email or ""
    buyer_name = ""

    if customer_id:
        customer = await db.customers.find_one(
            {"id": customer_id},
            {"_id": 0},
        )

        if customer:
            buyer_email = customer.get("email", "") or buyer_email
            buyer_name = customer.get("name", "")

    origin = body.origin_url.rstrip("/")

    success_url = f"{origin}/payment/success"
    cancel_url = f"{origin}/shop/{product['id']}"

    metadata = {
        "product_id": product["id"],
        "product_name": product["name"],
        "buyer_email": buyer_email,
        "customer_id": customer_id or "",
        "coupon_code": coupon["code"] if coupon else "",
        "platform": platform,
    }

    if not paypal_is_configured():
        raise HTTPException(
            503,
            "PayPal belum dikonfigurasi.",
        )

    try:
        paypal = await create_order(
            {
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "reference_id": product["id"],
                        "description": product["name"],
                        "amount": {
                            "currency_code": currency,
                            "value": f"{amount:.2f}",
                        },
                    }
                ],
                "application_context": {
                    "brand_name": "TripleSide Studio",
                    "landing_page": "LOGIN",
                    "user_action": "PAY_NOW",
                    "return_url": success_url,
                    "cancel_url": cancel_url,
                },
            }
        )

    except Exception as e:
        logger.warning(f"PayPal create order failed: {e}")
        raise HTTPException(
            502,
            "Gagal memulai checkout PayPal.",
        )

    approval_url = None

    for link in paypal.get("links", []):
        if link.get("rel") == "approve":
            approval_url = link.get("href")
            break

    if not approval_url:
        raise HTTPException(
            502,
            "PayPal tidak mengembalikan approval URL.",
        )

    txn = {
        "id": str(uuid.uuid4()),
        "session_id": paypal["id"],
        "product_id": product["id"],
        "product_name": product["name"],
        "amount": amount,
        "original_amount": original_amount,
        "discount": discount,
        "coupon_code": coupon["code"] if coupon else "",
        "currency": currency,
        "payment_method": "paypal",
        "buyer_email": buyer_email,
        "buyer_name": buyer_name,
        "customer_id": customer_id or "",
        "download_platform": platform,
        "metadata": metadata,
        "status": "initiated",
        "payment_status": "pending",
        "email_sent": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }

    await db.payment_transactions.insert_one(txn)

    return {
        "url": approval_url,
        "session_id": paypal["id"],
    }

@router.get("/checkout/paypal/capture")
async def paypal_capture(token: str):
    """
    Capture PayPal payment setelah customer kembali dari PayPal.
    """

    txn = await db.payment_transactions.find_one(
        {"session_id": token},
        {"_id": 0},
    )

    if not txn:
        raise HTTPException(404, "Transaction not found")

    # Sudah pernah dicapture
    if txn.get("payment_status") == "paid":
        return {
            "success": True,
            "already_paid": True,
            "payment_status": "paid",
            "status": "completed",
            "transaction_id": txn["id"],
            "product_id": txn["product_id"],
        }

    # Capture ke PayPal
    try:
        result = await capture_order(token)

    except Exception as e:
        logger.warning(f"PayPal capture failed: {e}")
        raise HTTPException(
            502,
            "PayPal capture failed.",
        )

    status = result.get("status", "")

    if status != "COMPLETED":
        raise HTTPException(
            400,
            f"Payment status: {status}",
        )

    await db.payment_transactions.update_one(
        {"session_id": token},
        {
            "$set": {
                "status": "completed",
                "payment_status": "paid",
                "paypal_capture": result,
                "updated_at": now_iso(),
            }
        },
    )

    txn["status"] = "completed"
    txn["payment_status"] = "paid"

    try:
        await _on_payment_succeeded(txn)
    except Exception as e:
        logger.warning(f"Post-payment failed: {e}")

    return {
        "success": True,
        "payment_status": "paid",
        "status": "completed",
        "transaction_id": txn["id"],
        "product_id": txn["product_id"],
    }
    

# ---------------- Manual bank transfer ----------------
@router.post("/checkout/manual/session")
async def create_manual_session(
    body: CheckoutRequest,
    customer_id: str = Depends(verify_customer),
):
    raise HTTPException(
        410,
        "Transfer bank manual sudah diganti dengan pembayaran DOKU.",
    )


@router.get("/checkout/manual/{transaction_id}")
async def manual_payment_status(
    transaction_id: str,
    customer_id: str = Depends(verify_customer),
):
    await expire_pending_manual_payments(db)
    txn = await db.payment_transactions.find_one(
        {
            "id": transaction_id,
            "customer_id": customer_id,
            "payment_method": "manual_bank",
        },
        {"_id": 0},
    )
    if not txn:
        raise HTTPException(404, "Transaksi transfer bank tidak ditemukan.")
    return _manual_order_response(txn)


@router.post("/checkout/manual/{transaction_id}/proof")
async def upload_manual_payment_proof(
    transaction_id: str,
    file: UploadFile = File(...),
    customer_id: str = Depends(verify_customer),
):
    await expire_pending_manual_payments(db)
    txn = await db.payment_transactions.find_one(
        {
            "id": transaction_id,
            "customer_id": customer_id,
            "payment_method": "manual_bank",
        },
        {"_id": 0},
    )
    if not txn:
        raise HTTPException(404, "Transaksi transfer bank tidak ditemukan.")
    if txn.get("payment_status") == "paid":
        raise HTTPException(400, "Pembayaran ini sudah disetujui.")
    if txn.get("status") == "expired":
        raise HTTPException(400, "Batas waktu pembayaran sudah berakhir.")
    if txn.get("proof_status") == "submitted":
        raise HTTPException(409, "Bukti pembayaran sedang menunggu pemeriksaan admin.")
    if file.content_type not in ALLOWED_PAYMENT_PROOF_TYPES:
        raise HTTPException(400, "Bukti harus berupa JPG, PNG, WEBP, atau PDF.")

    content = await file.read(MAX_PAYMENT_PROOF_BYTES + 1)
    if len(content) > MAX_PAYMENT_PROOF_BYTES:
        raise HTTPException(400, "Ukuran bukti pembayaran maksimal 5 MB.")
    if not content:
        raise HTTPException(400, "File bukti pembayaran kosong.")

    suffix = (file.filename or "proof").rsplit(".", 1)[-1].lower()
    filename = f"payment-{txn['order_id']}.{suffix}"
    try:
        uploaded = await upload_file(content, filename, folder="tripleside/payment-proofs")
    except Exception as exc:
        logger.warning(f"Manual payment proof upload failed: {exc}")
        raise HTTPException(503, "Gagal menyimpan bukti pembayaran. Silakan coba lagi.")

    update = {
        "proof_url": uploaded["url"],
        "proof_public_id": uploaded.get("public_id", ""),
        "proof_filename": file.filename or filename,
        "proof_status": "submitted",
        "status": "awaiting_verification",
        "review_note": "",
        "proof_uploaded_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.payment_transactions.update_one({"id": transaction_id}, {"$set": update})
    txn.update(update)
    return _manual_order_response(txn)




# ---------------- DOKU Checkout ----------------
@router.post("/checkout/doku/session")
async def create_doku_session(
    body: CheckoutRequest,
    customer_id: str = Depends(verify_customer),
):
    settings = await get_payment_settings(db)
    if not settings["doku_enabled"] or not doku_service.is_configured():
        raise HTTPException(503, "DOKU belum dikonfigurasi. Hubungi admin.")
    if not APP_PUBLIC_URL:
        raise HTTPException(503, "Alamat publik aplikasi belum dikonfigurasi.")

    product = await db.products.find_one(
        {
            "id": body.product_id,
            "$or": [{"status": "published"}, {"status": {"$exists": False}}],
        },
        {"_id": 0},
    )
    if not product:
        raise HTTPException(404, "Product not found")
    if product.get("is_free"):
        raise HTTPException(400, "Produk gratis tidak memerlukan pembayaran.")
    platform = _require_product_platform(product, body.platform)

    original_amount = float(product["price"])
    discount, coupon = await _validate_coupon(
        body.coupon_code or "",
        original_amount,
        product["id"],
    )
    _require_discount_coupon(coupon)
    amount = int(round(original_amount - discount))
    if amount < 1:
        raise HTTPException(400, "Gunakan tombol gratis untuk mengambil produk ini.")
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0}) or {}
    order_id = f"DOKU{uuid.uuid4().hex[:20].upper()}"
    public_url = APP_PUBLIC_URL.rstrip("/")
    callback_url = f"{public_url}/payment/success?doku_order_id={order_id}"
    payload = {
        "order": {
            "amount": amount,
            "invoice_number": order_id,
            "currency": "IDR",
            "callback_url": callback_url,
            "callback_url_result": callback_url,
            "auto_redirect": True,
            "line_items": [
                {
                    "id": product["id"][:64],
                    "name": product["name"][:255],
                    "price": amount,
                    "quantity": 1,
                    "sku": product["id"][:64],
                    "category": (product.get("category") or "digital-product")[:64],
                }
            ],
        },
        "payment": {
            "payment_due_date": max(
                60,
                min(10080, int(settings.get("expiry_hours") or 24) * 60),
            ),
        },
        "customer": _doku_customer_payload(customer, body, customer_id),
        "additional_info": {
            "override_notification_url": f"{public_url}/api/webhook/doku",
        },
    }
    if doku_service.DOKU_PAYMENT_METHODS:
        payload["payment"]["payment_method_types"] = list(
            doku_service.DOKU_PAYMENT_METHODS
        )

    try:
        data = await doku_service.create_checkout_payment(payload)
    except doku_service.DokuError as exc:
        logger.warning(f"DOKU create session failed: {exc}")
        raise HTTPException(502, "Gagal membuat transaksi DOKU. Coba lagi.")
    except Exception as exc:
        logger.warning(f"DOKU create session unexpected failure: {exc}")
        raise HTTPException(502, "Layanan DOKU sedang tidak dapat dihubungi.")

    doku_response = data.get("response", {})
    payment = doku_response.get("payment", {})
    txn = {
        "id": str(uuid.uuid4()),
        "session_id": doku_response.get("order", {}).get("session_id") or order_id,
        "order_id": order_id,
        "product_id": product["id"],
        "product_name": product["name"],
        "amount": float(amount),
        "original_amount": original_amount,
        "discount": discount,
        "coupon_code": coupon["code"] if coupon else "",
        "currency": "idr",
        "payment_method": "doku",
        "buyer_email": customer.get("email", "") or body.buyer_email or "",
        "buyer_name": customer.get("name", ""),
        "customer_id": customer_id,
        "download_platform": platform,
        "metadata": {
            "product_id": product["id"],
            "product_name": product["name"],
            "platform": platform,
        },
        "doku": {
            "payment_url": payment.get("url"),
            "token_id": payment.get("token_id"),
            "expired_date": payment.get("expired_date"),
            "notification_request_ids": [],
        },
        "status": "initiated",
        "payment_status": "pending",
        "email_sent": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.payment_transactions.insert_one(txn)
    return {
        "order_id": order_id,
        "url": payment["url"],
        "expires_at": payment.get("expired_date"),
    }


@router.get("/checkout/doku/status/{order_id}")
async def doku_status(order_id: str):
    txn = await db.payment_transactions.find_one(
        {"order_id": order_id, "payment_method": "doku"},
        {"_id": 0},
    )
    if not txn:
        raise HTTPException(404, "Transaksi DOKU tidak ditemukan.")
    return {
        "order_id": order_id,
        "status": txn.get("status", "initiated"),
        "payment_status": txn.get("payment_status", "pending"),
        "transaction_id": txn.get("id"),
        "product_id": txn.get("product_id"),
    }


@router.post("/webhook/doku")
async def doku_webhook(request: Request):
    raw_body = await request.body()
    client_id = request.headers.get("Client-Id", "")
    request_id = request.headers.get("Request-Id", "")
    request_timestamp = request.headers.get("Request-Timestamp", "")
    signature = request.headers.get("Signature", "")
    request_target = request.url.path

    if not doku_service.verify_notification_signature(
        raw_body=raw_body,
        request_id=request_id,
        request_timestamp=request_timestamp,
        request_target=request_target,
        signature=signature,
        client_id=client_id,
    ):
        logger.warning(f"Invalid DOKU webhook signature request_id={request_id}")
        raise HTTPException(401, "Signature DOKU tidak valid.")

    try:
        body = json.loads(raw_body)
    except (TypeError, ValueError):
        raise HTTPException(400, "Payload DOKU bukan JSON yang valid.")

    order_id = str(body.get("order", {}).get("invoice_number") or "")
    transaction_status = str(
        body.get("transaction", {}).get("status") or ""
    ).upper()
    if not order_id:
        raise HTTPException(400, "Invoice DOKU tidak ditemukan.")

    txn = await db.payment_transactions.find_one(
        {"order_id": order_id, "payment_method": "doku"},
        {"_id": 0},
    )
    if not txn:
        raise HTTPException(404, "Transaksi DOKU tidak ditemukan.")

    notified_amount = body.get("order", {}).get("amount")
    if notified_amount is not None:
        try:
            amount_matches = int(round(float(notified_amount))) == int(
                round(float(txn.get("amount", 0)))
            )
        except (TypeError, ValueError):
            amount_matches = False
        if not amount_matches:
            logger.warning(f"DOKU amount mismatch order_id={order_id}")
            raise HTTPException(400, "Nominal pembayaran DOKU tidak cocok.")

    notification_update = {
        "doku.last_notification": body,
        "doku.last_notification_at": now_iso(),
        "doku.last_transaction_status": transaction_status,
        "updated_at": now_iso(),
    }
    if transaction_status == "SUCCESS":
        notification_update.update(
            {
                "status": "completed",
                "payment_status": "paid",
                "paid_at": now_iso(),
            }
        )
        result = await db.payment_transactions.update_one(
            {
                "order_id": order_id,
                "payment_method": "doku",
                "payment_status": {"$ne": "paid"},
            },
            {
                "$set": notification_update,
                "$addToSet": {"doku.notification_request_ids": request_id},
            },
        )
        if result.modified_count:
            paid_txn = await db.payment_transactions.find_one(
                {"order_id": order_id},
                {"_id": 0},
            )
            try:
                await _on_payment_succeeded(paid_txn)
            except Exception as exc:
                logger.warning(f"DOKU post-payment side-effects failed: {exc}")
        else:
            await db.payment_transactions.update_one(
                {"order_id": order_id, "payment_method": "doku"},
                {"$addToSet": {"doku.notification_request_ids": request_id}},
            )
    else:
        await db.payment_transactions.update_one(
            {"order_id": order_id, "payment_method": "doku"},
            {
                "$set": notification_update,
                "$addToSet": {"doku.notification_request_ids": request_id},
            },
        )

    return {"message": ["SUCCESS"]}


# ---------------- Midtrans (Snap) ----------------
@router.post("/checkout/midtrans/session")
async def create_midtrans_session(
    body: CheckoutRequest,
    customer_id: Optional[str] = Depends(optional_customer),
):
    settings = await get_payment_settings(db)
    if not settings["midtrans_enabled"] or not midtrans_service.is_configured():
        raise HTTPException(503, "Midtrans belum dikonfigurasi. Hubungi admin.")

    product = await db.products.find_one({"id": body.product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    if product.get("is_free"):
        raise HTTPException(400, "Produk gratis tidak memerlukan pembayaran.")
    platform = _require_product_platform(product, body.platform)

    original_amount = float(product["price"])
    discount, coupon = await _validate_coupon(
        body.coupon_code or "",
        original_amount,
        product["id"],
    )
    _require_discount_coupon(coupon)
    gross = round(original_amount - discount)
    if gross < 1:
        raise HTTPException(400, "Gunakan tombol gratis untuk mengambil produk ini.")

    buyer_email, buyer_name = body.buyer_email or "", ""
    if customer_id:
        c = await db.customers.find_one({"id": customer_id}, {"_id": 0})
        if c:
            buyer_email = c.get("email", "") or buyer_email
            buyer_name = c.get("name", "")

    order_id = f"ORD-{uuid.uuid4().hex[:12].upper()}"
    payload = {
        "transaction_details": {"order_id": order_id, "gross_amount": gross},
        "item_details": [
            {"id": product["id"], "price": gross, "quantity": 1, "name": product["name"][:50]}
        ],
        "customer_details": {
            "first_name": buyer_name or "Customer",
            "email": buyer_email or "noreply@triplesidestudio.com",
        },
        "credit_card": {"secure": True},
    }
    try:
        data = await midtrans_service.create_snap_transaction(payload)
    except Exception as e:
        logger.warning(f"Midtrans create session failed: {e}")
        raise HTTPException(502, "Gagal membuat transaksi Midtrans. Coba lagi.")

    txn = {
        "id": str(uuid.uuid4()),
        "session_id": order_id,
        "order_id": order_id,
        "product_id": product["id"],
        "product_name": product["name"],
        "amount": float(gross),
        "original_amount": original_amount,
        "discount": discount,
        "coupon_code": coupon["code"] if coupon else "",
        "currency": "idr",
        "payment_method": "midtrans",
        "buyer_email": buyer_email,
        "buyer_name": buyer_name,
        "customer_id": customer_id or "",
        "download_platform": platform,
        "metadata": {
            "product_id": product["id"],
            "product_name": product["name"],
            "platform": platform,
        },
        "midtrans": {"snap_token": data.get("token"), "redirect_url": data.get("redirect_url")},
        "status": "initiated",
        "payment_status": "pending",
        "email_sent": False,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.payment_transactions.insert_one(txn)
    return {
        "order_id": order_id,
        "token": data.get("token"),
        "redirect_url": data.get("redirect_url"),
        "client_key": MIDTRANS_CLIENT_KEY,
        "is_production": MIDTRANS_IS_PRODUCTION,
    }


async def _apply_midtrans_status(order_id: str, body: dict):
    """Update a transaction from a Midtrans status body and run side-effects once."""
    txn = await db.payment_transactions.find_one({"order_id": order_id}, {"_id": 0})
    if not txn:
        return None
    tx_status = body.get("transaction_status")
    fraud = body.get("fraud_status")
    paid = midtrans_service.is_paid(tx_status, fraud)
    if paid:
        pay_status = "paid"
    elif tx_status in ("deny", "cancel", "expire", "failure"):
        pay_status = "failed"
    else:
        pay_status = "pending"

    was_unpaid = txn.get("payment_status") != "paid"
    await db.payment_transactions.update_one(
        {"order_id": order_id},
        {"$set": {
            "status": tx_status or txn.get("status"),
            "payment_status": pay_status if pay_status != "pending" else txn.get("payment_status", "pending"),
            "midtrans.transaction_status": tx_status,
            "midtrans.fraud_status": fraud,
            "midtrans.transaction_id": body.get("transaction_id"),
            "updated_at": now_iso(),
        }},
    )
    if was_unpaid and paid:
        txn.update({"payment_status": "paid", "status": tx_status})
        try:
            await _on_payment_succeeded(txn)
        except Exception as e:
            logger.warning(f"Midtrans post-payment side-effects failed: {e}")
    return {"payment_status": "paid" if paid else pay_status, "status": tx_status}


@router.get("/checkout/midtrans/status/{order_id}")
async def midtrans_status(order_id: str):
    txn = await db.payment_transactions.find_one({"order_id": order_id}, {"_id": 0})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("payment_status") == "paid":
        return {
            "status": txn.get("status"),
            "payment_status": "paid",
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }
    try:
        body = await midtrans_service.get_transaction_status(order_id)
        result = await _apply_midtrans_status(order_id, body) or {}
        return {
            "status": result.get("status", txn.get("status", "open")),
            "payment_status": result.get("payment_status", txn.get("payment_status", "pending")),
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }
    except Exception as e:
        logger.warning(f"Midtrans status poll soft-failed for {order_id}: {e}")
        return {
            "status": txn.get("status", "open"),
            "payment_status": txn.get("payment_status", "pending"),
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }


@router.post("/webhook/midtrans")
async def midtrans_webhook(request: Request):
    payload = await request.json()
    order_id = payload.get("order_id", "")
    if not midtrans_service.verify_signature(
        order_id,
        str(payload.get("status_code", "")),
        str(payload.get("gross_amount", "")),
        payload.get("signature_key", ""),
    ):
        raise HTTPException(401, "Invalid signature")

    # Re-fetch authoritative status (source of truth); fall back to payload
    try:
        body = await midtrans_service.get_transaction_status(order_id)
        if not body:
            body = payload
    except Exception:
        body = payload
    await _apply_midtrans_status(order_id, body)
    return {"ok": True}


@router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, request: Request):
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(404, "Transaction not found")

    if txn.get("payment_status") == "paid":
        return {
            "status": txn.get("status"),
            "payment_status": "paid",
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }

    try:
        _require_stripe_config()
        session = await asyncio.to_thread(stripe.checkout.Session.retrieve, session_id)
        status = session.get("status", "open")
        payment_status = session.get("payment_status", "pending")
        was_unpaid = txn.get("payment_status") != "paid"
        update = {"status": status, "payment_status": payment_status, "updated_at": now_iso()}
        await db.payment_transactions.update_one({"session_id": session_id}, {"$set": update})
        if was_unpaid and payment_status == "paid":
            txn.update(update)
            try:
                await _on_payment_succeeded(txn)
            except Exception as e:
                logger.warning(f"Post-payment side-effects failed: {e}")
        return {
            "status": status,
            "payment_status": payment_status,
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Stripe status check soft-failed for {session_id}: {e}")
        return {
            "status": txn.get("status", "open"),
            "payment_status": txn.get("payment_status", "pending"),
            "product_id": txn.get("product_id"),
            "transaction_id": txn.get("id"),
        }


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    _require_stripe_config()
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Stripe webhook secret belum dikonfigurasi.")
    try:
        event = stripe.Webhook.construct_event(body, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as e:
        logger.warning(f"Invalid Stripe webhook: {e}")
        raise HTTPException(400, "Invalid Stripe webhook")

    if event["type"] in {
        "checkout.session.completed",
        "checkout.session.async_payment_succeeded",
        "checkout.session.async_payment_failed",
        "checkout.session.expired",
    }:
        session = event["data"]["object"]
        session_id = session.get("id", "")
        payment_status = session.get("payment_status", "pending")
        status = session.get("status", "open")
        txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if txn:
            was_unpaid = txn.get("payment_status") != "paid"
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {
                    "status": status,
                    "payment_status": payment_status,
                    "updated_at": now_iso(),
                }},
            )
            if was_unpaid and payment_status == "paid":
                txn.update({"status": status, "payment_status": "paid"})
                try:
                    await _on_payment_succeeded(txn)
                except Exception as e:
                    logger.warning(f"Webhook post-payment side-effects failed: {e}")

    return {"received": True}


@router.get("/download/{transaction_id}")
async def get_download(
    transaction_id: str,
    platform: str = "",
    customer_id: str = Depends(verify_customer),
):
    txn = await db.payment_transactions.find_one({"id": transaction_id}, {"_id": 0})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("customer_id") and txn.get("customer_id") != customer_id:
        raise HTTPException(403, "Not your transaction")
    if txn.get("payment_status") != "paid":
        raise HTTPException(403, "Payment not completed")
    product = await db.products.find_one({"id": txn["product_id"]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    selected_platform = _require_product_platform(
        product,
        platform or txn.get("download_platform") or "windows",
    )
    _, download_reference = resolve_product_download(product, selected_platform)
    storage_key = (product.get(f"{selected_platform}_storage_key") or "").strip()
    filename = (
        product.get(f"{selected_platform}_download_filename")
        or product.get("download_filename")
        or (
            download_reference.split("/")[-1]
            if not storage_key
            else f"{product['name']}-{selected_platform}.zip"
        )
    )
    download_url = download_reference
    if storage_key:
        download_url = create_private_download_url(
            storage_key=storage_key,
            filename=filename,
            customer_id=customer_id,
            product_id=product["id"],
            platform=selected_platform,
            access_type="purchase",
            access_id=txn["id"],
        )
    return {
        "product_name": product["name"],
        "platform": selected_platform,
        "available_platforms": list(product_download_options(product)),
        "download_url": download_url,
        "filename": filename,
    }


def _private_file_chunks(body):
    try:
        while True:
            chunk = body.read(1024 * 1024)
            if not chunk:
                break
            yield chunk
    finally:
        body.close()


@router.get("/download/file/{ticket}")
async def stream_private_download(ticket: str, request: Request):
    try:
        payload = decode_private_download_ticket(ticket)
    except jwt.PyJWTError:
        raise HTTPException(403, "Link download sudah tidak berlaku")

    customer_id = str(payload.get("customer_id") or "")
    product_id = str(payload.get("product_id") or "")
    platform = str(payload.get("platform") or "")
    access_type = str(payload.get("access_type") or "")
    access_id = str(payload.get("access_id") or "")
    storage_key = str(payload.get("storage_key") or "")

    if access_type == "purchase":
        access_record = await db.payment_transactions.find_one(
            {"id": access_id},
            {"_id": 0},
        )
        if (
            not access_record
            or access_record.get("payment_status") != "paid"
            or (
                access_record.get("customer_id")
                and access_record.get("customer_id") != customer_id
            )
            or access_record.get("product_id") != product_id
        ):
            raise HTTPException(403, "Akses download tidak valid")
    elif access_type == "trial":
        access_record = await db.licenses.find_one(
            {
                "id": access_id,
                "customer_id": customer_id,
                "product_id": product_id,
                "license_type": "trial",
            },
            {"_id": 0},
        )
        if not access_record:
            raise HTTPException(403, "Akses trial tidak valid")
        try:
            expires_at = datetime.fromisoformat(
                str(access_record.get("expires_at") or "").replace("Z", "+00:00")
            )
        except ValueError:
            raise HTTPException(403, "Masa trial tidak valid")
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(403, "Masa trial sudah berakhir")
    else:
        raise HTTPException(403, "Jenis akses download tidak valid")

    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product or platform not in {"windows", "macos", "product"}:
        raise HTTPException(404, "File produk tidak ditemukan")
    current_storage_key = (product.get(f"{platform}_storage_key") or "").strip()
    if not current_storage_key or current_storage_key != storage_key:
        raise HTTPException(403, "File download sudah diperbarui. Silakan klik Download lagi.")

    try:
        private_file = await open_private_file(
            storage_key,
            request.headers.get("range", ""),
        )
    except ValueError:
        raise HTTPException(416, "Rentang download tidak valid")
    except Exception as exc:
        error_code = str(
            getattr(exc, "response", {}).get("Error", {}).get("Code", "")
        )
        if error_code in {"NoSuchKey", "404", "NotFound"}:
            raise HTTPException(404, "File tidak ditemukan di penyimpanan")
        if error_code in {"InvalidRange", "416"}:
            raise HTTPException(416, "Rentang download tidak valid")
        logger.exception("Private R2 download failed")
        raise HTTPException(502, "Penyimpanan file sedang tidak dapat diakses")

    filename = os.path.basename(str(payload.get("filename") or "download.bin"))
    ascii_filename = "".join(
        character if character.isalnum() or character in "._- " else "_"
        for character in filename
    ).strip() or "download.bin"
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": (
            f'attachment; filename="{ascii_filename}"; '
            f"filename*=UTF-8''{quote(filename)}"
        ),
        "Content-Length": str(private_file["ContentLength"]),
        "X-Content-Type-Options": "nosniff",
    }
    if private_file.get("ContentRange"):
        headers["Content-Range"] = private_file["ContentRange"]
    if private_file.get("ETag"):
        headers["ETag"] = private_file["ETag"]

    return StreamingResponse(
        _private_file_chunks(private_file["Body"]),
        status_code=206 if private_file.get("ContentRange") else 200,
        media_type=private_file.get("ContentType") or "application/octet-stream",
        headers=headers,
    )


@router.get("/customer/invoice/{transaction_id}")
async def customer_invoice(transaction_id: str, customer_id: str = Depends(verify_customer)):
    txn = await db.payment_transactions.find_one({"id": transaction_id}, {"_id": 0})
    if not txn:
        raise HTTPException(404, "Transaction not found")
    if txn.get("customer_id") != customer_id:
        raise HTTPException(403, "Not your transaction")
    if txn.get("payment_status") != "paid":
        raise HTTPException(403, "Invoice only available for paid transactions")

    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0, "password_hash": 0}) or {}
    invoice_no = txn["id"][:8].upper()
    pdf_bytes = generate_invoice_pdf(
        invoice_no=invoice_no,
        customer_name=customer.get("name", txn.get("buyer_name") or ""),
        customer_email=customer.get("email", txn.get("buyer_email") or ""),
        customer_phone=customer.get("phone", ""),
        product_name=txn.get("product_name", ""),
        amount=float(txn.get("amount", 0)),
        currency=txn.get("currency", "usd"),
        paid_at=txn.get("updated_at") or txn.get("created_at", ""),
        transaction_id=txn["id"],
        discount=float(txn.get("discount", 0)),
        coupon_code=txn.get("coupon_code", ""),
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice-{invoice_no}.pdf"'},
    )
