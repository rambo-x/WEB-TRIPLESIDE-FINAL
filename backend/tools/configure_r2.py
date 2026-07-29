"""Safely configure and verify Cloudflare R2 credentials on the VPS."""
import getpass
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import boto3
from botocore.config import Config

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
ENV_KEYS = (
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "R2_REGION",
)


def prompt_required(label: str, secret: bool = False, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    prompt = f"{label}{suffix}: "
    value = getpass.getpass(prompt) if secret else input(prompt)
    value = value.strip()
    return value or default


def update_env(values: dict[str, str]) -> None:
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    remaining = dict(values)
    updated = []

    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in remaining:
            updated.append(f"{key}={json.dumps(remaining.pop(key))}")
        else:
            updated.append(line)

    if remaining:
        if updated and updated[-1]:
            updated.append("")
        for key in ENV_KEYS:
            if key in remaining:
                updated.append(f"{key}={json.dumps(remaining[key])}")

    temporary_file = ENV_FILE.with_suffix(".env.r2-new")
    temporary_file.write_text("\n".join(updated) + "\n", encoding="utf-8")
    os.chmod(temporary_file, 0o600)
    temporary_file.replace(ENV_FILE)
    os.chmod(ENV_FILE, 0o600)


def main() -> int:
    print("Konfigurasi Cloudflare R2 — nilai rahasia tidak akan ditampilkan.")
    account_id = prompt_required("Account ID")
    access_key_id = prompt_required("Access Key ID")
    secret_access_key = prompt_required("Secret Access Key", secret=True)
    bucket = prompt_required("Bucket", default="tripleside-products")
    endpoint = prompt_required(
        "S3 Endpoint",
        default=f"https://{account_id}.r2.cloudflarestorage.com",
    )

    if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
        print("Account ID tidak valid; biasanya berisi 32 karakter heksadesimal.")
        return 1
    if not access_key_id or not secret_access_key:
        print("Access Key ID dan Secret Access Key wajib diisi.")
        return 1
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", bucket):
        print("Nama bucket tidak valid.")
        return 1
    if not endpoint.startswith("https://"):
        print("S3 Endpoint harus menggunakan https://")
        return 1

    print("Menguji koneksi ke bucket privat...")
    client = boto3.client(
        service_name="s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    try:
        client.list_objects_v2(Bucket=bucket, MaxKeys=1)
    except Exception as exc:
        code = str(getattr(exc, "response", {}).get("Error", {}).get("Code", ""))
        print(f"Koneksi gagal ({code or type(exc).__name__}). Periksa token, endpoint, dan bucket.")
        return 1

    update_env(
        {
            "R2_ACCOUNT_ID": account_id,
            "R2_ACCESS_KEY_ID": access_key_id,
            "R2_SECRET_ACCESS_KEY": secret_access_key,
            "R2_BUCKET": bucket,
            "R2_ENDPOINT": endpoint,
            "R2_REGION": "auto",
        }
    )
    print("Kredensial tersimpan dengan permission 600.")

    subprocess.run(
        ["pm2", "restart", "triplesidestudio-backend", "--update-env"],
        check=True,
    )
    time.sleep(3)
    subprocess.run(
        [
            "curl",
            "-fsS",
            "-H",
            "Host: triplesidestudio.com",
            "http://127.0.0.1:8000/api/",
        ],
        check=True,
    )
    print("\nR2 aktif dan backend sehat.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
