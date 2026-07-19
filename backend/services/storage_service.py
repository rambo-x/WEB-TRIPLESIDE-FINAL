"""Cloudinary uploader service."""
import os
import logging

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
