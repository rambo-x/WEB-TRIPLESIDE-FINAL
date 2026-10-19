#!/usr/bin/env python3
"""Append a validated VST3 bundle payload to the native Windows setup stub."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import sys
from typing import BinaryIO, Iterable


MANIFEST_MAGIC = b"TSVST3M1"
UNINSTALL_MAGIC = b"TSVST3U1"
FOOTER_MAGIC = b"TSVST3PKGFOOT1\0\0"
PORTABLE_UNINSTALL_FOOTER_MAGIC = b"TSVST3UNINST1\0\0\0"
FORMAT_VERSION = 1
FOOTER = struct.Struct("<16sIQQ32s")
MAX_FILES = 4096
MAX_STRING_BYTES = 4096
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
COPY_CHUNK = 1024 * 1024


def _bounded_utf8(value: str, label: str) -> bytes:
    encoded = value.encode("utf-8")
    if not encoded or len(encoded) > MAX_STRING_BYTES or b"\0" in encoded:
        raise ValueError(f"{label} is empty or exceeds the package limit")
    return encoded


def _write_string(buffer: bytearray, value: str, label: str) -> None:
    encoded = _bounded_utf8(value, label)
    buffer += struct.pack("<I", len(encoded))
    buffer += encoded


def _safe_segment(value: str, label: str) -> str:
    if (
        not value
        or value in {".", ".."}
        or value[-1] in {" ", "."}
        or any(character in value for character in '<>:"/\\|?*')
        or any(ord(character) < 32 for character in value)
    ):
        raise ValueError(f"Unsafe {label}: {value!r}")
    return value


def _safe_relative_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    pure = PurePosixPath(normalized)
    if (
        not normalized
        or normalized.startswith("/")
        or pure.is_absolute()
        or any(part in {"", ".", ".."} for part in pure.parts)
        or any(":" in part or "\0" in part for part in pure.parts)
    ):
        raise ValueError(f"Unsafe bundle-relative path: {path!r}")
    for part in pure.parts:
        _safe_segment(part, "path segment")
    encoded = normalized.encode("utf-8")
    if len(encoded) > MAX_STRING_BYTES:
        raise ValueError(f"Bundle-relative path is too long: {path!r}")
    return normalized


def _copy_and_hash(source: Path, destination: BinaryIO) -> tuple[int, bytes]:
    digest = hashlib.sha256()
    total = 0
    with source.open("rb") as input_file:
        while chunk := input_file.read(COPY_CHUNK):
            destination.write(chunk)
            digest.update(chunk)
            total += len(chunk)
    return total, digest.digest()


def _bundle_files(bundle: Path) -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    seen: set[str] = set()
    for source in sorted(bundle.rglob("*"), key=lambda item: item.as_posix().casefold()):
        if source.is_symlink():
            raise ValueError(f"Symlinks are not allowed in an installer payload: {source}")
        if not source.is_file():
            continue
        relative = _safe_relative_path(source.relative_to(bundle).as_posix())
        folded = relative.casefold()
        if folded in seen:
            raise ValueError(f"Case-insensitive duplicate bundle path: {relative}")
        seen.add(folded)
        files.append((relative, source))
    if not files:
        raise ValueError("The VST3 bundle contains no files")
    if len(files) > MAX_FILES:
        raise ValueError(f"The VST3 bundle exceeds the {MAX_FILES}-file limit")
    return files


def _uninstall_metadata(product_name: str, bundle_name: str, installer_id: str) -> bytes:
    metadata = bytearray(UNINSTALL_MAGIC)
    metadata += struct.pack("<I", FORMAT_VERSION)
    _write_string(metadata, product_name, "product name")
    _write_string(metadata, bundle_name, "bundle name")
    _write_string(metadata, installer_id, "installer ID")
    return bytes(metadata)


def build_portable_uninstaller(args: argparse.Namespace, bundle_name: str) -> Path | None:
    if args.portable_uninstaller_output is None:
        return None
    source = args.uninstaller.resolve(strict=True)
    output = args.portable_uninstaller_output.resolve()
    if output in {source, args.stub.resolve(strict=True), args.output.resolve()}:
        raise ValueError("Portable uninstaller output must not overwrite another package file")
    metadata = _uninstall_metadata(args.product_name, bundle_name, args.installer_id)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    if temporary.exists():
        temporary.unlink()
    try:
        with temporary.open("wb") as package:
            with source.open("rb") as input_stub:
                shutil.copyfileobj(input_stub, package, COPY_CHUNK)
            metadata_offset = package.tell()
            package.write(metadata)
            package.write(
                FOOTER.pack(
                    PORTABLE_UNINSTALL_FOOTER_MAGIC,
                    FORMAT_VERSION,
                    metadata_offset,
                    len(metadata),
                    hashlib.sha256(metadata).digest(),
                )
            )
            package.flush()
            os.fsync(package.fileno())
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    return output


def build_package(args: argparse.Namespace) -> Path:
    stub = args.stub.resolve(strict=True)
    uninstaller = args.uninstaller.resolve(strict=True)
    bundle = args.bundle.resolve(strict=True)
    output = args.output.resolve()
    if not stub.is_file() or not uninstaller.is_file():
        raise ValueError("Installer and uninstaller stubs must be regular files")
    if not bundle.is_dir() or bundle.suffix.lower() != ".vst3":
        raise ValueError("Bundle must be a .vst3 directory")
    _safe_segment(bundle.name, "bundle name")
    _safe_segment(args.product_name, "product name")
    if not args.installer_id.startswith("com.triplesidestudio.vst3."):
        raise ValueError("Installer ID must use the com.triplesidestudio.vst3 namespace")
    if any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for character in args.installer_id):
        raise ValueError("Installer ID contains unsupported characters")
    if output in {stub, uninstaller}:
        raise ValueError("Output must not overwrite a native stub")

    files = _bundle_files(bundle)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    if temporary.exists():
        temporary.unlink()
    try:
        with temporary.open("wb") as package:
            with stub.open("rb") as input_stub:
                shutil.copyfileobj(input_stub, package, COPY_CHUNK)

            uninstaller_offset = package.tell()
            uninstaller_size, uninstaller_hash = _copy_and_hash(uninstaller, package)
            entries: list[tuple[str, int, int, bytes]] = []
            for relative, source in files:
                offset = package.tell()
                size, digest = _copy_and_hash(source, package)
                entries.append((relative, offset, size, digest))

            manifest = bytearray(MANIFEST_MAGIC)
            manifest += struct.pack("<I", FORMAT_VERSION)
            _write_string(manifest, args.product_name, "product name")
            _write_string(manifest, bundle.name, "bundle name")
            _write_string(manifest, args.product_version, "product version")
            _write_string(manifest, args.publisher, "publisher")
            _write_string(manifest, args.installer_id, "installer ID")
            manifest += struct.pack("<QQ32sI", uninstaller_offset, uninstaller_size, uninstaller_hash, len(entries))
            for relative, offset, size, digest in entries:
                _write_string(manifest, relative, "bundle-relative path")
                manifest += struct.pack("<QQ32s", offset, size, digest)
            if len(manifest) > MAX_MANIFEST_BYTES:
                raise ValueError("Package manifest exceeds its bounded size")

            manifest_offset = package.tell()
            package.write(manifest)
            package.write(
                FOOTER.pack(
                    FOOTER_MAGIC,
                    FORMAT_VERSION,
                    manifest_offset,
                    len(manifest),
                    hashlib.sha256(manifest).digest(),
                )
            )
            package.flush()
            os.fsync(package.fileno())
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            temporary.unlink()
    build_portable_uninstaller(args, bundle.name)
    return output


def verify_package(path: Path) -> None:
    size = path.stat().st_size
    if size < FOOTER.size:
        raise ValueError("Package is smaller than its footer")
    with path.open("rb") as package:
        package.seek(size - FOOTER.size)
        magic, version, manifest_offset, manifest_size, expected_hash = FOOTER.unpack(package.read(FOOTER.size))
        if magic != FOOTER_MAGIC or version != FORMAT_VERSION:
            raise ValueError("Package footer is invalid")
        if manifest_size > MAX_MANIFEST_BYTES or manifest_offset + manifest_size != size - FOOTER.size:
            raise ValueError("Package manifest bounds are invalid")
        package.seek(manifest_offset)
        manifest = package.read(manifest_size)
        if hashlib.sha256(manifest).digest() != expected_hash:
            raise ValueError("Package manifest checksum is invalid")
        if not manifest.startswith(MANIFEST_MAGIC + struct.pack("<I", FORMAT_VERSION)):
            raise ValueError("Package manifest header is invalid")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stub", type=Path, required=True)
    parser.add_argument("--uninstaller", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--portable-uninstaller-output", type=Path)
    parser.add_argument("--product-name", required=True)
    parser.add_argument("--product-version", required=True)
    parser.add_argument("--publisher", required=True)
    parser.add_argument("--installer-id", required=True)
    parser.add_argument("--verify", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        output = build_package(args)
        if args.verify:
            verify_package(output)
        print(output)
        return 0
    except (OSError, ValueError) as error:
        print(f"Windows installer packaging failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
