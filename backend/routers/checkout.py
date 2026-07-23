"""Stripe checkout: session, status, webhook, apply-coupon, download, invoice."""
import asyncio
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

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
    ApplyCouponRequest,
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
from services import midtrans_service

router = APIRouter()


# ---- Coupon validation helper ----
async def _validate_coupon(code: str, amount: float):
    code = (code or "").strip().upper()
    if not code:
        return 0.0, None
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(400, "Invalid coupon code")
    if not coupon.get("active", True):
        raise HTTPException(400, "Coupon is inactive")
    exp = coupon.get("expires_at") or ""
    if exp:
        try:
            if datetime.fromisoformat(exp.replace("Z", "+00:00")) < datetime.now(timezone.utc):
                raise HTTPException(400, "Coupon has expired")
        except ValueError:
            logger.warning(f"Coupon {code} has unparseable expires_at: {exp}")
    max_uses = coupon.get("max_uses", 0) or 0
    if max_uses and coupon.get("times_used", 0) >= max_uses:
        raise HTTPException(400, "Coupon usage limit reached")

    if coupon.get("discount_type") == "percent":
        discount = round(amount * (float(coupon["discount_value"]) / 100.0), 2)
    else:
        discount = float(coupon["discount_value"])
    return max(0.0, min(discount, amount)), coupon


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


@router.post("/checkout/apply-coupon")
async def apply_coupon(body: ApplyCouponRequest):
    product = await db.products.find_one({"id": body.product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    amount = float(product["price"])
    discount, coupon = await _validate_coupon(body.code, amount)
    return {
        "valid": True,
        "code": coupon["code"],
        "discount": discount,
        "discount_type": coupon["discount_type"],
        "discount_value": coupon["discount_value"],
        "original_amount": amount,
        "final_amount": round(amount - discount, 2),
    }


@router.post("/free-claim/{product_id}")
async def free_claim(product_id: str, customer_id: str = Depends(verify_customer)):
    """Claim a free product — creates a paid transaction immediately, no Stripe."""
    product = await db.products.find_one({"id": product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.get("is_free") and float(product.get("price", 0)) > 0:
        raise HTTPException(400, "Product is not free")

    # Prevent duplicate claims by the same customer
    existing = await db.payment_transactions.find_one(
        {"customer_id": customer_id, "product_id": product_id, "payment_status": "paid"},
        {"_id": 0},
    )
    if existing:
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
        "metadata": {"free": True, "product_id": product["id"]},
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
                {"status": {"$exists": False}}
            ]
        },
        {"_id": 0},
    )

    if not product:
        raise HTTPException(404, "Product not found")

    original_amount = float(product["price"])

    # PayPal menggunakan USD
    currency = "USD"

    discount, coupon = await _validate_coupon(
        body.coupon_code or "",
        original_amount,
    )

    amount = round(original_amount - discount, 2)

    if amount <= 0:
        amount = 1.00

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

    # PayPal akan mengirim parameter token
    success_url = f"{origin}/payment/success"
    cancel_url = f"{origin}/shop/{product['id']}"

    metadata = {
        "product_id": product["id"],
        "product_name": product["name"],
        "buyer_email": buyer_email,
        "customer_id": customer_id or "",
        "coupon_code": coupon["code"] if coupon else "",
    }

    if not paypal_is_configured():
        raise HTTPException(
            503,
            "PayPal belum dikonfigurasi."
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
            "Gagal memulai checkout PayPal."
        )

    approval_url = None

    for link in paypal.get("links", []):
        if link.get("rel") == "approve":
            approval_url = link.get("href")
            break

    if not approval_url:
        raise HTTPException(
            502,
            "PayPal tidak mengembalikan approval URL."
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

    PayPal redirect:
    /payment/success?token=XXXX&PayerID=YYYY
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
            "transaction_id": txn["id"],
        }

    try:
        result = await capture_order(token)

    except Exception as e:
        logger.warning(f"PayPal capture failed: {e}")
        raise HTTPException(
            502,
            "PayPal capture failed."
        )

    status = result.get("status", "")

    if status != "COMPLETED":
        raise HTTPException(
            400,
            f"Payment status: {status}"
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
        "transaction_id": txn["id"],
        "product_id": txn["product_id"],
    }

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


# ---------------- Midtrans (Snap) ----------------
@router.post("/checkout/midtrans/session")
async def create_midtrans_session(
    body: CheckoutRequest,
    customer_id: Optional[str] = Depends(optional_customer),
):
    if not midtrans_service.is_configured():
        raise HTTPException(503, "Midtrans belum dikonfigurasi. Hubungi admin.")

    product = await db.products.find_one({"id": body.product_id, "$or": [{"status": "published"}, {"status": {"$exists": False}}]}, {"_id": 0})
    if not product:
        raise HTTPException(404, "Product not found")
    if product.get("is_free"):
        raise HTTPException(400, "Produk gratis tidak memerlukan pembayaran.")

    original_amount = float(product["price"])
    discount, coupon = await _validate_coupon(body.coupon_code or "", original_amount)
    gross = round(original_amount - discount)
    if gross < 1:
        gross = 1

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
        "metadata": {"product_id": product["id"], "product_name": product["name"]},
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
async def get_download(transaction_id: str, customer_id: str = Depends(verify_customer)):
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
    return {
        "product_name": product["name"],
        "download_url": product["download_url"],
        "filename": product.get("download_filename") or product["download_url"].split("/")[-1],
    }


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
