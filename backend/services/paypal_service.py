"""
PayPal Checkout helpers.

Uses PayPal REST API via httpx.
No external SDK required.

Flow:

get_access_token()
        ↓
create_order()
        ↓
customer approves payment
        ↓
capture_order()

"""

import base64

import httpx

from core import (
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PAYPAL_MODE,
    logger,
)


def is_configured() -> bool:
    return bool(PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)


def _api_base() -> str:
    if PAYPAL_MODE.lower() == "live":
        return "https://api-m.paypal.com"
    return "https://api-m.sandbox.paypal.com"


def _basic_auth() -> str:
    raw = f"{PAYPAL_CLIENT_ID}:{PAYPAL_CLIENT_SECRET}".encode()
    return "Basic " + base64.b64encode(raw).decode()


async def get_access_token() -> str:
    """
    Get OAuth access token.
    """

    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.post(
            f"{_api_base()}/v1/oauth2/token",
            headers={
                "Authorization": _basic_auth(),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
        )

    if res.status_code != 200:
        logger.warning(
            f"PayPal OAuth failed {res.status_code}: {res.text[:300]}"
        )
        raise RuntimeError("paypal_oauth_failed")

    data = res.json()

    return data["access_token"]


async def create_order(payload: dict) -> dict:
    """
    Create PayPal order.

    payload example:

    {
        "intent": "CAPTURE",
        "purchase_units": [...],
        "application_context": {...}
    }

    """

    token = await get_access_token()

    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.post(
            f"{_api_base()}/v2/checkout/orders",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if res.status_code not in (200, 201):
        logger.warning(
            f"PayPal create order failed {res.status_code}: {res.text[:300]}"
        )
        raise RuntimeError("paypal_create_order_failed")

    return res.json()


async def capture_order(order_id: str) -> dict:
    """
    Capture approved order.
    """

    token = await get_access_token()

    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.post(
            f"{_api_base()}/v2/checkout/orders/{order_id}/capture",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    if res.status_code not in (200, 201):
        logger.warning(
            f"PayPal capture failed {res.status_code}: {res.text[:300]}"
        )
        raise RuntimeError("paypal_capture_failed")

    return res.json()


async def get_order(order_id: str) -> dict:
    """
    Get order detail.
    """

    token = await get_access_token()

    async with httpx.AsyncClient(timeout=25) as client:
        res = await client.get(
            f"{_api_base()}/v2/checkout/orders/{order_id}",
            headers={
                "Authorization": f"Bearer {token}",
            },
        )

    if res.status_code != 200:
        logger.warning(
            f"PayPal get order failed {res.status_code}: {res.text[:300]}"
        )
        raise RuntimeError("paypal_get_order_failed")

    return res.json()
