"""Cloudinary uploads plus private Cloudflare R2 product storage."""
import os
import logging
import re
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
API_KEY = os.environ.get("CLOUDINARY_API_KEY", "")
API_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "")

CLOUDINARY_CONFIGURED = bool(CLOUD_NAME and API_KEY and API_SECRET)

if CLOUDINARY_CONFIGURED:
    import cloudinary
    import cloudinary.uploader

    cloudinary.config(
        cloud_name=CLOUD_NAME,
        api_key=API_KEY,
        api_secret=API_SECRET,
        secure=True,
    )
    logger.info("Cloudinary configured")
else:
    logger.warning("Cloudinary not configured (missing CLOUDINARY_API_SECRET) — file upload disabled")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "").strip()
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
R2_BUCKET = os.environ.get("R2_BUCKET", "").strip()
R2_REGION = os.environ.get("R2_REGION", "auto").strip() or "auto"
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "").strip()
if not R2_ENDPOINT and R2_ACCOUNT_ID:
    R2_ENDPOINT = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

R2_CONFIGURED = bool(
    R2_ACCESS_KEY_ID
    and R2_SECRET_ACCESS_KEY
    and R2_BUCKET
    and R2_ENDPOINT
)


def _r2_client():
    if not R2_CONFIGURED:
        raise RuntimeError("Cloudflare R2 is not configured")

    import boto3
    from botocore.config import Config

    return boto3.client(
        service_name="s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name=R2_REGION,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 4, "mode": "standard"},
            connect_timeout=15,
            read_timeout=120,
        ),
    )


def _private_object_key(filename: str, folder: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,12}", suffix):
        suffix = ""
    safe_folder = re.sub(r"[^a-zA-Z0-9/_-]+", "-", folder).strip("/")
    return f"{safe_folder}/{uuid.uuid4().hex}{suffix}"


async def upload_private_file_stream(
    file_object,
    filename: str,
    folder: str,
    content_type: str = "application/octet-stream",
) -> dict:
    """Stream a private product file to R2 without loading it into RAM."""
    if not R2_CONFIGURED:
        raise RuntimeError("Cloudflare R2 is not configured")

    import asyncio
    from boto3.s3.transfer import TransferConfig

    object_key = _private_object_key(filename, folder)
    current_position = file_object.tell()
    file_object.seek(0, 2)
    file_size = file_object.tell()
    file_object.seek(0)

    def _upload():
        client = _r2_client()
        client.upload_fileobj(
            file_object,
            R2_BUCKET,
            object_key,
            ExtraArgs={"ContentType": content_type or "application/octet-stream"},
            Config=TransferConfig(
                multipart_threshold=16 * 1024 * 1024,
                multipart_chunksize=16 * 1024 * 1024,
                max_concurrency=4,
                use_threads=True,
            ),
        )
        return client.head_object(Bucket=R2_BUCKET, Key=object_key)

    try:
        result = await asyncio.to_thread(_upload)
    finally:
        if not file_object.closed:
            file_object.seek(current_position)

    return {
        "storage_provider": "r2",
        "storage_key": object_key,
        "filename": os.path.basename(filename) or "download.bin",
        "bytes": int(result.get("ContentLength", file_size)),
        "content_type": result.get("ContentType") or content_type,
        "etag": str(result.get("ETag", "")).strip('"'),
    }


async def open_private_file(storage_key: str, range_header: str = "") -> dict:
    """Open an R2 object and return its streaming body plus response metadata."""
    if not storage_key or storage_key.startswith("/") or ".." in storage_key.split("/"):
        raise ValueError("Invalid storage key")
    if range_header and not re.fullmatch(r"bytes=\d*-\d*", range_header.strip()):
        raise ValueError("Invalid range")

    import asyncio

    def _open():
        params = {"Bucket": R2_BUCKET, "Key": storage_key}
        if range_header:
            params["Range"] = range_header.strip()
        return _r2_client().get_object(**params)

    return await asyncio.to_thread(_open)


async def upload_file(file_bytes: bytes, filename: str, folder: str = "tripleside") -> dict:
    """Upload a file (any type) to Cloudinary. Returns {url, secure_url, public_id, original_filename}."""
    if not CLOUDINARY_CONFIGURED:
        raise RuntimeError("Cloudinary is not configured. Please set CLOUDINARY_API_SECRET in backend/.env")
    import asyncio
    import cloudinary.uploader

    def _upload():
        return cloudinary.uploader.upload(
            file_bytes,
            resource_type="auto",
            folder=folder,
            use_filename=True,
            unique_filename=True,
            filename_override=filename,
        )

    result = await asyncio.to_thread(_upload)
    return {
        "url": result.get("secure_url"),
        "public_id": result.get("public_id"),
        "resource_type": result.get("resource_type"),
        "format": result.get("format"),
        "bytes": result.get("bytes"),
        "original_filename": result.get("original_filename", filename),
    }


async def upload_file_stream(file_object, filename: str, folder: str = "tripleside") -> dict:
    """Upload a file-like object to Cloudinary in chunks without loading it all into RAM."""
    if not CLOUDINARY_CONFIGURED:
        raise RuntimeError("Cloudinary is not configured. Please set CLOUDINARY_API_SECRET in backend/.env")
    import asyncio
    import cloudinary.uploader

    def _upload():
        file_object.seek(0)
        return cloudinary.uploader.upload_large(
            file_object,
            resource_type="auto",
            folder=folder,
            use_filename=True,
            unique_filename=True,
            filename_override=filename,
            filename=filename,
            chunk_size=20 * 1024 * 1024,
        )

    result = await asyncio.to_thread(_upload)
    return {
        "url": result.get("secure_url"),
        "public_id": result.get("public_id"),
        "resource_type": result.get("resource_type"),
        "format": result.get("format"),
        "bytes": result.get("bytes"),
        "original_filename": result.get("original_filename", filename),
    }
