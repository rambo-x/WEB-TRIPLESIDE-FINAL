from datetime import datetime, timezone

from services.manual_payment_service import (
    bank_is_configured,
    expiry_iso,
    is_expired,
    merge_payment_settings,
)


def test_default_settings_enable_doku_and_retire_manual_setup():
    settings = merge_payment_settings(None)

    assert settings["doku_enabled"] is True
    assert settings["manual_enabled"] is False
    assert settings["midtrans_enabled"] is False
    assert settings["expiry_hours"] == 24


def test_bank_requires_all_identity_fields():
    assert not bank_is_configured(
        {
            "bank_name": "BCA",
            "account_number": "",
            "account_holder": "TripleSide Studio",
        }
    )
    assert bank_is_configured(
        {
            "bank_name": "BCA",
            "account_number": "1234567890",
            "account_holder": "TripleSide Studio",
        }
    )


def test_expiry_helpers_are_timezone_safe():
    now = datetime(2026, 7, 26, 8, 0, tzinfo=timezone.utc)
    expires_at = expiry_iso(24, now)

    assert expires_at == "2026-07-27T08:00:00+00:00"
    assert not is_expired(expires_at, now)
    assert is_expired(expires_at, datetime(2026, 7, 27, 8, 0, tzinfo=timezone.utc))
