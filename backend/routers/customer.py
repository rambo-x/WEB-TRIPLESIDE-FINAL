"""Customer auth + profile + orders + forgot/reset password."""
import uuid
import bcrypt
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request

from core import (
    db,
    APP_PUBLIC_URL,
    create_token,
    verify_customer,
    normalize_phone,
    now_iso,
    logger,
    CustomerRegisterRequest,
    CustomerLoginRequest,
    CustomerProfile,
    CustomerUpdateRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from core.rate_limit import forgot_password_limiter, login_limiter
from services.email_service import send_email, password_reset_html

router = APIRouter()


@router.post("/customer/register")
async def customer_register(body: CustomerRegisterRequest, request: Request):
    login_limiter.check(request)
    email = (body.email or "").strip().lower()
    phone = normalize_phone(body.phone)
    if not email and not phone:
        raise HTTPException(400, "Email or phone is required")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    if email and await db.customers.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(409, "Email already registered")
    if phone and await db.customers.find_one({"phone": phone}, {"_id": 0}):
        raise HTTPException(409, "Phone already registered")

    customer_id = str(uuid.uuid4())
    doc = {
        "id": customer_id,
        "name": body.name.strip(),
        "email": email,
        "phone": phone,
        "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
        "created_at": now_iso(),
    }
    await db.customers.insert_one(doc)
    token = create_token(customer_id, role="customer")
    profile = {k: doc[k] for k in ("id", "name", "email", "phone", "created_at")}
    return {"token": token, "customer": profile}


@router.post("/customer/login")
async def customer_login(body: CustomerLoginRequest, request: Request):
    login_limiter.check(request)
    identifier = body.identifier.strip()
    customer = await db.customers.find_one(
        {"$or": [{"email": identifier.lower()}, {"phone": normalize_phone(identifier)}]},
        {"_id": 0},
    )
    if not customer or not bcrypt.checkpw(body.password.encode(), customer["password_hash"].encode()):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(customer["id"], role="customer")
    profile = {k: customer.get(k, "") for k in ("id", "name", "email", "phone", "created_at")}
    return {"token": token, "customer": profile}


@router.get("/customer/me", response_model=CustomerProfile)
async def customer_me(customer_id: str = Depends(verify_customer)):
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0, "password_hash": 0})
    if not customer:
        raise HTTPException(404, "Customer not found")
    return customer


@router.put("/customer/me", response_model=CustomerProfile)
async def customer_update(body: CustomerUpdateRequest, customer_id: str = Depends(verify_customer)):
    updates = {}
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(400, "Name cannot be empty")
        updates["name"] = body.name.strip()
    if body.email is not None:
        new_email = body.email.strip().lower()
        if new_email:
            other = await db.customers.find_one({"email": new_email, "id": {"$ne": customer_id}}, {"_id": 0})
            if other:
                raise HTTPException(409, "Email already taken")
        updates["email"] = new_email
    if body.phone is not None:
        new_phone = normalize_phone(body.phone)
        if new_phone:
            other = await db.customers.find_one({"phone": new_phone, "id": {"$ne": customer_id}}, {"_id": 0})
            if other:
                raise HTTPException(409, "Phone already taken")
        updates["phone"] = new_phone
    if updates:
        await db.customers.update_one({"id": customer_id}, {"$set": updates})
    return await db.customers.find_one({"id": customer_id}, {"_id": 0, "password_hash": 0})


@router.get("/customer/orders")
async def customer_orders(customer_id: str = Depends(verify_customer)):
    txns = await db.payment_transactions.find(
        {"customer_id": customer_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    product_ids = list({t["product_id"] for t in txns if t.get("product_id")})
    products = {}
    if product_ids:
        async for p in db.products.find({"id": {"$in": product_ids}}, {"_id": 0}):
            products[p["id"]] = p
    for t in txns:
        prod = products.get(t.get("product_id"))
        if prod:
            t["product_image"] = prod.get("image_url", "")
            t["product_category"] = prod.get("category", "")
    return txns


@router.delete("/customer/orders/{transaction_id}")
async def customer_delete_order(transaction_id: str, customer_id: str = Depends(verify_customer)):
    txn = await db.payment_transactions.find_one(
        {"id": transaction_id, "customer_id": customer_id}, {"_id": 0}
    )
    if not txn:
        raise HTTPException(404, "Order not found")
    if txn.get("payment_status") == "paid":
        raise HTTPException(400, "Paid orders cannot be deleted")
    await db.payment_transactions.delete_one({"id": transaction_id, "customer_id": customer_id})
    return {"ok": True}


# ---- Forgot / Reset Password ----
@router.post("/customer/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, request: Request):
    forgot_password_limiter.check(request)
    email = body.email.strip().lower()
    customer = await db.customers.find_one({"email": email}, {"_id": 0})
    if not customer:
        return {"ok": True, "message": "If the email exists, a reset link has been sent."}

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.password_resets.insert_one({
        "token": token,
        "customer_id": customer["id"],
        "expires_at": expires.isoformat(),
        "used": False,
        "created_at": now_iso(),
    })

    base = APP_PUBLIC_URL.rstrip("/") if APP_PUBLIC_URL else ""
    reset_url = f"{base}/reset-password?token={token}"
    html = password_reset_html(customer.get("name", "there"), reset_url)
    try:
        await send_email(to=email, subject="Reset your TripleSide password", html=html)
    except Exception as e:
        logger.warning(f"Password reset email send failed: {e}")
    return {"ok": True, "message": "If the email exists, a reset link has been sent."}


@router.post("/customer/reset-password")
async def reset_password(body: ResetPasswordRequest):
    if len(body.new_password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    record = await db.password_resets.find_one({"token": body.token}, {"_id": 0})
    if not record or record.get("used"):
        raise HTTPException(400, "Invalid or already-used reset token")
    try:
        exp = datetime.fromisoformat(record["expires_at"])
        if exp < datetime.now(timezone.utc):
            raise HTTPException(400, "Reset token has expired")
    except ValueError:
        raise HTTPException(400, "Invalid token format")

    new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    await db.customers.update_one({"id": record["customer_id"]}, {"$set": {"password_hash": new_hash}})
    await db.password_resets.update_one({"token": body.token}, {"$set": {"used": True, "used_at": now_iso()}})
    return {"ok": True}
