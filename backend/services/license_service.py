"""RSA-signed VST plugin license service.

- Loads (or generates + persists) an RSA-2048 keypair.
- Public key exposed via /api/license/public-key so admins can embed it in HISE.
- Private key never leaves the server; signs activation payloads.
"""
import base64
import json
import logging
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

logger = logging.getLogger(__name__)

KEYS_DIR = Path(__file__).resolve().parent.parent / "keys"
KEYS_DIR.mkdir(exist_ok=True)
PRIVATE_KEY_PATH = KEYS_DIR / "license_private.pem"
PUBLIC_KEY_PATH = KEYS_DIR / "license_public.pem"


def _load_or_generate_keys():
    if PRIVATE_KEY_PATH.exists() and PUBLIC_KEY_PATH.exists():
        with open(PRIVATE_KEY_PATH, "rb") as f:
            private_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(PUBLIC_KEY_PATH, "rb") as f:
            public_pem = f.read()
        logger.info("Loaded existing RSA license keypair")
        return private_key, public_pem

    logger.info("Generating new RSA 2048-bit license keypair")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    PRIVATE_KEY_PATH.write_bytes(private_pem)
    PUBLIC_KEY_PATH.write_bytes(public_pem)
    PRIVATE_KEY_PATH.chmod(0o600)
    return private_key, public_pem


PRIVATE_KEY, PUBLIC_KEY_PEM = _load_or_generate_keys()


def get_public_key_pem() -> str:
    return PUBLIC_KEY_PEM.decode("utf-8")


def _fmt_group(text: str, group: int = 5) -> str:
    """XXXXX-XXXXX-XXXXX-XXXXX-XXXXX style."""
    return "-".join([text[i:i + group] for i in range(0, len(text), group)])


def generate_license_key(prefix: str = "TS") -> str:
    """Generate human-typeable license key like TS-A3F9K-8P2QW-M4X7Z-N1B6Y."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # excludes I, O, 0, 1 to avoid confusion
    raw = "".join(secrets.choice(alphabet) for _ in range(20))
    return f"{prefix}-{_fmt_group(raw)}"


def sign_payload(payload: dict) -> str:
    """Return base64-encoded RSA-PSS signature over canonical JSON of the payload."""
    canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = PRIVATE_KEY.sign(
        canonical,
        padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.MAX_LENGTH),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("ascii")


def build_signed_license_file(
    license_key: str,
    product_id: str,
    product_name: str,
    customer_id: str,
    customer_name: str,
    hardware_id: str,
    activated_at: Optional[str] = None,
    expires_at: Optional[str] = None,
    license_type: str = "full",
) -> dict:
    """Return a signed license bundle for the plugin to store on disk."""
    payload = {
        "license_key": license_key,
        "product_id": product_id,
        "product_name": product_name,
        "customer_id": customer_id,
        "customer_name": customer_name,
        "hardware_id": hardware_id,
        "activated_at": activated_at or datetime.now(timezone.utc).isoformat(),
        "expires_at": expires_at,
        "license_type": license_type,
        "issuer": "TripleSideStudio",
    }
    signature = sign_payload(payload)
    return {"payload": payload, "signature": signature, "algorithm": "RSA-PSS-SHA256"}
