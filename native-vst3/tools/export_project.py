#!/usr/bin/env python3
"""Prepare an isolated TripleSide project for the native Steinberg VST3 build."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


PORTABLE_AUDIO_SUFFIXES = {".wav"}
PROPRIETARY_AUDIO_PATTERN = re.compile(r"\.ch\d+$", re.IGNORECASE)
MAX_SAMPLE_BYTES = 512 * 1024 * 1024
MAX_EMBEDDED_AUDIO_BYTES = 2 * 1024 * 1024 * 1024
MAX_BACKGROUND_BYTES = 10 * 1024 * 1024
MAX_IMPULSE_RESPONSE_BYTES = 32 * 1024 * 1024


def fail(message: str) -> None:
    raise SystemExit(f"error: {message}")


def cmake_literal(value: str) -> str:
    return value.replace("\\", "/").replace('"', '\\"').replace(";", "\\;")


def safe_slug(value: str, fallback: str = "instrument") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or fallback


def four_char_code(seed: str, prefix: str = "T") -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return prefix.upper() + "".join(alphabet[byte % len(alphabet)] for byte in digest[:3])


def find_audio_files(samples_dir: Path) -> dict[str, list[Path]]:
    by_name: dict[str, list[Path]] = {}
    for path in samples_dir.rglob("*"):
        if not path.is_file():
            continue
        if PROPRIETARY_AUDIO_PATTERN.search(path.name):
            continue
        if path.suffix.lower() in PORTABLE_AUDIO_SUFFIXES:
            by_name.setdefault(path.name.casefold(), []).append(path)
    return by_name


def validate_spec(spec: dict) -> None:
    if not isinstance(spec, dict):
        fail("project specification must be a JSON object")
    if not str(spec.get("name", "")).strip():
        fail("project name is required")
    license_spec = spec.get("license") or {}
    if license_spec:
        if license_spec.get("required") is not True:
            fail("license.required must be true when a license block is present")
        if not re.fullmatch(r"vst-maker-build:[0-9a-f-]{36}", str(license_spec.get("product_id") or "")):
            fail("license product_id is invalid")
        for key in ("activation_url", "verify_url"):
            value = str(license_spec.get(key) or "")
            if not value.startswith("https://triplesidestudio.com/api/license/") or len(value) > 240:
                fail(f"license {key} is invalid")
        if license_spec.get("offline_mode") not in {None, "permanent_with_online_refresh"}:
            fail("license offline mode is invalid")
    packaging = spec.get("sample_packaging") or {}
    if not isinstance(packaging, dict):
        fail("sample_packaging must be an object")
    if packaging.get("monolith") is not False:
        fail("sample_packaging.monolith must be false for a native TripleSide build")
    samples = spec.get("samples")
    mappings = spec.get("sampler_map")
    if not isinstance(samples, list) or not isinstance(mappings, list):
        fail("samples and sampler_map must be arrays")
    if any(not isinstance(sample, dict) for sample in samples):
        fail("every sample must be an object")
    if len(samples) > 128 or len(mappings) > 128:
        fail("a native build supports at most 128 samples and 128 zones")
    sample_ids = [str(sample.get("id", "")).strip() for sample in samples]
    if any(not sample_id for sample_id in sample_ids):
        fail("every sample must have an id")
    if len(sample_ids) != len(set(sample_ids)):
        fail("sample ids must be unique")
    known_sample_ids = set(sample_ids)
    zone_ids = []
    for mapping in mappings:
        if not isinstance(mapping, dict) or str(mapping.get("sampleId", "")).strip() not in known_sample_ids:
            fail("every sampler_map zone must reference an existing sample")
        zone_id = str(mapping.get("id", "")).strip()
        if zone_id:
            zone_ids.append(zone_id)
        root = int(mapping.get("rootPitch", 60))
        low = int(mapping.get("lowPitch", root))
        high = int(mapping.get("highPitch", root))
        velocity_low = int(mapping.get("velocityLow", 1))
        velocity_high = int(mapping.get("velocityHigh", 127))
        if not 0 <= low <= root <= high <= 127:
            fail("every sampler_map zone must have a valid MIDI key range")
        if not 1 <= velocity_low <= velocity_high <= 127:
            fail("every sampler_map zone must have a valid velocity range")
        sample_start = float(mapping.get("sampleStart", 0.0))
        sample_end = float(mapping.get("sampleEnd", 1.0))
        if not 0.0 <= sample_start < sample_end <= 1.0:
            fail("every sampler_map zone must have a valid sample trim range")
        if mapping.get("loopEnabled"):
            loop_start = float(mapping.get("loopStart", sample_start))
            loop_end = float(mapping.get("loopEnd", sample_end))
            if not sample_start <= loop_start < loop_end <= sample_end:
                fail("every enabled loop must stay inside the sample trim range")
        loop_crossfade_ms = int(mapping.get("loopCrossfadeMs", 8))
        if not 0 <= loop_crossfade_ms <= 100:
            fail("every sampler_map zone must have a valid loop crossfade")
        tune_semitones = int(mapping.get("tuneSemitones", 0))
        tune_cents = float(mapping.get("tuneCents", 0.0))
        if not -24 <= tune_semitones <= 24 or not -1200.0 <= tune_cents <= 1200.0:
            fail("every sampler_map zone must have valid tuning values")
        playback_mode = str(mapping.get("playbackMode", "sampler"))
        source_bpm = float(mapping.get("sourceBpm", 120.0))
        if playback_mode not in {"sampler", "tempo_sync"} or not 20.0 <= source_bpm <= 300.0:
            fail("every sampler_map zone must have valid tempo-sync values")
        choke_targets = mapping.get("chokeTargetPitches", [])
        if not isinstance(choke_targets, list) or len(choke_targets) > 16:
            fail("every sampler_map zone must have at most 16 choke target pitches")
        if any(not isinstance(pitch, int) or isinstance(pitch, bool) or not 0 <= pitch <= 127 for pitch in choke_targets):
            fail("every choke target must be a MIDI pitch from 0 to 127")
        if len(choke_targets) != len(set(choke_targets)):
            fail("choke target pitches must be unique")
    if len(zone_ids) != len(set(zone_ids)):
        fail("sampler_map zone ids must be unique")
    impulses = spec.get("impulse_responses") or []
    if not isinstance(impulses, list) or len(impulses) > 16 or any(not isinstance(item, dict) for item in impulses):
        fail("impulse_responses must contain at most 16 objects")
    modules = ((spec.get("dsp_graph") or {}).get("modules") or [])
    cabinet_ids = {str(module.get("id") or "") for module in modules if module.get("type") == "cabinet_ir"}
    impulse_ids, impulse_modules = [], []
    for impulse in impulses:
        impulse_id = str(impulse.get("id") or "").strip()
        module_id = str(impulse.get("moduleId") or "").strip()
        name = str(impulse.get("name") or "").strip()
        if not impulse_id or not name.lower().endswith(".wav") or module_id not in cabinet_ids:
            fail("every impulse response must reference a cabinet_ir module and WAV file")
        if not 0 <= float(impulse.get("trimStart", 0)) < float(impulse.get("trimEnd", 1)) <= 1:
            fail("every impulse response must have a valid trim range")
        if not -2 <= float(impulse.get("phaseMs", 0)) <= 2:
            fail("every impulse response must have phaseMs between -2 and +2")
        impulse_ids.append(impulse_id); impulse_modules.append(module_id)
    if len(impulse_ids) != len(set(impulse_ids)) or len(impulse_modules) != len(set(impulse_modules)):
        fail("impulse response ids and cabinet module assignments must be unique")


def image_suffix(path: Path) -> str:
    header = path.read_bytes()[:16]
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if header.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return ".webp"
    fail("background image must contain valid PNG, JPG, or WebP data")


def copy_native_background(source: Path, assets_dir: Path) -> Path:
    """Store backgrounds in a format available through Windows WIC by default."""
    suffix = image_suffix(source)
    if suffix != ".webp":
        destination = assets_dir / f"ui_background{suffix}"
        shutil.copy2(source, destination)
        return destination
    try:
        from PIL import Image
    except ImportError:
        fail("WebP background conversion requires Pillow on the Windows build worker")
    destination = assets_dir / "ui_background.png"
    try:
        with Image.open(source) as image:
            image.convert("RGBA").save(destination, format="PNG", optimize=True)
    except Exception as error:
        fail(f"WebP background could not be converted to PNG: {error}")
    return destination


def prepare(
    spec_path: Path,
    samples_dir: Path,
    output_dir: Path,
    company_override: str | None,
    version_override: str | None,
    background_image: Path | None = None,
) -> Path:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    validate_spec(spec)

    generated_dir = output_dir.resolve() / "generated"
    assets_dir = generated_dir / "assets"
    if generated_dir.exists():
        shutil.rmtree(generated_dir)
    assets_dir.mkdir(parents=True)

    audio_files = find_audio_files(samples_dir.resolve())
    normalized_samples = []
    asset_paths = []
    total_audio_bytes = 0
    for index, sample in enumerate(spec["samples"]):
        name = str(sample.get("name") or sample.get("filename") or "").strip()
        if not name:
            fail(f"sample {index + 1} has no filename")
        suffix = Path(name).suffix.lower()
        if suffix not in PORTABLE_AUDIO_SUFFIXES:
            fail(f"unsupported sample format: {name}; only WAV is accepted")
        matches = audio_files.get(Path(name).name.casefold(), [])
        if not matches:
            fail(f"sample file was not found below {samples_dir}: {name}")
        if len(matches) > 1:
            fail(f"sample filename is ambiguous below {samples_dir}: {name}")
        file_bytes = matches[0].stat().st_size
        if file_bytes <= 0 or file_bytes > MAX_SAMPLE_BYTES:
            fail(f"sample exceeds the supported size limit: {name}")
        total_audio_bytes += file_bytes
        if total_audio_bytes > MAX_EMBEDDED_AUDIO_BYTES:
            fail("embedded audio exceeds the 2 GiB native build safety limit")
        destination_name = f"sample_{index:03d}{suffix}"
        destination = assets_dir / destination_name
        shutil.copy2(matches[0], destination)
        resource_name = re.sub(r"[^A-Za-z0-9_]", "_", destination_name)
        normalized_samples.append({**sample, "name": name, "resource_name": resource_name})
        asset_paths.append(destination)

    spec["samples"] = normalized_samples

    normalized_impulses = []
    for index, impulse in enumerate(spec.get("impulse_responses") or []):
        name = str(impulse.get("name") or "").strip()
        matches = audio_files.get(Path(name).name.casefold(), [])
        if not matches:
            fail(f"impulse response file was not found below {samples_dir}: {name}")
        if len(matches) > 1:
            fail(f"impulse response filename is ambiguous below {samples_dir}: {name}")
        file_bytes = matches[0].stat().st_size
        if file_bytes <= 12 or file_bytes > MAX_IMPULSE_RESPONSE_BYTES:
            fail(f"impulse response exceeds the supported size limit: {name}")
        destination_name = f"cabinet_ir_{index:03d}.wav"
        destination = assets_dir / destination_name
        shutil.copy2(matches[0], destination)
        normalized_impulses.append({**impulse, "name": destination_name, "resource_name": destination_name})
        asset_paths.append(destination)
    spec["impulse_responses"] = normalized_impulses

    background = ((spec.get("interface") or {}).get("background") or {})
    background_url = str(background.get("url") or "").strip()
    if background_url:
        if background_image is None or not background_image.is_file():
            fail("project uses a custom background but no --background-image file was supplied")
        background_size = background_image.stat().st_size
        if background_size <= 0 or background_size > MAX_BACKGROUND_BYTES:
            fail("background image exceeds the supported 10 MB size limit")
        destination = copy_native_background(background_image, assets_dir)
        background["resource_name"] = re.sub(r"[^A-Za-z0-9_]", "_", destination.name)
        spec["interface"]["background"] = background
        asset_paths.append(destination)
    else:
        background.pop("resource_name", None)

    normalized_path = generated_dir / "project.json"
    normalized_text = json.dumps(spec, ensure_ascii=False, indent=2)
    normalized_path.write_text(normalized_text + "\n", encoding="utf-8")

    name = str(spec["name"]).strip()
    build_settings = spec.get("build") or {}
    company = (company_override or str(build_settings.get("company_name") or "TripleSide Studio")).strip()
    version = version_override or str(build_settings.get("version") or "1.0.0")
    if not company:
        fail("plugin company name is required")
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        fail("version must use MAJOR.MINOR.PATCH")
    slug = safe_slug(name)
    manufacturer_code = four_char_code(company, "T")
    plugin_code = four_char_code(f"{company}:{name}", "P")
    bundle_id = f"studio.tripleside.{slug}"[:120].rstrip("-")
    all_assets = [*asset_paths, normalized_path]
    asset_lines = "\n".join(f'    "{cmake_literal(str(path))}"' for path in all_assets)
    (generated_dir / "ProjectConfig.cmake").write_text(
        f'set(TS_PRODUCT_NAME "{cmake_literal(name)}")\n'
        f'set(TS_COMPANY_NAME "{cmake_literal(company)}")\n'
        f'set(TS_PLUGIN_VERSION "{cmake_literal(version)}")\n'
        f'set(TS_BUNDLE_ID "{cmake_literal(bundle_id)}")\n'
        f'set(TS_MANUFACTURER_CODE "{manufacturer_code}")\n'
        f'set(TS_PLUGIN_CODE "{plugin_code}")\n'
        "set(TS_ASSET_FILES\n"
        f"{asset_lines}\n"
        ")\n",
        encoding="utf-8",
    )

    manifest = {
        "product_name": name,
        "company_name": company,
        "version": version,
        "bundle_id": bundle_id,
        "manufacturer_code": manufacturer_code,
        "plugin_code": plugin_code,
        "sample_count": len(normalized_samples),
        "impulse_response_count": len(normalized_impulses),
        "zone_count": len(spec["sampler_map"]),
        "background_embedded": bool(background_url),
        "generated_dir": str(generated_dir),
    }
    (output_dir / "export-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return generated_dir


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a TripleSide VST Maker project for the native VST3 runtime.")
    parser.add_argument("spec", type=Path, help="TripleSide project specification JSON")
    parser.add_argument("--samples-dir", required=True, type=Path, help="directory containing WAV files")
    parser.add_argument("--output", required=True, type=Path, help="isolated output directory")
    parser.add_argument("--background-image", type=Path, help="downloaded PNG, JPG, or WebP interface background")
    parser.add_argument("--company", help="override the plugin company stored in the project")
    parser.add_argument("--version", help="override the semantic plugin version stored in the project")
    args = parser.parse_args()

    if not args.spec.is_file():
        fail(f"specification does not exist: {args.spec}")
    if not args.samples_dir.is_dir():
        fail(f"samples directory does not exist: {args.samples_dir}")
    if args.background_image is not None and not args.background_image.is_file():
        fail(f"background image does not exist: {args.background_image}")
    if args.version is not None and not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        fail("version must use MAJOR.MINOR.PATCH")
    args.output.mkdir(parents=True, exist_ok=True)
    generated_dir = prepare(
        args.spec, args.samples_dir, args.output, args.company, args.version, args.background_image
    )
    print(json.dumps({"status": "prepared", "generated_dir": str(generated_dir)}, indent=2))


if __name__ == "__main__":
    main()
