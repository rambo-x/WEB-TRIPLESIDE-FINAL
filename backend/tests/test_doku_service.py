import base64
import hashlib
import hmac

from services import doku_service


def test_generate_signature_matches_doku_component_format():
    raw_body = b'{"order":{"amount":20000,"invoice_number":"INV-1"}}'
    signature = doku_service.generate_signature(
        client_id="MCH-TEST",
        request_id="request-1",
        timestamp="2026-07-29T01:02:03Z",
        request_target="/checkout/v1/payment",
        raw_body=raw_body,
        secret_key="secret",
    )
    body_digest = base64.b64encode(hashlib.sha256(raw_body).digest()).decode("ascii")
    components = "\n".join(
        (
            "Client-Id:MCH-TEST",
            "Request-Id:request-1",
            "Request-Timestamp:2026-07-29T01:02:03Z",
            "Request-Target:/checkout/v1/payment",
            f"Digest:{body_digest}",
        )
    )
    expected = base64.b64encode(
        hmac.new(b"secret", components.encode(), hashlib.sha256).digest()
    ).decode("ascii")
    assert signature == f"HMACSHA256={expected}"


def test_encode_payload_is_compact_and_stable():
    assert doku_service.encode_payload({"name": "Kendang", "amount": 120000}) == (
        b'{"name":"Kendang","amount":120000}'
    )


def test_notification_signature_rejects_tampered_body(monkeypatch):
    monkeypatch.setattr(doku_service, "DOKU_CLIENT_ID", "MCH-TEST")
    monkeypatch.setattr(doku_service, "DOKU_SECRET_KEY", "secret")
    raw_body = b'{"transaction":{"status":"SUCCESS"}}'
    signature = doku_service.generate_signature(
        client_id="MCH-TEST",
        request_id="notification-1",
        timestamp="2026-07-29T01:02:03Z",
        request_target="/api/webhook/doku",
        raw_body=raw_body,
        secret_key="secret",
    )
    assert doku_service.verify_notification_signature(
        raw_body=raw_body,
        request_id="notification-1",
        request_timestamp="2026-07-29T01:02:03Z",
        request_target="/api/webhook/doku",
        signature=signature,
        client_id="MCH-TEST",
    )
    assert not doku_service.verify_notification_signature(
        raw_body=b'{"transaction":{"status":"FAILED"}}',
        request_id="notification-1",
        request_timestamp="2026-07-29T01:02:03Z",
        request_target="/api/webhook/doku",
        signature=signature,
        client_id="MCH-TEST",
    )
