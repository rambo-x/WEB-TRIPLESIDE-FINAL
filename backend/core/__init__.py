"""Shared core: config, db, models, auth dependencies, utility functions."""
import os
import logging
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ---- Config ----
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
JWT_ALG = "HS256"
JWT_EXP_HOURS = 24 * 7
ADMIN_EMAIL = "admin@tripleside.studio"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "tripleside2025")
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
MIDTRANS_SERVER_KEY = os.environ.get("MIDTRANS_SERVER_KEY", "")
MIDTRANS_CLIENT_KEY = os.environ.get("MIDTRANS_CLIENT_KEY", "")
MIDTRANS_IS_PRODUCTION = os.environ.get("MIDTRANS_IS_PRODUCTION", "false").strip().lower() == "true"
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "")
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

# ---- Logger ----
logger = logging.getLogger("tripleside")

# ---- Database ----
mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

# ---- Security primitive ----
security = HTTPBearer(auto_error=False)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_phone(p: Optional[str]) -> str:
    if not p:
        return ""
    return "".join(ch for ch in p if ch.isdigit() or ch == "+")


# ---- JWT helpers ----
def create_token(subject: str, role: str = "customer", extra: Optional[dict] = None) -> str:
    payload = {
        "sub": subject,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _decode(credentials: Optional[HTTPAuthorizationCredentials]) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def verify_admin(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> str:
    payload = _decode(credentials)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return payload.get("sub") or payload.get("email", "")


def verify_customer(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> str:
    payload = _decode(credentials)
    if payload.get("role") != "customer":
        raise HTTPException(status_code=403, detail="Customer only")
    return payload["sub"]


def optional_customer(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> Optional[str]:
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("role") == "customer":
            return payload.get("sub")
    except jwt.PyJWTError:
        return None
    return None


# ---- Models ----
class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    email: str


class Song(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    artist: str
    genre: str
    duration: str
    cover_url: str
    audio_url: str
    track_type: str = "audio"  # "audio" | "youtube" | "spotify"
    embed_url: Optional[str] = ""  # YouTube or Spotify embed URL
    release_year: Optional[int] = None
    description: Optional[str] = ""
    created_at: str = Field(default_factory=now_iso)


class SongInput(BaseModel):
    title: str
    artist: str
    genre: str
    duration: str
    cover_url: str
    audio_url: str
    track_type: str = "audio"
    embed_url: Optional[str] = ""
    release_year: Optional[int] = None
    description: Optional[str] = ""


class Gear(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    brand: str
    category: str
    image_url: str
    description: str
    specs: List[str] = []
    created_at: str = Field(default_factory=now_iso)


class GearInput(BaseModel):
    name: str
    brand: str
    category: str
    image_url: str
    description: str
    specs: List[str] = []


class DigitalProduct(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    category: str
    image_url: str
    description: str
    price: float
    is_free: bool = False
    requires_license: bool = False
    max_activations: int = Field(default=1, ge=1, le=3)
    trial_enabled: bool = True
    trial_days: int = Field(default=7, ge=1, le=365)
    preview_audio_url: Optional[str] = ""
    download_url: str
    created_at: str = Field(default_factory=now_iso)


class ProductInput(BaseModel):
    name: str
    category: str
    image_url: str
    description: str
    price: float
    is_free: bool = False
    requires_license: bool = False
    max_activations: int = Field(default=1, ge=1, le=3)
    trial_enabled: bool = True
    trial_days: int = Field(default=7, ge=1, le=365)
    preview_audio_url: Optional[str] = ""
    download_url: str


class License(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    license_key: str
    product_id: str
    product_name: str = ""
    customer_id: str
    customer_name: str = ""
    customer_email: str = ""
    transaction_id: str = ""
    hardware_id: Optional[str] = ""
    machine_name: Optional[str] = ""
    activated_at: Optional[str] = None
    activations: List[dict] = []
    max_activations: int = 1
    license_type: str = "full"
    expires_at: Optional[str] = None
    status: str = "unactivated"  # 'unactivated' | 'active' | 'revoked'
    notes: str = ""
    created_at: str = Field(default_factory=now_iso)


class ActivateLicenseRequest(BaseModel):
    license_key: str
    hardware_id: str
    machine_name: Optional[str] = ""


class VerifyLicenseRequest(BaseModel):
    license_key: str
    hardware_id: str


class BlogPost(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    title: str
    excerpt: str = ""
    content: str  # markdown
    featured_image: str = ""
    tags: List[str] = []
    status: str = "draft"  # 'draft' | 'published'
    author: str = "TripleSide Studio"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    published_at: Optional[str] = None


class BlogPostInput(BaseModel):
    title: str
    slug: Optional[str] = ""
    excerpt: str = ""
    content: str
    featured_image: str = ""
    tags: List[str] = []
    status: str = "draft"
    author: str = "TripleSide Studio"


class CheckoutRequest(BaseModel):
    product_id: str
    origin_url: str
    buyer_email: Optional[str] = ""
    coupon_code: Optional[str] = ""


class CustomerRegisterRequest(BaseModel):
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    password: str


class CustomerLoginRequest(BaseModel):
    identifier: str
    password: str


class CustomerProfile(BaseModel):
    id: str
    name: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    created_at: str


class CustomerUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class CouponInput(BaseModel):
    code: str
    discount_type: str
    discount_value: float
    expires_at: Optional[str] = ""
    max_uses: Optional[int] = 0
    active: bool = True


class Coupon(CouponInput):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    times_used: int = 0
    created_at: str = Field(default_factory=now_iso)


class ApplyCouponRequest(BaseModel):
    code: str
    product_id: str
