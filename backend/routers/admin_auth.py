"""Admin authentication endpoints."""
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request
from core import db, create_token, verify_admin, LoginRequest, LoginResponse
from core.rate_limit import login_limiter

router = APIRouter()


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, request: Request):
    login_limiter.check(request)
    admin = await db.admins.find_one({"email": body.email}, {"_id": 0})
    if not admin or not bcrypt.checkpw(body.password.encode(), admin["password_hash"].encode()):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(admin["email"], role="admin")
    return LoginResponse(token=token, email=admin["email"])


@router.get("/auth/me")
async def me(email: str = Depends(verify_admin)):
    return {"email": email, "role": "admin"}
