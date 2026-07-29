"""Short-lived download tickets for private R2 objects."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from core import APP_PUBLIC_URL, JWT_ALG, JWT_SECRET

DOWNLOAD_TICKET_TTL_SECONDS = 300


def create_private_download_url(
    *,
    storage_key: str,
    filename: str,
    customer_id: str,
    product_id: str,
    platform: str,
    access_type: str,
    access_id: str,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "private_download",
        "storage_key": storage_key,
        "filename": filename,
        "customer_id": customer_id,
        "product_id": product_id,
        "platform": platform,
        "access_type": access_type,
        "access_id": access_id,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(seconds=DOWNLOAD_TICKET_TTL_SECONDS),
    }
    ticket = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
    path = f"/api/download/file/{ticket}"
    return f"{APP_PUBLIC_URL.rstrip('/')}{path}" if APP_PUBLIC_URL else path


def decode_private_download_ticket(ticket: str) -> dict:
    payload = jwt.decode(ticket, JWT_SECRET, algorithms=[JWT_ALG])
    if payload.get("purpose") != "private_download":
        raise jwt.InvalidTokenError("Invalid ticket purpose")
    return payload
