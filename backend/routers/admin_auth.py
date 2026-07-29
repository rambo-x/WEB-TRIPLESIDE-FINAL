"""Admin authentication endpoints."""
import re

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from core import (
    AdminPasswordChangeRequest,
    LoginRequest,
    LoginResponse,
    create_token,
    db,
    logger,
    now_iso,
    verify_admin,
)
from core.rate_limit import admin_password_limiter, login_limiter

router = APIRouter()


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request):
    login_limiter.check(request)
    admin = await db.admins.find_one({"email": body.email}, {"_id": 0})
    if not admin or not bcrypt.checkpw(body.password.encode(), admin["password_hash"].encode()):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(
        admin["email"],
        role="admin",
        extra={"token_version": admin.get("token_version", 0)},
    )
    return LoginResponse(token=token, email=admin["email"])


@router.get("/auth/me")
async def me(email: str = Depends(verify_admin)):
    return {"email": email, "role": "admin"}


@router.post("/auth/change-password")
async def change_password(
    body: AdminPasswordChangeRequest,
    request: Request,
    email: str = Depends(verify_admin),
):
    admin_password_limiter.check(request)
    admin = await db.admins.find_one({"email": email}, {"_id": 0})
    if not admin or not bcrypt.checkpw(
        body.current_password.encode(),
        admin["password_hash"].encode(),
    ):
        raise HTTPException(401, "Password saat ini salah")

    password_bytes = body.new_password.encode("utf-8")
    if len(password_bytes) > 72:
        raise HTTPException(400, "Password baru maksimal 72 byte")
    if bcrypt.checkpw(password_bytes, admin["password_hash"].encode()):
        raise HTTPException(400, "Password baru harus berbeda dari password saat ini")
    if not (
        re.search(r"[a-z]", body.new_password)
        and re.search(r"[A-Z]", body.new_password)
        and re.search(r"\d", body.new_password)
        and re.search(r"[^A-Za-z0-9]", body.new_password)
    ):
        raise HTTPException(
            400,
            "Password baru harus memiliki huruf besar, huruf kecil, angka, dan simbol",
        )

    new_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode()
    result = await db.admins.update_one(
        {"email": email, "password_hash": admin["password_hash"]},
        {
            "$set": {
                "password_hash": new_hash,
                "password_changed_at": now_iso(),
            },
            "$inc": {"token_version": 1},
        },
    )
    if result.modified_count != 1:
        raise HTTPException(409, "Password berubah dari sesi lain. Silakan login kembali.")

    logger.info("Admin password changed for %s", email)
    return {"message": "Password admin berhasil diubah. Silakan login kembali."}
