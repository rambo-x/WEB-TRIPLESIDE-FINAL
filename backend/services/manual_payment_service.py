import secrets
from datetime import datetime, timedelta, timezone


DEFAULT_PAYMENT_SETTINGS = {
    "id": "payment",
    "doku_enabled": True,
    "manual_enabled": False,
    "midtrans_enabled": False,
    "bank_name": "",
    "account_number": "",
    "account_holder": "",
    "instructions": "",
    "expiry_hours": 24,
}


def merge_payment_settings(document: dict | None) -> dict:
    settings = DEFAULT_PAYMENT_SETTINGS.copy()
    if document:
        for key in settings:
            if key in document:
                settings[key] = document[key]
    settings["expiry_hours"] = max(1, min(168, int(settings.get("expiry_hours") or 24)))
    return settings


def bank_is_configured(settings: dict) -> bool:
    return all(
        str(settings.get(key, "")).strip()
        for key in ("bank_name", "account_number", "account_holder")
    )


def expiry_iso(hours: int, now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return (current + timedelta(hours=max(1, min(168, int(hours))))).isoformat()


def is_expired(expires_at: str, now: datetime | None = None) -> bool:
    if not expires_at:
        return False
    try:
        expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    current = now or datetime.now(timezone.utc)
    return expires <= current


async def get_payment_settings(db) -> dict:
    document = await db.site_settings.find_one({"id": "payment"}, {"_id": 0})
    return merge_payment_settings(document)


async def save_payment_settings(db, payload: dict) -> dict:
    settings = merge_payment_settings(payload)
    await db.site_settings.update_one(
        {"id": "payment"},
        {"$set": settings},
        upsert=True,
    )
    return settings


async def allocate_unique_code(db, base_amount: int) -> int:
    now = datetime.now(timezone.utc).isoformat()
    for _ in range(30):
        code = secrets.randbelow(900) + 100
        collision = await db.payment_transactions.find_one(
            {
                "payment_method": "manual_bank",
                "payment_status": "pending",
                "payable_amount": base_amount + code,
                "expires_at": {"$gt": now},
            },
            {"_id": 1},
        )
        if not collision:
            return code
    raise RuntimeError("manual_payment_code_unavailable")


async def expire_pending_manual_payments(db) -> None:
    now = datetime.now(timezone.utc).isoformat()
    await db.payment_transactions.update_many(
        {
            "payment_method": "manual_bank",
            "payment_status": "pending",
            "status": "awaiting_payment",
            "expires_at": {"$lte": now},
        },
        {
            "$set": {
                "status": "expired",
                "payment_status": "failed",
                "updated_at": now,
            }
        },
    )
