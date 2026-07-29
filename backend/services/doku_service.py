import base64
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone

import httpx


DOKU_CLIENT_ID = os.environ.get("DOKU_CLIENT_ID", "").strip()
DOKU_SECRET_KEY = os.environ.get("DOKU_SECRET_KEY", "").strip()
DOKU_IS_PRODUCTION = os.environ.get("DOKU_IS_PRODUCTION", "false").strip().lower() == "true"
DOKU_API_BASE = (
    "https://api.doku.com"
    if DOKU_IS_PRODUCTION
    else "https://api-sandbox.doku.com"
)
DOKU_CHECKOUT_TARGET = "/checkout/v1/payment"
DOKU_PAYMENT_METHODS = tuple(
    method.strip()
    for method in os.environ.get("DOKU_PAYMENT_METHODS", "").split(",")
    if method.strip()
)


class DokuError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(DOKU_CLIENT_ID and DOKU_SECRET_KEY)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def encode_payload(payload: dict) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def digest(raw_body: bytes) -> str:
    return base64.b64encode(hashlib.sha256(raw_body).digest()).decode("ascii")


def generate_signature(
    *,
    client_id: str,
    request_id: str,
    timestamp: str,
    request_target: str,
    raw_body: bytes,
    secret_key: str,
    timestamp_header: str = "Request-Timestamp",
) -> str:
    components = "\n".join(
        (
            f"Client-Id:{client_id}",
            f"Request-Id:{request_id}",
            f"{timestamp_header}:{timestamp}",
            f"Request-Target:{request_target}",
            f"Digest:{digest(raw_body)}",
        )
    )
    signature = base64.b64encode(
        hmac.new(
            secret_key.encode("utf-8"),
            components.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("ascii")
    return f"HMACSHA256={signature}"


def verify_notification_signature(
    *,
    raw_body: bytes,
    request_id: str,
    request_timestamp: str,
    request_target: str,
    signature: str,
    client_id: str,
) -> bool:
    if not is_configured() or client_id != DOKU_CLIENT_ID:
        return False
    expected = generate_signature(
        client_id=client_id,
        request_id=request_id,
        timestamp=request_timestamp,
        request_target=request_target,
        raw_body=raw_body,
        secret_key=DOKU_SECRET_KEY,
    )
    return hmac.compare_digest(expected, signature or "")


def verify_response_signature(
    *,
    raw_body: bytes,
    request_id: str,
    response_timestamp: str,
    signature: str,
) -> bool:
    if not is_configured() or not response_timestamp or not signature:
        return False
    expected = generate_signature(
        client_id=DOKU_CLIENT_ID,
        request_id=request_id,
        timestamp=response_timestamp,
        request_target=DOKU_CHECKOUT_TARGET,
        raw_body=raw_body,
        secret_key=DOKU_SECRET_KEY,
        timestamp_header="Response-Timestamp",
    )
    return hmac.compare_digest(expected, signature)


async def create_checkout_payment(payload: dict) -> dict:
    if not is_configured():
        raise DokuError("DOKU belum dikonfigurasi")

    raw_body = encode_payload(payload)
    request_id = str(uuid.uuid4())
    request_timestamp = utc_timestamp()
    signature = generate_signature(
        client_id=DOKU_CLIENT_ID,
        request_id=request_id,
        timestamp=request_timestamp,
        request_target=DOKU_CHECKOUT_TARGET,
        raw_body=raw_body,
        secret_key=DOKU_SECRET_KEY,
    )
    headers = {
        "Client-Id": DOKU_CLIENT_ID,
        "Request-Id": request_id,
        "Request-Timestamp": request_timestamp,
        "Signature": signature,
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{DOKU_API_BASE}{DOKU_CHECKOUT_TARGET}",
            content=raw_body,
            headers=headers,
        )

    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = response.text[:500]
        raise DokuError(f"DOKU HTTP {response.status_code}: {detail}")

    if not verify_response_signature(
        raw_body=response.content,
        request_id=request_id,
        response_timestamp=response.headers.get("Response-Timestamp", ""),
        signature=response.headers.get("Signature", ""),
    ):
        raise DokuError("Signature respons DOKU tidak valid")

    try:
        data = response.json()
    except ValueError as exc:
        raise DokuError("Respons DOKU bukan JSON yang valid") from exc

    payment = data.get("response", {}).get("payment", {})
    if not payment.get("url"):
        raise DokuError(f"DOKU tidak mengembalikan payment URL: {data}")
    return data
