"""Midtrans Snap helpers: create transaction, check status, verify webhook signature.

Keys are read from the environment (core config). Server key is used ONLY here
(backend) with HTTP Basic auth. Client key is public and returned to the frontend
so it can load snap.js.
"""
import base64
import hashlib

import httpx

from core import MIDTRANS_SERVER_KEY, MIDTRANS_IS_PRODUCTION, logger


def is_configured() -> bool:
    return bool(MIDTRANS_SERVER_KEY)


def _app_base() -> str:
    """Snap (checkout UI) host."""
    return "https://app.midtrans.com" if MIDTRANS_IS_PRODUCTION else "https://app.sandbox.midtrans.com"


def _api_base() -> str:
    """Core API host (used for transaction status)."""
    return "https://api.midtrans.com" if MIDTRANS_IS_PRODUCTION else "https://api.sandbox.midtrans.com"


def _auth_header() -> str:
    raw = f"{MIDTRANS_SERVER_KEY}:".encode()
    return "Basic " + base64.b64encode(raw).decode()


async def create_snap_transaction(payload: dict) -> dict:
    """Create a Snap transaction and return the parsed response ({token, redirect_url})."""
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.post(
            f"{_app_base()}/snap/v1/transactions",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": _auth_header(),
            },
            json=payload,
        )
    if res.status_code not in (200, 201):
        logger.warning(f"Midtrans snap create failed {res.status_code}: {res.text[:300]}")
        raise RuntimeError(f"midtrans_snap_failed:{res.status_code}")
    return res.json()


async def get_transaction_status(order_id: str) -> dict:
    """Fetch the authoritative transaction status from Midtrans."""
    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get(
            f"{_api_base()}/v2/{order_id}/status",
            headers={"Accept": "application/json", "Authorization": _auth_header()},
        )
    try:
        return res.json()
    except Exception:
        return {}


def verify_signature(order_id: str, status_code: str, gross_amount: str, signature_key: str) -> bool:
    """SHA512(order_id + status_code + gross_amount + ServerKey)."""
    raw = f"{order_id}{status_code}{gross_amount}{MIDTRANS_SERVER_KEY}".encode()
    expected = hashlib.sha512(raw).hexdigest()
    return bool(signature_key) and expected == signature_key


def is_paid(tx_status: str, fraud_status) -> bool:
    return tx_status in ("settlement", "capture") and (fraud_status in (None, "", "accept"))
