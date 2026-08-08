"""Customer auth + profile + orders + forgot/reset password."""
import hashlib
import uuid
import bcrypt
import phonenumbers
import secrets
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import (
    db,
    APP_PUBLIC_URL,
    JWT_SECRET,
    create_token,
    verify_customer,
    normalize_phone,
    validate_and_normalize_phone,
    now_iso,
    logger,
    CustomerRegistrationStartRequest,
    RegistrationOtpVerifyRequest,
    RegistrationOtpResendRequest,
    PhoneValidationRequest,
    CustomerLoginRequest,
    CustomerProfile,
    CustomerUpdateRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    normalize_download_platform,
    product_download_options,
)
from core.rate_limit import forgot_password_limiter, login_limiter, registration_otp_limiter
from services.email_service import send_email, password_reset_html, registration_otp_html
from services.manual_payment_service import expire_pending_manual_payments

router = APIRouter()

OTP_EXPIRES_MINUTES = 10
OTP_RESEND_SECONDS = 60
OTP_MAX_ATTEMPTS = 5


def _registration_otp_hash(email: str, code: str) -> str:
    payload = f"{JWT_SECRET}:{email}:{code}".encode()
    return hashlib.sha256(payload).hexdigest()


def _registration_pending_key(email: str) -> str:
    return f"registration:{hashlib.sha256(email.encode()).hexdigest()}"


def _mask_email(email: str) -> str:
    local, domain = email.split("@", 1)
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'*' * max(3, len(local) - len(visible))}@{domain}"


@router.get("/customer/phone-countries")
async def customer_phone_countries():
    countries = []
    for region in sorted(phonenumbers.SUPPORTED_REGIONS):
        calling_code = phonenumbers.country_code_for_region(region)
        if calling_code:
            countries.append({"country": region, "calling_code": f"+{calling_code}"})
    return countries


@router.post("/customer/validate-phone")
async def customer_validate_phone(body: PhoneValidationRequest):
    try:
        normalized = validate_and_normalize_phone(body.phone, body.country_code)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"valid": True, "e164": normalized}


@router.post("/customer/register/request-otp")
async def customer_request_registration_otp(body: CustomerRegistrationStartRequest, request: Request):
    registration_otp_limiter.check(request)
    email = str(body.email).strip().lower()
    name = body.name.strip()
    try:
        phone = validate_and_normalize_phone(body.phone, body.phone_country)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not name:
        raise HTTPException(400, "Name is required")
    if len(body.password.encode()) > 72:
        raise HTTPException(400, "Password must not exceed 72 bytes")
    if await db.customers.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(409, "Email already registered")
    if await db.customers.find_one({"phone": phone}, {"_id": 0, "id": 1}):
        raise HTTPException(409, "Phone already registered")

    now = datetime.now(timezone.utc)
    recent = await db.registration_otps.find_one(
        {"email": email, "used": False, "resend_available_at": {"$gt": now}},
        {"_id": 0, "id": 1},
    )
    if recent:
        raise HTTPException(429, "Please wait before requesting another OTP")

    pending_key = _registration_pending_key(email)
    await db.registration_otps.update_many(
        {"email": email, "used": False, "_id": {"$ne": pending_key}},
        {"$set": {"used": True, "status": "superseded", "superseded_at": now}},
    )
    code = f"{secrets.randbelow(1_000_000):06d}"
    registration_id = str(uuid.uuid4())
    pending = {
        "_id": pending_key,
        "id": registration_id,
        "customer_id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "phone": phone,
        "phone_country": body.phone_country.upper(),
        "password_hash": bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
        "code_hash": _registration_otp_hash(email, code),
        "attempts": 0,
        "used": False,
        "status": "pending",
        "created_at": now,
        "expires_at": now + timedelta(minutes=OTP_EXPIRES_MINUTES),
        "resend_available_at": now + timedelta(seconds=OTP_RESEND_SECONDS),
    }
    await db.registration_otps.replace_one({"_id": pending_key}, pending, upsert=True)

    sent = await send_email(
        to=email,
        subject="Kode OTP registrasi TripleSide",
        html=registration_otp_html(code, OTP_EXPIRES_MINUTES),
    )
    if not sent:
        await db.registration_otps.delete_one({"id": registration_id})
        raise HTTPException(503, "OTP email could not be sent. Please try again later")
    return {
        "ok": True,
        "registration_id": registration_id,
        "email_hint": _mask_email(email),
        "expires_in": OTP_EXPIRES_MINUTES * 60,
        "resend_after": OTP_RESEND_SECONDS,
    }


@router.post("/customer/register/resend-otp")
async def customer_resend_registration_otp(body: RegistrationOtpResendRequest, request: Request):
    registration_otp_limiter.check(request)
    now = datetime.now(timezone.utc)
    record = await db.registration_otps.find_one(
        {"id": body.registration_id, "used": False, "status": "pending"},
        {"_id": 0},
    )
    if not record:
        raise HTTPException(400, "Registration session is invalid or has expired")

    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = _registration_otp_hash(record["email"], code)
    updated = await db.registration_otps.find_one_and_update(
        {
            "id": body.registration_id,
            "used": False,
            "status": "pending",
            "resend_available_at": {"$lte": now},
        },
        {
            "$set": {
                "code_hash": code_hash,
                "attempts": 0,
                "expires_at": now + timedelta(minutes=OTP_EXPIRES_MINUTES),
                "resend_available_at": now + timedelta(seconds=OTP_RESEND_SECONDS),
                "last_sent_at": now,
            }
        },
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(429, "Please wait before requesting another OTP")

    sent = await send_email(
        to=record["email"],
        subject="Kode OTP registrasi TripleSide",
        html=registration_otp_html(code, OTP_EXPIRES_MINUTES),
    )
    if not sent:
        await db.registration_otps.update_one(
            {"id": body.registration_id, "code_hash": code_hash, "status": "pending"},
            {
                "$set": {
                    "code_hash": record["code_hash"],
                    "attempts": record.get("attempts", 0),
                    "expires_at": record["expires_at"],
                    "resend_available_at": now,
                    "last_send_failed_at": now,
                }
            },
        )
        raise HTTPException(503, "OTP email could not be sent. Please try again later")
    return {
        "ok": True,
        "email_hint": _mask_email(record["email"]),
        "expires_in": OTP_EXPIRES_MINUTES * 60,
        "resend_after": OTP_RESEND_SECONDS,
    }


@router.post("/customer/register")
async def customer_register(body: RegistrationOtpVerifyRequest, request: Request):
    login_limiter.check(request)
    if not body.otp.isdigit():
        raise HTTPException(400, "OTP must contain 6 digits")

    now = datetime.now(timezone.utc)
    otp_record = await db.registration_otps.find_one(
        {
            "id": body.registration_id,
            "used": False,
            "status": "pending",
            "expires_at": {"$gt": now},
        },
        {"_id": 0},
    )
    if not otp_record:
        raise HTTPException(400, "Registration session is invalid or has expired")
    if otp_record.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(400, "Too many invalid OTP attempts. Request a new code")
    expected_hash = _registration_otp_hash(otp_record["email"], body.otp)
    if not secrets.compare_digest(otp_record.get("code_hash", ""), expected_hash):
        updated = await db.registration_otps.find_one_and_update(
            {
                "id": body.registration_id,
                "used": False,
                "status": "pending",
                "expires_at": {"$gt": now},
                "attempts": {"$lt": OTP_MAX_ATTEMPTS},
            },
            {"$inc": {"attempts": 1}, "$set": {"last_attempt_at": now}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise HTTPException(400, "Too many invalid OTP attempts. Request a new code")
        if updated.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
            await db.registration_otps.update_one(
                {"id": body.registration_id, "status": "pending"},
                {"$set": {"used": True, "status": "locked", "locked_at": now}},
            )
            raise HTTPException(400, "Too many invalid OTP attempts. Request a new code")
        raise HTTPException(400, "Invalid OTP code")

    email = otp_record["email"]
    phone = otp_record["phone"]
    if await db.customers.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(409, "Email already registered")
    if await db.customers.find_one({"phone": phone}, {"_id": 0}):
        raise HTTPException(409, "Phone already registered")

    claimed_otp = await db.registration_otps.find_one_and_update(
        {
            "id": body.registration_id,
            "used": False,
            "status": "pending",
            "code_hash": expected_hash,
            "attempts": {"$lt": OTP_MAX_ATTEMPTS},
            "expires_at": {"$gt": now},
        },
        {"$set": {"used": True, "status": "processing", "verified_at": now}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed_otp:
        raise HTTPException(400, "OTP is invalid or has already been used")

    customer_id = claimed_otp["customer_id"]
    doc = {
        "_id": customer_id,
        "id": customer_id,
        "name": claimed_otp["name"],
        "email": email,
        "phone": phone,
        "phone_country": claimed_otp["phone_country"],
        "email_verified_at": now.isoformat(),
        "password_hash": claimed_otp["password_hash"],
        "created_at": now_iso(),
    }
    try:
        await db.customers.insert_one(doc)
        customer = doc
    except DuplicateKeyError:
        customer = await db.customers.find_one({"_id": customer_id, "email": email})
        if not customer:
            await db.registration_otps.update_one(
                {"id": body.registration_id, "status": "processing"},
                {"$set": {"used": False, "status": "pending"}, "$unset": {"verified_at": ""}},
            )
            raise HTTPException(409, "Email or phone is already registered")
    except Exception:
        customer = await db.customers.find_one({"_id": customer_id, "email": email})
        if not customer:
            await db.registration_otps.update_one(
                {"id": body.registration_id, "status": "processing"},
                {"$set": {"used": False, "status": "pending"}, "$unset": {"verified_at": ""}},
            )
            raise

    await db.registration_otps.update_one(
        {"id": body.registration_id, "status": "processing"},
        {"$set": {"status": "completed", "completed_at": now, "customer_id": customer_id}},
    )
    token = create_token(customer_id, role="customer")
    profile = {k: customer[k] for k in ("id", "name", "email", "phone", "created_at")}
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
    await expire_pending_manual_payments(db)
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
            available_platforms = list(product_download_options(prod))
            selected_platform = normalize_download_platform(
                t.get("download_platform") or "windows"
            )
            if selected_platform not in available_platforms and available_platforms:
                selected_platform = available_platforms[0]
            t["available_platforms"] = available_platforms
            t["download_platform"] = selected_platform
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
    if txn.get("payment_method") == "manual_bank" and txn.get("proof_status") == "submitted":
        raise HTTPException(400, "Bukti pembayaran sedang diperiksa dan pesanan tidak dapat dihapus.")
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
