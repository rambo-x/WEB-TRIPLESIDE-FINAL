"""Admin and entitled-customer storage for the sample instrument builder."""
import asyncio
import hmac
import hashlib
import json
import logging
import math
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core import APP_PUBLIC_URL, db, now_iso, verify_admin, verify_customer
from services.storage_service import (
    CLOUDINARY_CONFIGURED,
    CLOUD_NAME,
    R2_CONFIGURED,
    create_private_download_url,
    delete_private_file,
    get_private_storage_usage,
    iter_private_file_chunks,
    open_private_file,
    upload_file_stream,
    upload_private_file_stream,
)
from services.private_file_cleanup import delete_private_file_reliably
from services.currency_service import display_currency, get_usd_idr_rate, localize_plan_prices
from services.vst_template_baseline import create_template_baseline
from services.license_service import generate_license_key
from services.vst_business_service import (
    PARTNER_TERMS_VERSION,
    business_build_usage,
    business_catalog,
    business_entitlements,
    current_business_entitlement,
    ensure_direct_distribution_plan,
    release_business_build_quota,
    reserve_business_build_quota,
    resolve_business_build_access,
    personal_first_purchase_eligible,
)


logger = logging.getLogger(__name__)


admin_router = APIRouter(dependencies=[Depends(verify_admin)])
customer_router = APIRouter()
worker_router = APIRouter(prefix="/vst-worker")

TIER_RANK = {"free": 0, "personal": 1, "creator_personal": 2, "partner": 3, "creator": 4, "studio": 5}
TIER_FEATURES = {
    "free": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds"],
    "personal": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds", "personal_build"],
    "creator_personal": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds", "personal_build"],
    "partner": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds", "partner_marketplace"],
    "creator": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds", "commercial_direct"],
    "studio": ["vst_maker", "custom_branding", "open_fonts", "basic_templates", "premium_templates", "custom_backgrounds", "commercial_direct", "distribution_api"],
}
TIER_PROJECT_LIMIT = {"free": 25, "personal": 25, "creator_personal": 25, "partner": 25, "creator": 25, "studio": 25}
TIER_SAMPLE_STORAGE_LIMIT = {
    "free": 3_000_000_000,
    "personal": 3_000_000_000,
    "creator_personal": 3_000_000_000,
    "partner": 3_000_000_000,
    "creator": 3_000_000_000,
    "studio": 3_000_000_000,
}
TIER_SAMPLE_FILE_LIMIT = {
    "free": 512 * 1024 * 1024,
    "personal": 512 * 1024 * 1024,
    "creator_personal": 512 * 1024 * 1024,
    "partner": 512 * 1024 * 1024,
    "creator": 512 * 1024 * 1024,
    "studio": 512 * 1024 * 1024,
}
TIER_ARTIFACT_RETENTION_DAYS = {"free": 1, "personal": 30, "creator_personal": 30, "partner": 60, "creator": 60, "studio": 60}
TIER_ARTIFACT_LIMIT = {"free": 0, "personal": 1, "creator_personal": 2, "partner": 2, "creator": 2, "studio": 2}
R2_WARNING_BYTES = 7_000_000_000
R2_UPLOAD_STOP_BYTES = 8_000_000_000
_storage_upload_lock = asyncio.Lock()
_pending_storage_reservations: dict[str, tuple[str, int, int]] = {}
BUILT_IN_TEMPLATE_BACKGROUNDS = {
    "ampsimulator": "/images/vst-assets/original-cream-amp-stack-v2.png",
    "obsidianhighgain": "/images/vst-assets/obsidian-high-gain-amp-stack-v1.png",
    "regentstrip": "/images/vst-assets/regent-console-strip-panel-v1.png",
    "regentwhite": "/images/vst-assets/regent-console-strip-panel-white-v2.png",
    "prismeq": "/images/vst-assets/prism-spectrum-eq-panel-v2.png",
    "vintageeq": "/images/vst-assets/vintage-passive-eq-panel-v1.png",
    "modernreverb": "/images/vst-assets/modern-reverb-panel-v1.png",
    "moderndelay": "/images/vst-assets/modern-delay-panel-v1.png",
    "modernsaturation": "/images/vst-assets/modern-saturation-panel-v1.png",
    "neonpopdrums": "/images/vst-assets/neon-pop-rock-drums-background-v1.png",
    "drumpad": "/images/vst-assets/pulse-drum-pad-background-v1.png",
    "performancegrid": "/images/vst-assets/pulse-drum-pad-background-v1.png",
    "synth": "/images/vst-assets/arctic-macro-synth-background-v1.png",
    "sampler": "/images/vst-assets/studio-sampler-background-v1.png",
}
BUILT_IN_TEMPLATE_BACKGROUND_ALIASES = {
    "ampsimulator": {"/images/vst-assets/original-cream-amp-panel-v1.png"},
    "prismeq": {"/images/vst-assets/prism-spectrum-eq-panel-v1.png"},
}
NATIVE_PARAMETERS = {
    "volume", "tone", "attack", "release", "space", "solo", "mute", "output_level", "gain_reduction",
    "input", "drive", "compress", "width", "mix", "output", "pan", "bypass", "pitch_bend", "modulation",
}
NATIVE_EFFECTS = set()
NATIVE_DSP_MODULE_TYPES = {
    "tuning",
    "wave_generator",
    "input_trim", "soft_clip", "linked_compressor", "de_esser", "parametric_eq", "multiband_compressor", "tone_shaper",
    "stereo_width", "noise_gate", "amp_overdrive", "amp_model", "dual_high_gain", "silk_bloom", "cabinet_ir",
    "cross_delay", "chorus", "flanger", "tremolo", "vibrato", "digital_delay", "reverb", "shimmer",
    "dry_wet", "output_trim", "prism_eq",
}
NATIVE_DSP_MODULE_PARAMETERS = {
    "tuning": {"tuning", "fine_tune"},
    "wave_generator": {
        "waveform", "octave", "semitone", "fine", "level", "pulse_width", "phase_reset", "voice_mode", "retrigger", "note_priority",
        "attack", "decay", "sustain", "release", "filter_cutoff", "filter_resonance",
        "velocity_sensitivity", "velocity_curve", "velocity_min_level",
        "filter_env_amount", "filter_key_tracking", "osc2_enabled", "osc2_waveform", "osc2_octave",
        "osc2_detune", "osc2_level", "osc2_pulse_width", "sub_level", "noise_level",
        "noise_color", "unison_voices", "unison_detune", "stereo_spread", "glide",
        "glide_mode", "vibrato_rate", "vibrato_depth", "vibrato_delay",
    },
    "input_trim": {"normalized", "value", "amount", "input", "gain", "gain_db"},
    "soft_clip": {"normalized", "value", "amount", "drive", "character", "output"},
    "linked_compressor": {"normalized", "value", "amount", "compress", "threshold", "ratio", "attack", "release", "makeup"},
    "de_esser": {"normalized", "value", "amount", "frequency", "threshold", "range", "attack", "release"},
    "prism_eq": {"normalized", "value", "amount"} | {
        f"band_{band}_{suffix}" for band in range(1, 6) for suffix in ("enabled", "frequency", "gain", "q")
    },
    "parametric_eq": {"normalized", "value", "amount", "mode", "low_cut_enabled", "low_cut_frequency", "low_cut_q", "low_gain", "low_frequency", "low_q", "mid_gain", "mid_frequency", "mid_q", "high_gain", "high_frequency", "high_q", "high_cut_enabled", "high_cut_frequency", "high_cut_q", "output"},
    "multiband_compressor": {"normalized", "value", "amount", "low_crossover", "high_crossover", "low_threshold", "low_ratio", "low_attack", "low_release", "low_makeup", "mid_threshold", "mid_ratio", "mid_attack", "mid_release", "mid_makeup", "high_threshold", "high_ratio", "high_attack", "high_release", "high_makeup"},
    "tone_shaper": {"normalized", "value", "amount", "tone", "low", "mid", "high"},
    "stereo_width": {"normalized", "value", "amount", "width", "mono_bass"},
    "noise_gate": {"normalized", "value", "amount", "threshold", "release"},
    "amp_overdrive": {"normalized", "value", "amount", "drive", "tone", "level"},
    "amp_model": {"normalized", "value", "amount", "gain", "bass", "mid", "treble", "presence", "master"},
    "dual_high_gain": {"normalized", "value", "amount", "mode", "gain", "tight", "bass", "mid", "treble", "presence", "depth", "sag", "master"},
    "silk_bloom": {"normalized", "value", "amount", "mode", "pickup", "gain", "touch", "bass", "mid", "treble", "presence", "sag", "master"},
    "cabinet_ir": {"normalized", "value", "amount", "cabinet", "mic_position", "mic_blend", "distance", "low_cut", "high_cut", "resonance", "level"},
    "cross_delay": {"normalized", "value", "amount", "space", "time", "feedback", "crossfeed", "filter"},
    "chorus": {"normalized", "value", "amount", "mix", "rate", "depth", "delay", "feedback", "stereo"},
    "flanger": {"normalized", "value", "amount", "mix", "rate", "depth", "manual", "feedback", "stereo"},
    "tremolo": {"normalized", "value", "amount", "mix", "rate", "depth", "shape", "stereo"},
    "vibrato": {"normalized", "value", "amount", "mix", "rate", "depth", "stereo"},
    "digital_delay": {"normalized", "value", "amount", "mix", "time", "feedback", "tone", "character", "stereo"},
    "reverb": {"normalized", "value", "amount", "mix", "mode", "size", "decay", "damping", "pre_delay", "modulation"},
    "shimmer": {"normalized", "value", "amount", "mix", "size", "decay", "damping", "pre_delay", "shimmer"},
    "dry_wet": {"normalized", "value", "amount", "mix"},
    "output_trim": {"normalized", "value", "amount", "output", "gain", "gain_db"},
}
LEGACY_STANDARD_EFFECT_RACK = (
    ("legacy-input", "input_trim", "Input Trim"),
    ("legacy-saturation", "soft_clip", "Saturation"),
    ("legacy-compressor", "linked_compressor", "Compressor"),
    ("legacy-tone", "tone_shaper", "Tone"),
    ("legacy-width", "stereo_width", "Stereo Width"),
    ("legacy-space", "cross_delay", "Space"),
    ("legacy-mix", "dry_wet", "Dry/Wet"),
    ("legacy-output", "output_trim", "Output Trim"),
)
HERITAGE_FILMSTRIP_SKIN = {
    "id": "heritage",
    "format": "hise-vertical-filmstrip",
    "elements": {
        "knob": {"url": "/images/vst-filmstrips/heritage/heritage-knob-64x128-v2.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "pultec_knob": {"url": "/images/vst-filmstrips/heritage/pultec-knob-64x128-v1.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "modern_spectrum_knob": {"url": "/images/vst-knobs/modern-spectrum-knob-v2.png", "frames": 1, "frame_width": 1254, "frame_height": 1254, "static_face": True},
        "studio_scallop_knob": {"url": "/images/vst-filmstrips/heritage/studio-scallop-knob-64x128-v2.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "black_precision_knob": {"url": "/images/vst-filmstrips/heritage/black-precision-knob-64x128-v1.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "crimson_wing_knob": {"url": "/images/vst-filmstrips/heritage/crimson-wing-knob-64x128-v4.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "black_crimson_wing_knob": {"url": "/images/vst-filmstrips/heritage/black-crimson-wing-knob-64x128-v1.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "regent_white_wing_knob": {"url": "/images/vst-filmstrips/heritage/regent-white-wing-knob-64x128-v1.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "graphite_ridge_knob": {"url": "/images/vst-filmstrips/heritage/graphite-ridge-knob-64x128-v1.png", "frames": 64, "frame_width": 128, "frame_height": 128},
        "button": {"url": "/images/vst-filmstrips/heritage/heritage-button-6x96.png", "frames": 6, "frame_width": 96, "frame_height": 96, "state_order": ["off", "on", "offPressed", "onPressed", "offHover", "onHover"]},
        "fader": {"url": "/images/vst-filmstrips/heritage/heritage-fader-64x96x256.png", "frames": 64, "frame_width": 96, "frame_height": 256},
        "meter": {"url": "/images/vst-filmstrips/heritage/heritage-meter-64x256x128.png", "frames": 64, "frame_width": 256, "frame_height": 128},
    },
}
ACTIVE_BUILD_STATUSES = {"queued", "preparing", "building", "validating", "retrying"}
LEASED_BUILD_STATUSES = {"preparing", "building", "validating"}
WORKER_STATUS_TRANSITIONS = {
    "preparing": {"preparing", "building", "failed"},
    "building": {"building", "validating", "failed"},
    "validating": {"validating", "failed"},
}
WORKER_LEASE_SECONDS = 2 * 60 * 60
MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
MAX_IMPULSE_RESPONSE_BYTES = 32 * 1024 * 1024
MAX_BUILD_ERROR_CHARS = 12_000
MAX_INTERFACE_CONTROLS = 96
MAX_DSP_PARAMETERS_PER_MODULE = 48
CORRECTION_REBUILD_LIMIT = 2
CORRECTION_REBUILD_MAX_CHANGED_PROPERTIES = 30
CORRECTION_REBUILD_MAX_ADDED_COMPONENTS = 3
CORRECTION_REBUILD_MAX_ADDED_SAMPLES = 3
CORRECTION_REBUILD_MAX_SKIN_CHANGES = 3
# Bump this release marker whenever compiler/runtime/capture output changes.
# A ready artifact is reusable only when both its immutable project spec and
# this builder release match; otherwise Export must enqueue a real rebuild.
VST_BUILD_PIPELINE_REVISION = (
    os.environ.get("VST_BUILD_PIPELINE_REVISION", "studio-metal-open-ring-v1").strip()
    or "native-control-parity-v1"
)
VST_MACOS_SAMPLER_ROUTING_ENABLED = os.environ.get(
    "VST_MACOS_SAMPLER_ROUTING_ENABLED", "false"
).strip().lower() in {"1", "true", "yes", "on"}
ALLOWED_BACKGROUND_HOSTS = {
    host.strip().lower()
    for host in os.environ.get("VST_BACKGROUND_ALLOWED_HOSTS", "res.cloudinary.com").split(",")
    if host.strip()
}
async def _customer_sample_storage_bytes(customer_id: str) -> int:
    if not hasattr(db, "vst_maker_sample_assets"):
        return 0
    assets = await db.vst_maker_sample_assets.find(
        {"owner_customer_id": customer_id, "shared_from_template_id": {"$exists": False}},
        {"_id": 0, "size_bytes": 1},
    ).to_list(None)
    return sum(max(0, int(item.get("size_bytes") or 0)) for item in assets)


async def _r2_usage_bytes() -> int:
    if R2_CONFIGURED:
        try:
            return int((await get_private_storage_usage()).get("bytes") or 0)
        except Exception:
            logger.exception("Could not read total R2 usage; falling back to tracked VST objects")
    if not hasattr(db, "vst_maker_sample_assets"):
        return 0
    sample_assets = await db.vst_maker_sample_assets.find(
        {"shared_from_template_id": {"$exists": False}}, {"_id": 0, "size_bytes": 1}
    ).to_list(None)
    artifact_bytes = 0
    if hasattr(db, "vst_maker_build_jobs"):
        artifacts = await db.vst_maker_build_jobs.find(
            {"status": "ready", "artifact_storage_key": {"$type": "string"}},
            {"_id": 0, "artifact_size_bytes": 1},
        ).to_list(None)
        artifact_bytes = sum(max(0, int(item.get("artifact_size_bytes") or 0)) for item in artifacts)
    return sum(max(0, int(item.get("size_bytes") or 0)) for item in sample_assets) + artifact_bytes


async def _reserve_storage_upload(
    *, customer_id: str = "", customer_increment: int = 0, global_increment: int
) -> str:
    token = str(uuid.uuid4())
    async with _storage_upload_lock:
        pending_global = sum(item[2] for item in _pending_storage_reservations.values())
        global_usage = await _r2_usage_bytes()
        projected_global = global_usage + pending_global + max(0, global_increment)
        if projected_global > R2_UPLOAD_STOP_BYTES:
            raise HTTPException(
                507,
                "Penyimpanan VST sedang mencapai batas aman 8 GB. Upload baru dihentikan sementara.",
            )
        if projected_global >= R2_WARNING_BYTES:
            logger.warning("VST R2 storage warning: projected usage is %s bytes", projected_global)

        if customer_id:
            pending_customer = sum(
                item[1] for item in _pending_storage_reservations.values() if item[0] == customer_id
            )
            entitlement = await customer_vst_entitlement(customer_id)
            projected_customer = (
                int(entitlement.get("storage_used_bytes") or 0)
                + pending_customer
                + max(0, customer_increment)
            )
            limit = int(entitlement.get("storage_limit_bytes") or 0)
            if not limit or projected_customer > limit:
                raise HTTPException(
                    413,
                    f"Kuota sample paket {entitlement['tier'].title()} terlampaui.",
                )
        _pending_storage_reservations[token] = (
            customer_id, max(0, customer_increment), max(0, global_increment)
        )
    return token


async def _release_storage_upload(token: str) -> None:
    async with _storage_upload_lock:
        _pending_storage_reservations.pop(token, None)


async def verify_vst_worker(authorization: str = Header(default="")) -> None:
    expected = os.environ.get("VST_BUILD_WORKER_TOKEN", "").strip()
    scheme, _, supplied = authorization.partition(" ")
    if not expected or scheme.lower() != "bearer" or not hmac.compare_digest(supplied.strip(), expected):
        raise HTTPException(401, "Worker token tidak valid", headers={"WWW-Authenticate": "Bearer"})


class WorkerClaimInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    target_platform: Literal["windows", "macos"] = "windows"


class WorkerStatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lease_token: str = Field(min_length=32, max_length=128)
    status: Literal["preparing", "building", "validating", "failed"]
    progress: int = Field(ge=0, le=99)
    message: str = Field(default="", max_length=240)
    # Compiler output can easily exceed the persisted 2,000-character summary.
    # Accept the worker report here and truncate it when writing the job below;
    # rejecting the whole request would leave the job leased in `building`.
    error: str = Field(default="")


def _parse_iso(value):
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def customer_vst_entitlement(customer_id: str) -> dict:
    # Authentication unlocks the editor. Export rights come only from the new
    # one-time business plans or accepted Partner Marketplace terms.
    business = await current_business_entitlement(db, customer_id)
    partner_active = bool(await db.vst_partner_terms.find_one(
        {"customer_id": customer_id, "version": PARTNER_TERMS_VERSION, "accepted": True},
        {"_id": 1},
    ))
    best_tier = str(business.get("plan_id") or "free")
    if best_tier == "free" and partner_active:
        best_tier = "partner"
    storage_used = await _customer_sample_storage_bytes(customer_id)
    storage_limit = TIER_SAMPLE_STORAGE_LIMIT[best_tier]
    return {
        "tier": best_tier,
        "active": True,
        "expires_at": None,
        "features": TIER_FEATURES[best_tier],
        "project_limit": TIER_PROJECT_LIMIT[best_tier],
        "source_product": business.get("plan_name") or "Free Builder",
        "period_started_at": None,
        "business_plan": business,
        "partner_active": partner_active,
        "can_build": best_tier != "free",
        "storage_used_bytes": storage_used,
        "storage_limit_bytes": storage_limit,
        "storage_remaining_bytes": max(0, storage_limit - storage_used),
        "storage_warning": bool(storage_limit and storage_used >= storage_limit * 0.8),
    }


async def _localized_business_catalog(
    request: Request,
    requested_currency: str,
    *,
    personal_first_purchase: bool,
) -> dict:
    requested = (requested_currency or "").strip().upper()
    if requested and requested not in {"IDR", "USD"}:
        raise HTTPException(400, "Mata uang tidak didukung")
    selected_currency, country = await display_currency(request, requested)
    catalog = business_catalog(personal_first_purchase=personal_first_purchase)
    rate_info = (
        await get_usd_idr_rate()
        if selected_currency == "USD"
        else {"rate": 0, "date": "", "source": ""}
    )
    return {
        **catalog,
        "display_currency": selected_currency,
        "visitor_country": country,
        "fx_rate": float(rate_info.get("rate") or 0),
        "fx_rate_date": str(rate_info.get("date") or ""),
        "fx_rate_source": str(rate_info.get("source") or ""),
        "plans": localize_plan_prices(
            catalog["plans"],
            selected_currency,
            rate_info.get("rate") or 0,
        ),
    }


@customer_router.get("/vst-maker/billing/catalog")
async def vst_maker_billing_catalog(request: Request, currency: str = ""):
    catalog = await _localized_business_catalog(
        request,
        currency,
        personal_first_purchase=True,
    )
    return {
        **catalog,
        "renewal": "none",
    }


@customer_router.get("/customer/vst-maker/billing")
async def customer_vst_billing(
    request: Request,
    currency: str = "",
    customer_id: str = Depends(verify_customer),
):
    entitlement = await customer_vst_entitlement(customer_id)
    first_purchase = await personal_first_purchase_eligible(db, customer_id)
    return {
        "entitlement": entitlement,
        "business_entitlements": await business_entitlements(db, customer_id),
        "catalog": await _localized_business_catalog(
            request,
            currency,
            personal_first_purchase=first_purchase,
        ),
    }


async def _require_customer_maker(customer_id: str) -> dict:
    entitlement = await customer_vst_entitlement(customer_id)
    return entitlement

MAX_SAMPLE_BYTES = 512 * 1024 * 1024
MAX_BACKGROUND_BYTES = 10 * 1024 * 1024
ALLOWED_EFFECTS = {"reverb", "delay", "chorus", "saturation"}
ALLOWED_CONTROLS = {"volume", "tone", "attack", "release", "space"}
ALLOWED_SAMPLE_SUFFIXES = {".wav"}
SAMPLE_CONTENT_TYPES = {
    ".wav": "audio/wav",
}


def _sample_suffix(filename: str) -> str:
    clean_name = str(filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    return "." + clean_name.rsplit(".", 1)[-1].lower() if "." in clean_name else ""


def _validated_background_url(value) -> str | None:
    """Accept only same-origin assets or images owned by the configured CDN."""
    if value is None:
        return None
    url = str(value).strip()
    if not url:
        return None
    if url.startswith("/images/") and not url.startswith("/images//") and ".." not in url.split("/"):
        return url

    parsed = urlsplit(url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or parsed.hostname.lower() not in ALLOWED_BACKGROUND_HOSTS
    ):
        raise ValueError("URL background harus berasal dari penyimpanan gambar yang diizinkan")
    if parsed.hostname.lower() == "res.cloudinary.com":
        expected_prefix = f"/{CLOUD_NAME}/image/upload/" if CLOUD_NAME else ""
        if not expected_prefix or not parsed.path.startswith(expected_prefix):
            raise ValueError("URL background Cloudinary tidak sesuai akun aplikasi")
    return url


def _valid_audio_signature(suffix: str, header: bytes) -> bool:
    if suffix == ".wav":
        # The native VST3 runtime currently reads RIFF/WAVE containers.  Keep
        # the API contract identical so an upload cannot pass validation and
        # then fail later in the build worker (for example, an RF64 file).
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    return False


def _inspect_sample_file(
    file_object, filename: str, *, max_bytes: int = MAX_SAMPLE_BYTES, size_label: str = "sample"
) -> tuple[int, str, str]:
    """Validate a RIFF/WAVE file and hash it without retaining it in RAM."""
    suffix = _sample_suffix(filename)
    if suffix not in ALLOWED_SAMPLE_SUFFIXES:
        raise ValueError("Format sample harus WAV")
    file_object.seek(0)
    header = file_object.read(12)
    if not _valid_audio_signature(suffix, header):
        file_object.seek(0)
        raise ValueError("Isi file tidak cocok dengan format audio yang dipilih")
    digest = hashlib.sha256()
    digest.update(header)
    file_size = len(header)
    while chunk := file_object.read(1024 * 1024):
        file_size += len(chunk)
        if file_size > max_bytes:
            file_object.seek(0)
            raise OverflowError(f"Ukuran {size_label} melebihi batas {max_bytes // (1024 * 1024)} MB")
        digest.update(chunk)
    file_object.seek(0)
    if file_size <= 12:
        raise ValueError("File audio kosong atau rusak")
    return file_size, digest.hexdigest(), SAMPLE_CONTENT_TYPES[suffix]


class VstMakerSampleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=64)
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=0, le=MAX_SAMPLE_BYTES)

    @field_validator("id", mode="before")
    @classmethod
    def strip_sample_id(cls, value):
        return str(value or "").strip()

    @field_validator("filename", mode="before")
    @classmethod
    def validate_filename(cls, value):
        filename = str(value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not filename or any(ord(character) < 32 for character in filename):
            raise ValueError("Nama file sampel tidak valid")
        suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if suffix not in ALLOWED_SAMPLE_SUFFIXES:
            raise ValueError("Format sample harus WAV")
        return filename


class VstMakerImpulseResponseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=64)
    module_id: str = Field(min_length=1, max_length=64)
    filename: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=12, le=MAX_IMPULSE_RESPONSE_BYTES)
    normalize: bool = True
    auto_trim: bool = True
    trim_start: float = Field(default=0.0, ge=0.0, le=1.0)
    trim_end: float = Field(default=1.0, ge=0.0, le=1.0)
    polarity_inverted: bool = False
    phase_ms: float = Field(default=0.0, ge=-2.0, le=2.0)

    @field_validator("id", "module_id", mode="before")
    @classmethod
    def strip_impulse_ids(cls, value):
        return str(value or "").strip()

    @field_validator("filename", mode="before")
    @classmethod
    def validate_impulse_filename(cls, value):
        filename = str(value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not filename or any(ord(character) < 32 for character in filename) or not filename.lower().endswith(".wav"):
            raise ValueError("Impulse response harus berupa WAV")
        return filename

    @model_validator(mode="after")
    def validate_impulse_trim(self):
        if self.trim_start >= self.trim_end:
            raise ValueError("Trim akhir IR harus setelah trim awal")
        return self


class VstMakerSampleMappingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    sample_id: str = Field(min_length=1, max_length=64)
    root_pitch: int = Field(ge=0, le=127)
    low_pitch: int = Field(ge=0, le=127)
    high_pitch: int = Field(ge=0, le=127)
    velocity_low: int = Field(ge=1, le=127)
    velocity_high: int = Field(ge=1, le=127)
    group_name: str = Field(default="Main", min_length=1, max_length=48)
    articulation: str = Field(default="Sustain", min_length=1, max_length=48)
    round_robin: int = Field(default=1, ge=1, le=32)
    mic_position: str = Field(default="Main", min_length=1, max_length=48)
    sample_start: float = Field(default=0.0, ge=0.0, le=1.0)
    sample_end: float = Field(default=1.0, ge=0.0, le=1.0)
    loop_enabled: bool = False
    loop_start: float = Field(default=0.0, ge=0.0, le=1.0)
    loop_end: float = Field(default=1.0, ge=0.0, le=1.0)
    loop_crossfade_ms: int = Field(default=8, ge=0, le=100)
    fade_in_ms: int = Field(default=0, ge=0, le=10000)
    fade_out_ms: int = Field(default=0, ge=0, le=10000)
    tune_semitones: int = Field(default=0, ge=-24, le=24)
    tune_cents: int = Field(default=0, ge=-1200, le=1200)
    playback_mode: Literal["sampler", "tempo_sync"] = "sampler"
    source_bpm: float = Field(default=120.0, ge=20.0, le=300.0)
    source_bpm_confirmed: bool = False
    choke_target_pitches: list[int] = Field(default_factory=list, max_length=16)
    gain_db: float = Field(default=0.0, ge=-24.0, le=12.0)
    pan: float = Field(default=0.0, ge=-1.0, le=1.0)

    @field_validator("id", "sample_id", mode="before")
    @classmethod
    def strip_mapping_ids(cls, value):
        return str(value or "").strip()

    @field_validator("group_name", "articulation", "mic_position", mode="before")
    @classmethod
    def strip_mapping_labels(cls, value):
        return str(value or "").strip()

    @field_validator("choke_target_pitches", mode="before")
    @classmethod
    def normalize_choke_target_pitches(cls, value):
        pitches = value if isinstance(value, list) else []
        normalized = []
        for pitch in pitches:
            numeric = int(pitch)
            if not 0 <= numeric <= 127:
                raise ValueError("Choke target harus berupa note MIDI 0–127")
            if numeric not in normalized:
                normalized.append(numeric)
        return normalized

    @model_validator(mode="after")
    def validate_mapping_ranges(self):
        if not self.low_pitch <= self.root_pitch <= self.high_pitch:
            raise ValueError("Root note harus berada di dalam rentang key zona")
        if self.velocity_low > self.velocity_high:
            raise ValueError("Velocity awal tidak boleh lebih tinggi dari velocity akhir")
        if self.sample_start >= self.sample_end:
            raise ValueError("Posisi akhir sample harus setelah posisi awal")
        if self.loop_enabled and not self.sample_start <= self.loop_start < self.loop_end <= self.sample_end:
            raise ValueError("Loop harus berada di dalam rentang playback sample")
        return self


class VstMakerInterfaceControlInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    kind: Literal["button", "knob", "fader", "pad", "keyboard", "solo", "mute", "solo_mute", "gain_meter", "vu_meter", "visual", "spectrum", "indicator", "text", "image", "panel_button", "output_selector"]
    label: str = Field(max_length=80)
    off_label: str | None = Field(default=None, max_length=24)
    on_label: str | None = Field(default=None, max_length=24)
    parameter: str = Field(min_length=1, max_length=80)
    module_id: str | None = Field(default=None, max_length=64)
    sampler_group_id: str | None = Field(default=None, max_length=64)
    note_pitch: int = Field(default=60, ge=0, le=127)
    key_count: Literal[25, 37, 49, 61] | None = None
    key_colors: dict[str, str] = Field(default_factory=dict, max_length=88)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    value: int = Field(ge=0, le=100)
    width: int = Field(default=112, ge=12, le=1600)
    height: int = Field(default=122, ge=12, le=1024)
    opacity: int = Field(default=100, ge=0, le=100)
    rotation: float = Field(default=0, ge=-180, le=180)
    show_background: bool = True
    label_position: Literal[
        "top-left", "top-center", "top-right",
        "bottom-left", "bottom-center", "bottom-right",
    ] = "top-left"
    label_gap: int = Field(default=12, ge=0, le=24)
    label_x: float = Field(default=0, ge=-512, le=512)
    label_y: float = Field(default=0, ge=-512, le=512)
    state_label_gap: int | None = Field(default=None, ge=0, le=32)
    component_style: Literal["inherit", "css", "filmstrip"] = "inherit"
    component_variant: str = Field(default="classic", min_length=1, max_length=32, pattern=r"^[a-z0-9-]+$")
    meter_mode: Literal["mono", "stereo"] | None = None
    pad_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    pad_active_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    visual_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    spectrum_band: bool = False
    prism_control_mode: Literal["contextual", "direct"] | None = None
    prism_context: Literal["frequency", "gain", "q"] | None = None
    prism_owner_id: str | None = Field(default=None, max_length=64)
    show_correlation_meter: bool = True
    waveform_line_width: float = Field(default=1.8, ge=0.5, le=8)
    ring_thickness: float | None = Field(default=None, ge=1, le=16)
    ring_glow_intensity: float | None = Field(default=None, ge=0, le=100)
    bar_width_ratio: float = Field(default=0.54, ge=0.1, le=1)
    text_font: Literal["outfit", "manrope", "space-grotesk", "cinzel", "cormorant-garamond"] = "space-grotesk"
    text_color: str = Field(default="#F4F4F5", pattern=r"^#[0-9A-Fa-f]{6}$")
    control_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    output_font_size: int | None = Field(default=None, ge=6, le=32)
    fader_meter_enabled: bool = True
    fader_meter_position: Literal["left", "right"] = "right"
    fader_meter_color: str = Field(default="#22C55E", pattern=r"^#[0-9A-Fa-f]{6}$")
    fader_meter_gap: int = Field(default=4, ge=0, le=32)
    fader_meter_width: int = Field(default=10, ge=4, le=32)
    fader_meter_height: int = Field(default=100, ge=20, le=100)
    solo_mute_gap: int = Field(default=8, ge=0, le=48)
    solo_color: str = Field(default="#FACC15", pattern=r"^#[0-9A-Fa-f]{6}$")
    mute_color: str = Field(default="#FB7185", pattern=r"^#[0-9A-Fa-f]{6}$")
    button_shape: Literal["square", "capsule", "round"] = "square"
    indicator_source_id: str | None = Field(default=None, max_length=64)
    midi_sequence_id: str | None = Field(default=None, max_length=64)
    image_url: str | None = Field(default=None, max_length=2048)
    image_name: str | None = Field(default=None, max_length=160)
    image_fit: Literal["contain", "cover", "stretch"] = "contain"
    image_opacity: int = Field(default=100, ge=0, le=100)
    parent_panel_id: str | None = Field(default=None, max_length=64)
    panel_type: Literal["preset_browser", "mixer", "midi_map"] | None = None
    panel_x: float = Field(default=50, ge=0, le=100)
    panel_y: float = Field(default=52, ge=0, le=100)
    panel_width: float = Field(default=88, ge=35, le=96)
    panel_height: float = Field(default=78, ge=30, le=92)
    mixer_show_default_controls: bool = True
    frequency: float | None = Field(default=None, ge=10, le=30000)
    q: float | None = Field(default=None, ge=0.025, le=40)

    @field_validator("id", "label", "parameter", mode="before")
    @classmethod
    def strip_control_text(cls, value):
        return str(value or "").strip()

    @field_validator("off_label", "on_label", mode="before")
    @classmethod
    def strip_optional_control_text(cls, value):
        if value is None:
            return None
        return str(value).strip()

    @field_validator("key_colors", mode="before")
    @classmethod
    def validate_key_colors(cls, value):
        if value in (None, {}):
            return {}
        if not isinstance(value, dict) or len(value) > 88:
            raise ValueError("Warna tuts keyboard tidak valid")
        colors = {}
        for raw_pitch, raw_color in value.items():
            try:
                pitch = int(raw_pitch)
            except (TypeError, ValueError) as error:
                raise ValueError("Nomor tuts keyboard tidak valid") from error
            color = str(raw_color or "").upper()
            if pitch < 0 or pitch > 127 or not re.fullmatch(r"#[0-9A-F]{6}", color):
                raise ValueError("Warna tuts keyboard tidak valid")
            colors[str(pitch)] = color
        return colors

    @field_validator("image_url")
    @classmethod
    def validate_image_url(cls, value):
        return _validated_background_url(value)

    @model_validator(mode="after")
    def validate_control_dimensions(self):
        if self.kind == "button" and self.component_variant == "mechanical-toggle":
            if self.state_label_gap is None:
                self.state_label_gap = max(0, min(32, round(5 + self.label_y)))
        elif self.state_label_gap is not None:
            raise ValueError("Jarak label status hanya berlaku untuk Mechanical Toggle")
        if self.meter_mode is None:
            self.meter_mode = "stereo" if self.kind == "gain_meter" else "mono"
        if self.kind not in {"gain_meter", "vu_meter"} and self.meter_mode != "mono":
            raise ValueError("Mode meter hanya berlaku untuk komponen meter")
        if self.kind == "keyboard" and (self.width < 240 or self.height < 112):
            raise ValueError("Ukuran keyboard minimum adalah 240 x 112 px")
        if self.kind not in {"text", "keyboard", "indicator"} and (self.width < 48 or self.height < 48):
            raise ValueError("Ukuran komponen minimum adalah 48 x 48 px")
        if self.kind == "indicator" and (self.width < 12 or self.height < 12):
            raise ValueError("Ukuran Lampu LED minimum adalah 12 x 12 px")
        if self.kind == "text" and (self.width < 32 or self.height < 24):
            raise ValueError("Ukuran Text minimum adalah 32 x 24 px")
        if self.kind == "image" and not self.image_url:
            raise ValueError("Komponen gambar harus memiliki URL gambar")
        if self.kind == "panel_button" and not self.panel_type:
            raise ValueError("Panel Button harus memiliki tipe panel")
        if self.kind != "panel_button" and self.panel_type is not None:
            raise ValueError("Tipe panel hanya berlaku untuk Panel Button")
        if self.kind != "indicator" and self.indicator_source_id is not None:
            raise ValueError("Sumber indikator hanya berlaku untuk Lampu LED")
        sampler_value_parameters = {
            "knob": {"volume", "pan"}, "fader": {"volume", "pan"},
            "button": {"mute", "solo"}, "solo": {"solo"}, "mute": {"mute"},
            "solo_mute": {"solo_mute"},
        }
        sampler_note_kinds = {"pad", "keyboard"}
        sampler_monitor_kinds = {"gain_meter", "vu_meter", "spectrum"}
        if self.kind == "output_selector" and self.module_id is not None:
            raise ValueError("Output Selector tidak dapat terhubung ke modul DSP")
        if self.sampler_group_id is not None:
            if self.module_id is not None:
                raise ValueError("Target modul dan sampler tidak dapat aktif bersamaan")
            valid_sampler_binding = (
                self.kind == "output_selector"
                or self.kind in sampler_note_kinds
                or self.parameter in sampler_value_parameters.get(self.kind, set())
                or (self.kind in sampler_monitor_kinds and self.parameter == "output_level")
                or (self.kind == "indicator" and self.parameter in {"volume", "pan", "mute", "solo"})
            )
            if not valid_sampler_binding:
                raise ValueError("Target sampler hanya berlaku untuk Volume, Pan, Mute, atau Solo dan komponen audio yang kompatibel")
        if self.kind == "solo_mute" and self.sampler_group_id is None:
            raise ValueError("Komponen Solo + Mute harus memilih satu sampler target")
        if self.kind == "output_selector" and self.output_font_size is None:
            self.output_font_size = 11
        if self.kind != "output_selector" and self.output_font_size is not None:
            raise ValueError("Ukuran teks pilihan hanya berlaku untuk Output Selector")
        if self.kind not in {"button", "pad"} and self.midi_sequence_id is not None:
            raise ValueError("Pola MIDI hanya dapat dihubungkan ke Button atau Pad")
        if self.kind == "panel_button" and self.parent_panel_id:
            raise ValueError("Panel Button tidak dapat ditempatkan di dalam panel lain")
        if (self.kind != "panel_button" or self.panel_type != "mixer") and not self.mixer_show_default_controls:
            raise ValueError("Visibilitas kontrol Mixer hanya berlaku untuk Panel Mixer")
        if self.prism_control_mode is not None and (self.kind != "spectrum" or self.component_variant != "realtime-spectrum"):
            raise ValueError("Mode kontrol Prism hanya berlaku untuk Spectrum Analyzer interaktif")
        if self.prism_context is not None:
            expected = f"prism_{self.prism_context}"
            if self.kind != "knob" or self.parameter != expected or not self.prism_owner_id:
                raise ValueError("Kontrol kontekstual Prism harus berupa knob alias dengan analyzer pemilik")
        return self


class VstMakerPresetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=48)
    category: Literal["factory", "user"] = "user"
    control_values: dict[str, float] = Field(default_factory=dict)
    group_values: dict[str, dict[str, float | bool]] = Field(default_factory=dict)
    module_values: dict[str, dict] = Field(default_factory=dict)
    midi_sequence_id: str | None = Field(default=None, max_length=64)

    @field_validator("id", "name", mode="before")
    @classmethod
    def normalize_preset_text(cls, value):
        return " ".join(str(value or "").split())

    @field_validator("control_values")
    @classmethod
    def validate_control_values(cls, value):
        if len(value) > MAX_INTERFACE_CONTROLS:
            raise ValueError("Preset memiliki terlalu banyak nilai kontrol")
        return {str(key)[:64]: max(0.0, min(100.0, float(item))) for key, item in value.items()}

    @field_validator("group_values")
    @classmethod
    def validate_group_values(cls, value):
        if len(value) > 16:
            raise ValueError("Preset memiliki terlalu banyak nilai sampler")
        normalized = {}
        for group_id, raw_values in value.items():
            values = dict(raw_values or {})
            if set(values) - {"volume", "pan", "mute", "solo"}:
                raise ValueError("Nilai sampler preset tidak didukung")
            normalized[str(group_id)[:64]] = {
                **({"volume": max(0.0, min(100.0, float(values["volume"])))} if "volume" in values else {}),
                **({"pan": max(-1.0, min(1.0, float(values["pan"])))} if "pan" in values else {}),
                **({"mute": bool(values["mute"])} if "mute" in values else {}),
                **({"solo": bool(values["solo"])} if "solo" in values else {}),
            }
        return normalized

    @field_validator("module_values")
    @classmethod
    def validate_module_values(cls, value):
        if len(value) > 128:
            raise ValueError("Preset memiliki terlalu banyak modul DSP")
        normalized = {}
        for module_id, raw_values in value.items():
            values = dict(raw_values or {})
            if set(values) - {"bypassed", "mix", "parameters"}:
                raise ValueError("Nilai modul DSP preset tidak didukung")
            parameters = dict(values.get("parameters") or {})
            if len(parameters) > MAX_DSP_PARAMETERS_PER_MODULE:
                raise ValueError(
                    f"Preset modul DSP maksimal memiliki {MAX_DSP_PARAMETERS_PER_MODULE} parameter"
                )
            normalized_parameters = {}
            for key, raw_value in parameters.items():
                parameter_key = str(key or "").strip()
                numeric_value = float(raw_value)
                if not re.fullmatch(r"[a-z][a-z0-9_]{0,47}", parameter_key) or not math.isfinite(numeric_value):
                    raise ValueError("Parameter modul DSP preset tidak valid")
                normalized_parameters[parameter_key] = numeric_value
            normalized[str(module_id)[:64]] = {
                "bypassed": bool(values.get("bypassed", False)),
                "mix": max(0.0, min(1.0, float(values.get("mix", 1.0)))),
                "parameters": normalized_parameters,
            }
        return normalized


class VstMakerMidiMappingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    source_type: Literal["cc", "note"] = "cc"
    channel: int = Field(default=0, ge=0, le=16)
    source_number: int = Field(ge=0, le=127)
    target_control_id: str = Field(min_length=1, max_length=64)
    minimum: float = Field(default=0, ge=0, le=100)
    maximum: float = Field(default=100, ge=0, le=100)
    inverted: bool = False


class VstMakerMidiEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tick: int = Field(ge=0, le=100_000_000)
    type: Literal["note_on", "note_off", "control_change"]
    note: int | None = Field(default=None, ge=0, le=127)
    velocity: int = Field(default=0, ge=0, le=127)
    controller: int | None = Field(default=None, ge=0, le=127)
    value: int = Field(default=0, ge=0, le=127)
    channel: int = Field(default=0, ge=0, le=15)
    relative_degree: int | None = Field(default=None, ge=-128, le=128)

    @model_validator(mode="after")
    def validate_event_payload(self):
        if self.type in {"note_on", "note_off"} and self.note is None:
            raise ValueError("Event note MIDI memerlukan note")
        if self.type == "control_change" and self.controller != 64:
            raise ValueError("Hanya MIDI Sustain CC64 yang didukung")
        return self


class VstMakerMidiTempoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tick: int = Field(ge=0, le=100_000_000)
    bpm: float = Field(ge=20, le=400)


class VstMakerMidiSequenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    ppq: int = Field(ge=24, le=9600)
    duration_ticks: int = Field(ge=0, le=100_000_000)
    loop_enabled: bool = False
    events: list[VstMakerMidiEventInput] = Field(default_factory=list, max_length=8192)
    tempos: list[VstMakerMidiTempoInput] = Field(default_factory=lambda: [VstMakerMidiTempoInput(tick=0, bpm=120)], max_length=128)
    generator_config: dict[str, Any] | None = None

    @field_validator("generator_config")
    @classmethod
    def validate_generator_config(cls, value):
        if value is None:
            return None
        allowed_keys = {
            "mode", "root", "octave", "scale", "bpm", "steps", "gate", "variation",
            "chordType", "direction", "octaves", "chordMode", "singleChordType",
            "progression", "customProgression", "bassStyle", "contour", "density",
            "range", "stepNotes",
        }
        if set(value) - allowed_keys:
            raise ValueError("Konfigurasi generator MIDI memuat field yang tidak didukung")
        if len(json.dumps(value, separators=(",", ":"), ensure_ascii=True)) > 4096:
            raise ValueError("Konfigurasi generator MIDI terlalu besar")
        return value


class VstMakerPianoNoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    pitch: int = Field(ge=48, le=71)
    step: int = Field(ge=0, le=31)
    length: int = Field(ge=1, le=32)
    velocity: int = Field(ge=1, le=127)

    @field_validator("id", mode="before")
    @classmethod
    def strip_note_id(cls, value):
        return str(value or "").strip()

    @model_validator(mode="after")
    def validate_note_end(self):
        if self.step + self.length > 32:
            raise ValueError("Nada piano roll tidak boleh melewati akhir dua bar")
        return self


class VstMakerEngineModuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    parent_id: str | None = Field(default=None, max_length=64)
    sampler_group_id: str | None = Field(default=None, max_length=64)
    order: int = Field(default=0, ge=0, le=127)
    bypassed: bool = False
    mix: float = Field(default=1.0, ge=0.0, le=1.0)
    parameters: dict[str, float] = Field(default_factory=dict)

    @field_validator("id", "type", "name", mode="before")
    @classmethod
    def strip_module_text(cls, value):
        return str(value or "").strip()

    @field_validator("parameters")
    @classmethod
    def validate_module_parameters(cls, value):
        if len(value) > MAX_DSP_PARAMETERS_PER_MODULE:
            raise ValueError(
                f"Satu modul DSP maksimal memiliki {MAX_DSP_PARAMETERS_PER_MODULE} parameter"
            )
        normalized = {}
        for key, parameter_value in value.items():
            parameter_key = str(key or "").strip()
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,47}", parameter_key):
                raise ValueError("Nama parameter modul DSP tidak valid")
            numeric_value = float(parameter_value)
            if not math.isfinite(numeric_value) or abs(numeric_value) > 1_000_000:
                raise ValueError("Nilai parameter modul DSP tidak valid")
            normalized[parameter_key] = numeric_value
        return normalized

class VstMakerSamplerGroupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=48)
    volume: float = Field(default=100, ge=0, le=100)
    pan: float = Field(default=0, ge=-1, le=1)
    mute: bool = False
    solo: bool = False
    output_bus: Literal["master", "separate"] = "master"

    @field_validator("id", "name", mode="before")
    @classmethod
    def strip_sampler_group_text(cls, value):
        return str(value or "").strip()


class VstMakerProjectInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=48)
    manufacturer_name: str = Field(default="TripleSide Studio", min_length=1, max_length=64)
    brand_tagline: str = Field(default="", max_length=80)
    brand_font: Literal["outfit", "manrope", "space-grotesk", "cinzel", "cormorant-garamond"] = "outfit"
    brand_size: int = Field(default=24, ge=12, le=64)
    brand_x: float = Field(default=18, ge=4, le=96)
    # Accept legacy/open browser drafts that used the original top-safe margin
    # of 4%. The editor still guides new placements to 7% or lower.
    brand_y: float = Field(default=13, ge=4, le=93)
    brand_align: Literal["left", "center", "right"] = "left"
    plugin_version: str = Field(default="1.0.0", pattern=r"^\d+\.\d+\.\d+$")
    plugin_kind: Literal["instrument", "effect"] = "instrument"
    instrument_type: Literal["Audio Effect", "Sampler", "Synth", "Drum Pad", "Keys", "Piano", "Pluck", "Bass", "Strings", "Pads", "Percussion"]
    root_note: Literal["C2", "C3", "C4", "C5", "D3", "E3", "F3", "G3", "A3"]
    note_range: Literal["C1–C6", "C2–C5", "C2–C6", "C3–C6"]
    velocity_layers: int = Field(ge=1, le=4)
    polyphony: Literal[8, 16, 32, 64, 128]
    tempo_bpm: float = Field(default=120.0, ge=20.0, le=300.0)
    sustain_enabled: bool = False
    pitch_bend_enabled: bool = False
    modulation_enabled: bool = False
    project_template: Literal["basicvst", "basicfx", "ampsimulator", "obsidianhighgain", "regentstrip", "regentwhite", "mixforge", "vintageeq", "velofet", "azureeq", "prismeq", "modernreverb", "moderndelay", "modernsaturation", "premiumkeys", "analogsynth", "hybriddrums", "cinematicstrings", "electricbass", "neonpopdrums", "drumpad", "performancegrid", "synth", "sampler"] = "sampler"
    pricing_template_id: str = Field(default="", max_length=100, pattern=r"^[A-Za-z0-9._:-]*$")
    license_max_activations: int = Field(default=1, ge=0, le=3)
    keyboard_keys: Literal[25, 37, 49, 61] = 49
    canvas_width: int = Field(default=0, ge=0, le=1024)
    canvas_height: int = Field(default=0, ge=0, le=1024)
    background_image_url: str | None = Field(default=None, max_length=2048)
    background_image_name: str | None = Field(default=None, max_length=160)
    background_fit: Literal["cover", "contain", "stretch"] = "cover"
    background_opacity: int = Field(default=70, ge=0, le=100)
    background_image_x: float = Field(default=50, ge=0, le=100)
    background_image_y: float = Field(default=50, ge=0, le=100)
    background_image_width: float = Field(default=100, ge=10, le=200)
    background_image_height: float = Field(default=100, ge=10, le=200)
    component_style: Literal["filmstrip", "css"] = "filmstrip"
    grid_snap_enabled: bool = True
    grid_size: Literal[4, 8, 16, 24] = 8
    resize_aspect_locked: bool = True
    ui_template: Literal["mixforge", "studio", "vintage", "arctic", "aurum"] = "studio"
    ui_color: str = Field(default="#09090b", pattern=r"^#[0-9a-fA-F]{6}$")
    accent_color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    effects: dict[str, bool] = Field(default_factory=dict)
    controls: list[Literal["input", "drive", "compress", "volume", "tone", "width", "attack", "release", "space", "mix", "output", "pan", "bypass", "output_level", "gain_reduction"]] = Field(default_factory=list, max_length=15)
    interface_controls: list[VstMakerInterfaceControlInput] = Field(default_factory=list, max_length=MAX_INTERFACE_CONTROLS + 3)
    presets: list[VstMakerPresetInput] = Field(default_factory=list, max_length=128)
    midi_mappings: list[VstMakerMidiMappingInput] = Field(default_factory=list, max_length=128)
    midi_sequences: list[VstMakerMidiSequenceInput] = Field(default_factory=list, max_length=16)
    sampler_groups: list[VstMakerSamplerGroupInput] = Field(default_factory=lambda: [VstMakerSamplerGroupInput(id="main", name="Main")], min_length=1, max_length=16)
    engine_modules: list[VstMakerEngineModuleInput] = Field(default_factory=list, max_length=128)
    piano_roll_notes: list[VstMakerPianoNoteInput] = Field(default_factory=list, max_length=128)
    sample_mappings: list[VstMakerSampleMappingInput] = Field(default_factory=list, max_length=128)
    samples: list[VstMakerSampleInput] = Field(default_factory=list, max_length=128)
    impulse_responses: list[VstMakerImpulseResponseInput] = Field(default_factory=list, max_length=16)

    @field_validator("name", "manufacturer_name", "brand_tagline", mode="before")
    @classmethod
    def strip_project_name(cls, value):
        return str(value or "").strip()

    @field_validator("background_image_url")
    @classmethod
    def validate_background_image_url(cls, value):
        return _validated_background_url(value)

    @field_validator("effects")
    @classmethod
    def validate_effects(cls, value):
        if set(value) - ALLOWED_EFFECTS:
            raise ValueError("Daftar efek memuat pilihan yang tidak didukung")
        return {effect: bool(value.get(effect, False)) for effect in sorted(ALLOWED_EFFECTS)}

    @field_validator("controls")
    @classmethod
    def deduplicate_controls(cls, value):
        return list(dict.fromkeys(value))

    @field_validator("interface_controls")
    @classmethod
    def validate_interface_control_ids(cls, value):
        control_ids = [control.id for control in value]
        if len(control_ids) != len(set(control_ids)):
            raise ValueError("ID kontrol panel harus unik")
        ordinary_controls = [
            control for control in value
            if control.parameter not in {"prism_frequency", "prism_gain", "prism_q"}
        ]
        if len(ordinary_controls) > MAX_INTERFACE_CONTROLS:
            raise ValueError(f"Panel dibatasi maksimal {MAX_INTERFACE_CONTROLS} komponen biasa")
        panels = {control.id for control in value if control.kind == "panel_button"}
        if any(control.parent_panel_id and control.parent_panel_id not in panels for control in value):
            raise ValueError("Komponen panel merujuk ke Panel Button yang tidak tersedia")
        prism_analyzers = {
            control.id for control in value
            if control.kind == "spectrum" and control.component_variant == "realtime-spectrum"
        }
        if any(control.prism_owner_id and control.prism_owner_id not in prism_analyzers for control in value):
            raise ValueError("Kontrol kontekstual Prism merujuk ke analyzer yang tidak tersedia")
        controls_by_id = {control.id: control for control in value}
        if any(
            control.indicator_source_id
            and (
                control.indicator_source_id == control.id
                or control.indicator_source_id not in controls_by_id
                or controls_by_id[control.indicator_source_id].kind == "indicator"
            )
            for control in value
        ):
            raise ValueError("Lampu LED merujuk ke sumber indikator yang tidak valid")
        return value

    @model_validator(mode="after")
    def validate_panel_feature_references(self):
        # MIDI CC maps were retired in favor of a focused groove browser.
        # Accept legacy payloads, but never persist or compile their mappings.
        self.midi_mappings = []
        control_ids = {control.id for control in self.interface_controls}
        group_ids = {group.id for group in self.sampler_groups}
        if self.plugin_kind == "effect" and any(control.kind == "output_selector" for control in self.interface_controls):
            raise ValueError("Combo Box Multiple Output hanya tersedia untuk plugin instrumen")
        module_ids = {module.id for module in self.engine_modules}
        if any(module.sampler_group_id and module.sampler_group_id not in group_ids for module in self.engine_modules):
            raise ValueError("Modul DSP merujuk ke sampler yang tidak tersedia")
        if any(control.sampler_group_id and control.sampler_group_id not in group_ids for control in self.interface_controls):
            raise ValueError("Komponen merujuk ke sampler yang tidak tersedia")
        if any(set(preset.control_values) - control_ids for preset in self.presets):
            raise ValueError("Preset merujuk ke komponen yang tidak tersedia")
        if any(set(preset.group_values) - group_ids for preset in self.presets):
            raise ValueError("Preset merujuk ke sampler yang tidak tersedia")
        if any(set(preset.module_values) - module_ids for preset in self.presets):
            raise ValueError("Preset merujuk ke modul DSP yang tidak tersedia")
        preset_ids = [preset.id for preset in self.presets]
        preset_names = [preset.name.casefold() for preset in self.presets]
        sequence_ids = [sequence.id for sequence in self.midi_sequences]
        if len(preset_ids) != len(set(preset_ids)) or len(sequence_ids) != len(set(sequence_ids)):
            raise ValueError("ID preset dan MIDI sequence harus unik")
        if len(preset_names) != len(set(preset_names)):
            raise ValueError("Nama preset harus unik")
        sequence_id_set = set(sequence_ids)
        if any(control.midi_sequence_id and control.midi_sequence_id not in sequence_id_set for control in self.interface_controls):
            raise ValueError("Komponen merujuk ke pola MIDI yang tidak tersedia")
        if any(preset.midi_sequence_id and preset.midi_sequence_id not in sequence_id_set for preset in self.presets):
            raise ValueError("Preset merujuk ke pola MIDI yang tidak tersedia")
        return self

    @field_validator("sampler_groups")
    @classmethod
    def validate_sampler_groups(cls, value):
        ids = [group.id for group in value]
        names = [group.name.casefold() for group in value]
        if len(ids) != len(set(ids)) or len(names) != len(set(names)):
            raise ValueError("ID dan nama sampler harus unik")
        if any(group.mute and group.solo for group in value):
            raise ValueError("Mute dan Solo sampler yang sama tidak dapat aktif bersamaan")
        return value

    @field_validator("engine_modules")
    @classmethod
    def validate_engine_module_ids(cls, value):
        module_ids = [module.id for module in value]
        if len(module_ids) != len(set(module_ids)):
            raise ValueError("ID modul engine harus unik")
        return value

    @field_validator("piano_roll_notes")
    @classmethod
    def validate_piano_note_ids(cls, value):
        note_ids = [note.id for note in value]
        if len(note_ids) != len(set(note_ids)):
            raise ValueError("ID nada piano roll harus unik")
        return value

    @field_validator("sample_mappings")
    @classmethod
    def validate_sample_mapping_ids(cls, value):
        mapping_ids = [mapping.id for mapping in value]
        if len(mapping_ids) != len(set(mapping_ids)):
            raise ValueError("ID zona sample mapping harus unik")
        return value

    @field_validator("samples")
    @classmethod
    def validate_sample_ids(cls, value):
        sample_ids = [sample.id for sample in value]
        if len(sample_ids) != len(set(sample_ids)):
            raise ValueError("ID sample harus unik")
        filenames = [sample.filename.casefold() for sample in value]
        if len(filenames) != len(set(filenames)):
            raise ValueError("Nama file sample harus unik")
        return value

    @field_validator("impulse_responses")
    @classmethod
    def validate_impulse_response_ids(cls, value):
        ids = [impulse.id for impulse in value]
        modules = [impulse.module_id for impulse in value]
        if len(ids) != len(set(ids)):
            raise ValueError("ID impulse response harus unik")
        if len(modules) != len(set(modules)):
            raise ValueError("Satu modul kabinet hanya dapat memakai satu impulse response")
        return value

    @model_validator(mode="after")
    def validate_sample_mapping_references(self):
        wave_generators = [module for module in self.engine_modules if module.type.replace("-", "_") == "wave_generator"]
        tuning_modules = [module for module in self.engine_modules if module.type.replace("-", "_") == "tuning"]
        if len(wave_generators) > 1:
            raise ValueError("Project hanya dapat memakai satu Wave Generator")
        if self.plugin_kind == "effect" and wave_generators:
            raise ValueError("Wave Generator hanya tersedia untuk project instrument")
        tuning_targets = [module.sampler_group_id or "__master__" for module in tuning_modules]
        if len(tuning_targets) != len(set(tuning_targets)):
            raise ValueError("Setiap target hanya dapat memakai satu modul Tuning & Fine Tune")
        if self.plugin_kind == "effect" and tuning_modules:
            raise ValueError("Tuning & Fine Tune hanya tersedia untuk project instrument")
        if self.plugin_kind == "effect":
            if self.instrument_type != "Audio Effect":
                raise ValueError("Project effect harus menggunakan tipe Audio Effect")
            if self.samples or self.sample_mappings:
                raise ValueError("Project effect tidak menggunakan sample atau sample mapping")
        elif self.instrument_type == "Audio Effect":
            raise ValueError("Tipe Audio Effect hanya dapat digunakan oleh project effect")
        if self.project_template in {"basicfx", "ampsimulator", "obsidianhighgain", "regentstrip", "regentwhite", "mixforge", "vintageeq", "velofet", "azureeq", "prismeq", "modernreverb", "moderndelay", "modernsaturation"} and self.plugin_kind != "effect":
            raise ValueError("Template effect hanya dapat digunakan sebagai audio effect")
        sample_ids = {sample.id for sample in self.samples}
        if any(mapping.sample_id not in sample_ids for mapping in self.sample_mappings):
            raise ValueError("Setiap zona harus merujuk ke sample yang ada di project")
        module_ids = {module.id for module in self.engine_modules}
        if any(control.module_id and control.module_id not in module_ids for control in self.interface_controls):
            raise ValueError("Binding kontrol harus merujuk ke modul engine yang ada")
        cabinet_module_ids = {module.id for module in self.engine_modules if module.type.replace("-", "_") == "cabinet_ir"}
        if any(impulse.module_id not in cabinet_module_ids for impulse in self.impulse_responses):
            raise ValueError("Impulse response harus merujuk ke modul cabinet_ir yang ada")
        if self.impulse_responses and self.plugin_kind != "effect":
            raise ValueError("Impulse response kabinet hanya tersedia untuk project effect")
        return self


VST_MAKER_TEMPLATE_PROJECT_FIELDS = frozenset(VstMakerProjectInput.model_fields)
VST_MAKER_AMP_TEMPLATE_IDS = {"ampsimulator", "obsidianhighgain"}
VST_MAKER_BUILT_IN_TEMPLATE_NAMES = {
    "basicvst": "VST Basic", "basicfx": "Plugin Basic", "ampsimulator": "Original Cream Amp",
    "obsidianhighgain": "Obsidian High Gain", "regentstrip": "Regent Console Strip",
    "regentwhite": "Regent Console Strip White", "mixforge": "MixForge Vintage Rack",
    "vintageeq": "Vintage EQ", "velofet": "Velo FET Limiter", "azureeq": "Azure Tube EQ",
    "prismeq": "Prism Spectrum EQ", "modernreverb": "Nebula Modern Reverb",
    "moderndelay": "Vector Modern Delay", "modernsaturation": "Ember Modern Saturation",
    "premiumkeys": "Aurum Concert", "analogsynth": "Nocturne Analog",
    "hybriddrums": "Impact Hybrid Drums", "cinematicstrings": "Majestica Strings",
    "electricbass": "Substance Bass", "neonpopdrums": "Neon Pop Rock Drums",
    "drumpad": "Pulse Drum Pad", "performancegrid": "Pulse Performance Grid",
    "synth": "Arctic Macro Synth", "sampler": "Studio Sampler",
}
VST_MAKER_BUILT_IN_TEMPLATE_IDS = frozenset(VST_MAKER_BUILT_IN_TEMPLATE_NAMES)


class VstMakerTemplateOrderInput(BaseModel):
    template_ids: list[str] = Field(min_length=1, max_length=200)

    @field_validator("template_ids")
    @classmethod
    def validate_template_ids(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value or len(value) > 100 for value in normalized) or len(set(normalized)) != len(normalized):
            raise ValueError("Urutan template berisi ID kosong, terlalu panjang, atau duplikat")
        return normalized


class VstMakerBuildSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_license_enabled: bool = True
    show_no_serial_option: bool = False
    license_max_activations: int = Field(default=2, ge=1, le=3)


DEFAULT_VST_MAKER_BUILD_SETTINGS = {
    "customer_license_enabled": True,
    "show_no_serial_option": False,
    "license_max_activations": 2,
}


def _normalize_vst_maker_build_settings(stored: dict | None = None) -> dict:
    stored = stored or {}
    try:
        max_activations = int(stored.get("license_max_activations", 2))
    except (TypeError, ValueError):
        max_activations = 2
    return {
        # Licensed customer builds are mandatory in the business-plan model.
        # Keep both keys in the response for older clients, but do not allow
        # legacy callers or stored documents to restore the removed choices.
        "customer_license_enabled": True,
        "show_no_serial_option": False,
        "license_max_activations": max(1, min(3, max_activations)),
    }


async def _load_vst_maker_build_settings() -> dict:
    collection = getattr(db, "vst_maker_build_settings", None)
    if collection is None:
        return dict(DEFAULT_VST_MAKER_BUILD_SETTINGS)
    stored = await collection.find_one({"id": "default"}, {"_id": 0})
    return _normalize_vst_maker_build_settings(stored)


def _customer_license_choice(project: dict, settings: dict, business_access: dict | None = None) -> int:
    plan_id = str((business_access or {}).get("plan_id") or "")
    if plan_id in {"personal", "creator_personal"}:
        return 1
    if plan_id in {"creator", "studio", "partner"}:
        # The admin setting is authoritative. Customers no longer choose a
        # lower device count in the final-build dialog or per project.
        return max(1, min(3, int(settings.get("license_max_activations") or 2)))
    if not settings.get("customer_license_enabled"):
        return 0
    try:
        raw_requested = project.get("license_max_activations")
        requested = int(1 if raw_requested is None else raw_requested)
    except (TypeError, ValueError):
        requested = 1
    if requested <= 0 and settings.get("show_no_serial_option", True) is not False:
        return 0
    if requested <= 0:
        return 1
    return max(1, min(int(settings["license_max_activations"]), requested))


async def _customer_business_build_access(
    customer_id: str, project_id: str, target_platform: str
) -> dict:
    partner_active = bool(await db.vst_partner_terms.find_one(
        {"customer_id": customer_id, "version": PARTNER_TERMS_VERSION, "accepted": True},
        {"_id": 1},
    ))
    access = await resolve_business_build_access(
        db,
        customer_id,
        project_id,
        target_platform,
        partner_terms_accepted=partner_active,
    )
    if not access.get("can_build"):
        raise HTTPException(
            402,
            "Export memerlukan paket Personal, Creator, Creator Commercial, atau Studio Commercial. Alternatif tanpa biaya awal: aktifkan Partner Marketplace.",
        )
    return access


async def _bind_paid_business_entitlement(
    access: dict, customer_id: str, project_id: str, target_platform: str, job_id: str
) -> dict:
    if access.get("source") != "paid_plan":
        return access
    project_limit = max(1, int(access.get("project_limit") or 1))
    canonical_project_ids = {
        "$setUnion": [
            {"$ifNull": ["$bound_project_ids", []]},
            {"$cond": [
                {"$ne": [{"$ifNull": ["$bound_project_id", ""]}, ""]},
                ["$bound_project_id"],
                [],
            ]},
        ],
    }
    bound = await db.vst_business_entitlements.find_one_and_update(
        {
            "id": access.get("id"),
            "customer_id": customer_id,
            "status": "active",
            "$expr": {"$or": [
                {"$in": [project_id, canonical_project_ids]},
                {"$lt": [{"$size": canonical_project_ids}, project_limit]},
            ]},
        },
        [{"$set": {
            "bound_project_ids": {"$setUnion": [canonical_project_ids, [project_id]]},
            "bound_project_id": {"$cond": [
                {"$eq": [{"$ifNull": ["$bound_project_id", ""]}, ""]},
                project_id,
                "$bound_project_id",
            ]},
            "bound_build_job_id": {"$cond": [
                {"$eq": [{"$ifNull": ["$bound_build_job_id", ""]}, ""]},
                job_id,
                "$bound_build_job_id",
            ]},
            "used_platforms": {"$setUnion": [
                {"$ifNull": ["$used_platforms", []]},
                [target_platform],
            ]},
            "project_limit": project_limit,
            "updated_at": now_iso(),
        }}],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not bound:
        raise HTTPException(409, f"Semua {project_limit} slot plugin paket ini sudah terpakai")
    return {**access, **bound}


def _customer_build_plan_quote(
    project: dict, settings: dict, business_access: dict | None = None
) -> tuple[dict, int]:
    activations = _customer_license_choice(project, settings, business_access)
    return {
        "license_enabled": bool(activations),
        "license_max_activations": activations,
    }, activations


def _without_runtime_license(spec: dict) -> dict:
    normalized = json.loads(json.dumps(spec or {}))
    normalized.pop("license", None)
    normalized.pop("engine_modules", None)  # dsp_graph is the canonical module representation.
    normalized.pop("compatibility", None)  # Derived warnings must not inflate the edit score.
    for collection_name in ("samples", "impulse_responses"):
        for item in normalized.get(collection_name) or []:
            item.pop("assetId", None)
    for items in (
        (normalized.get("interface") or {}).get("controls") or [],
        (normalized.get("dsp_graph") or {}).get("modules") or [],
        normalized.get("sampler_map") or [],
        normalized.get("sampler_groups") or [],
        normalized.get("presets") or [],
    ):
        items.sort(key=lambda item: str(item.get("id") or ""))
    return normalized


def _count_changed_values(left, right) -> int:
    if isinstance(left, dict) and isinstance(right, dict):
        keys = set(left) | set(right)
        return sum(_count_changed_values(left.get(key), right.get(key)) for key in keys)
    if isinstance(left, list) and isinstance(right, list):
        return sum(
            _count_changed_values(left[index] if index < len(left) else None, right[index] if index < len(right) else None)
            for index in range(max(len(left), len(right)))
        )
    return int(left != right)


def _items_by_id(items: list[dict]) -> dict[str, dict]:
    return {str(item.get("id") or ""): item for item in items if str(item.get("id") or "")}


def _changed_entity_count(previous_spec: dict, current_spec: dict) -> tuple[int, int]:
    pairs = (
        ((previous_spec.get("interface") or {}).get("controls") or [], (current_spec.get("interface") or {}).get("controls") or []),
        (((previous_spec.get("dsp_graph") or {}).get("modules") or []), ((current_spec.get("dsp_graph") or {}).get("modules") or [])),
        (previous_spec.get("sampler_map") or [], current_spec.get("sampler_map") or []),
    )
    changed = 0
    total = 0
    for previous_items, current_items in pairs:
        previous_by_id = _items_by_id(previous_items)
        current_by_id = _items_by_id(current_items)
        item_ids = set(previous_by_id) | set(current_by_id)
        total += len(item_ids)
        changed += sum(previous_by_id.get(item_id) != current_by_id.get(item_id) for item_id in item_ids)
    return changed, total


def _correction_change_summary(previous_spec: dict, current_spec: dict) -> list[dict]:
    sections = (
        ("interface", "Tampilan dan komponen"),
        ("dsp_graph", "Pengaturan DSP"),
        ("sampler_map", "Mapping dan playback sample"),
        ("instrument", "Pengaturan instrumen"),
        ("branding", "Branding"),
        ("presets", "Preset"),
        ("build", "Versi plugin"),
    )
    changes = []
    for key, label in sections:
        count = _count_changed_values(previous_spec.get(key), current_spec.get(key))
        if count:
            changes.append({"section": key, "label": label, "count": count})
    other_keys = (set(previous_spec) | set(current_spec)) - {key for key, _label in sections} - {
        "license", "compatibility", "visual_contract", "samples", "impulse_responses",
        "engine_modules", "sample_packaging", "project_id", "schema_version", "name",
        "plugin_kind", "project_template", "dsp_profile",
    }
    other_count = sum(_count_changed_values(previous_spec.get(key), current_spec.get(key)) for key in other_keys)
    if other_count:
        changes.append({"section": "other", "label": "Pengaturan project", "count": other_count})
    return changes


def _correction_additions(previous_spec: dict, current_spec: dict) -> dict:
    previous_samples = _items_by_id(previous_spec.get("samples") or [])
    current_samples = _items_by_id(current_spec.get("samples") or [])
    previous_controls = _items_by_id((previous_spec.get("interface") or {}).get("controls") or [])
    current_controls = _items_by_id((current_spec.get("interface") or {}).get("controls") or [])
    has_spectrum_analyzer = any(
        str(control.get("kind") or "") == "spectrum"
        and str(control.get("component_variant") or "realtime-spectrum") == "realtime-spectrum"
        for control in current_controls.values()
    )
    def is_internal_spectrum_band(control: dict) -> bool:
        if not has_spectrum_analyzer or str(control.get("kind") or "") != "knob":
            return False
        if str(control.get("parameter") or "") in {"prism_frequency", "prism_gain", "prism_q"}:
            return True
        if str(control.get("parameter") or "") not in {"tone", "drive", "compress", "width", "space"}:
            return False
        try:
            return math.isfinite(float(control.get("frequency"))) and math.isfinite(float(control.get("q")))
        except (TypeError, ValueError):
            return False
    return {
        "sample_ids": sorted(set(current_samples) - set(previous_samples)),
        "component_ids": sorted(
            control_id for control_id in set(current_controls) - set(previous_controls)
            if not is_internal_spectrum_band(current_controls[control_id])
        ),
        "skin_change_ids": sorted(
            control_id for control_id in set(previous_controls) & set(current_controls)
            if str(previous_controls[control_id].get("kind") or "") == str(current_controls[control_id].get("kind") or "")
            and str(previous_controls[control_id].get("component_variant") or "classic")
            != str(current_controls[control_id].get("component_variant") or "classic")
        ),
    }


def _spec_without_allowed_additions(current_spec: dict, additions: dict) -> dict:
    scored = json.loads(json.dumps(current_spec))
    added_samples = set(additions["sample_ids"])
    added_components = set(additions["component_ids"])
    scored["samples"] = [item for item in scored.get("samples") or [] if str(item.get("id") or "") not in added_samples]
    scored["sampler_map"] = [
        item for item in scored.get("sampler_map") or []
        if str(item.get("sampleId") or "") not in added_samples
    ]
    interface = scored.get("interface") or {}
    interface["controls"] = [
        item for item in interface.get("controls") or []
        if str(item.get("id") or "") not in added_components
    ]
    return scored


def _structural_rebuild_reasons(previous_spec: dict, current_spec: dict, previous_activations: int, current_activations: int) -> list[str]:
    reasons = []
    for key, message in (
        ("plugin_kind", "Jenis plugin berubah"),
        ("project_template", "Template utama berubah"),
        ("name", "Nama produk berubah"),
    ):
        if previous_spec.get(key) != current_spec.get(key):
            reasons.append(message)
    if (previous_spec.get("build") or {}).get("company_name") != (current_spec.get("build") or {}).get("company_name"):
        reasons.append("Identitas developer berubah")
    previous_interface = previous_spec.get("interface") or {}
    current_interface = current_spec.get("interface") or {}
    if previous_interface.get("template") != current_interface.get("template"):
        reasons.append("Template tampilan berubah")
    if (previous_interface.get("background") or {}).get("url") != (current_interface.get("background") or {}).get("url"):
        reasons.append("Aset background berubah")
    if previous_spec.get("effects") != current_spec.get("effects"):
        reasons.append("Susunan efek internal berubah")

    def resource_signature(spec: dict, key: str, module_key: str = ""):
        return sorted(
            (
                str(item.get("id") or ""),
                str(item.get(module_key) or "") if module_key else "",
                str(item.get("sha256") or ""),
            )
            for item in spec.get(key) or []
        )

    additions = _correction_additions(previous_spec, current_spec)
    previous_samples = _items_by_id(previous_spec.get("samples") or [])
    current_samples = _items_by_id(current_spec.get("samples") or [])
    if set(previous_samples) - set(current_samples):
        reasons.append("Sample lama dihapus")
    if any(
        str(previous_samples[sample_id].get("sha256") or "") != str(current_samples[sample_id].get("sha256") or "")
        for sample_id in set(previous_samples) & set(current_samples)
    ):
        reasons.append("File sample lama diganti")
    if len(additions["sample_ids"]) > CORRECTION_REBUILD_MAX_ADDED_SAMPLES:
        reasons.append(
            f"Penambahan sample melebihi batas {CORRECTION_REBUILD_MAX_ADDED_SAMPLES} file"
        )
    if resource_signature(previous_spec, "impulse_responses", "moduleId") != resource_signature(current_spec, "impulse_responses", "moduleId"):
        reasons.append("File impulse response berubah")

    def module_signature(spec: dict):
        return sorted(
            (str(item.get("id") or ""), str(item.get("type") or ""))
            for item in (spec.get("dsp_graph") or {}).get("modules") or []
        )

    if module_signature(previous_spec) != module_signature(current_spec):
        reasons.append("Struktur atau jenis modul DSP berubah")

    previous_controls = _items_by_id(previous_interface.get("controls") or [])
    current_controls = _items_by_id(current_interface.get("controls") or [])
    if set(previous_controls) - set(current_controls):
        reasons.append("Komponen lama dihapus")
    for control_id in set(previous_controls) & set(current_controls):
        previous_control = previous_controls[control_id]
        current_control = current_controls[control_id]
        if str(previous_control.get("kind") or "") != str(current_control.get("kind") or ""):
            reasons.append("Jenis komponen lama berubah")
            break
    if len(additions["component_ids"]) > CORRECTION_REBUILD_MAX_ADDED_COMPONENTS:
        reasons.append(
            f"Penambahan komponen melebihi batas {CORRECTION_REBUILD_MAX_ADDED_COMPONENTS} item"
        )
    if len(additions["skin_change_ids"]) > CORRECTION_REBUILD_MAX_SKIN_CHANGES:
        reasons.append(
            f"Pergantian skin melebihi batas {CORRECTION_REBUILD_MAX_SKIN_CHANGES} komponen"
        )
    if any(
        str(previous_controls[control_id].get("image_url") or "") != str(current_controls[control_id].get("image_url") or "")
        for control_id in set(previous_controls) & set(current_controls)
        if previous_controls[control_id].get("kind") == "image"
    ):
        reasons.append("Aset gambar komponen lama berubah")
    if previous_activations != current_activations:
        reasons.append("Pilihan serial atau kapasitas perangkat berubah")
    return reasons


def _parse_iso_datetime(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _customer_correction_rebuild_offer(
    project: dict, spec: dict, effective_activations: int,
    force_rebuild: bool = False, target_platform: str = "windows",
    window_days: int = 0,
) -> dict:
    correction_days = max(0, int(window_days or 0))
    offer = {
        "mode": "new_build",
        "eligible": False,
        "included": True,
        "window_days": correction_days,
        "limit": CORRECTION_REBUILD_LIMIT,
        "remaining": 0,
        "changes": [],
        "reasons": [],
    }
    previous = await db.vst_maker_build_jobs.find_one(
        {
            "project_id": project.get("id"),
            "owner_customer_id": project.get("owner_customer_id"),
            "status": "ready",
            "target_platform": target_platform,
            "spec_snapshot": {"$type": "object"},
        },
        {"_id": 0},
        sort=[("completed_at", -1), ("created_at", -1)],
    )
    if not previous:
        offer["reasons"] = ["Belum ada build berhasil yang dapat dijadikan dasar koreksi"]
        return offer
    offer["base_build_id"] = previous.get("correction_root_build_id") or previous.get("id")
    offer["previous_business_entitlement_id"] = previous.get("business_entitlement_id")
    completed_at = _parse_iso_datetime(previous.get("correction_window_started_at") or previous.get("completed_at"))
    expires_at = _parse_iso_datetime(previous.get("correction_window_expires_at"))
    if not expires_at and completed_at:
        expires_at = completed_at + timedelta(days=correction_days)
    if expires_at:
        offer["expires_at"] = expires_at.isoformat()
    used = max(0, int(previous.get("correction_rebuild_number") or 0))
    offer["remaining"] = max(0, CORRECTION_REBUILD_LIMIT - used)
    if not expires_at or datetime.now(timezone.utc) > expires_at:
        offer["reasons"] = [f"Masa Rebuild Koreksi {correction_days} hari telah berakhir"]
        return offer
    if used >= CORRECTION_REBUILD_LIMIT:
        offer["reasons"] = ["Dua kesempatan Rebuild Koreksi sudah digunakan"]
        return offer
    previous_spec = _without_runtime_license(previous.get("spec_snapshot") or {})
    current_spec = _without_runtime_license(spec)
    specs_identical = (
        previous_spec == current_spec
        and int(previous.get("license_max_activations") or 0) == effective_activations
    )
    if specs_identical and previous.get("artifact_storage_key") and not force_rebuild:
        artifact_expires_at = _parse_iso_datetime(previous.get("artifact_expires_at"))
        if not artifact_expires_at or datetime.now(timezone.utc) < artifact_expires_at:
            offer.update({
                "mode": "download_existing",
                "previous_build_id": previous.get("id"),
                "reasons": ["Project sama persis dengan build terakhir; gunakan file yang sudah tersedia"],
            })
            return offer
    reasons = _structural_rebuild_reasons(
        previous_spec, current_spec,
        int(previous.get("license_max_activations") or 0), effective_activations,
    )
    if effective_activations and (
        not previous.get("license_key") or not previous.get("license_product_id")
    ):
        reasons.append("Lisensi build sebelumnya tidak dapat digunakan kembali")
    additions = _correction_additions(previous_spec, current_spec)
    scored_current_spec = _spec_without_allowed_additions(current_spec, additions)
    changed_properties = _count_changed_values(previous_spec, scored_current_spec)
    changed_entities, total_entities = _changed_entity_count(previous_spec, scored_current_spec)
    maximum_changed_entities = max(3, math.ceil(max(1, total_entities) * 0.25))
    if changed_properties > CORRECTION_REBUILD_MAX_CHANGED_PROPERTIES:
        reasons.append(f"Perubahan terlalu luas ({changed_properties} properti; maksimal {CORRECTION_REBUILD_MAX_CHANGED_PROPERTIES})")
    if changed_entities > maximum_changed_entities:
        reasons.append(f"Terlalu banyak bagian project berubah ({changed_entities}; maksimal {maximum_changed_entities})")
    changes = _correction_change_summary(previous_spec, scored_current_spec)
    if force_rebuild and specs_identical:
        changes.append({"section": "manual_rebuild", "label": "Build ulang manual", "count": 1})
    if additions["component_ids"]:
        changes.append({"section": "added_components", "label": "Komponen baru", "count": len(additions["component_ids"])})
    if additions["sample_ids"]:
        changes.append({"section": "added_samples", "label": "Sample baru", "count": len(additions["sample_ids"])})
    if additions["skin_change_ids"]:
        changes.append({"section": "changed_skins", "label": "Skin komponen diganti", "count": len(additions["skin_change_ids"])})
    offer.update({
        "changed_properties": changed_properties,
        "changed_entities": changed_entities,
        "maximum_changed_entities": maximum_changed_entities,
        "added_components": len(additions["component_ids"]),
        "added_samples": len(additions["sample_ids"]),
        "changed_skins": len(additions["skin_change_ids"]),
        "changes": changes,
        "reasons": list(dict.fromkeys(reasons)),
    })
    if reasons:
        return offer
    offer.update({
        "mode": "correction_rebuild",
        "eligible": True,
        "remaining_after_build": max(0, CORRECTION_REBUILD_LIMIT - used - 1),
        "previous_build_id": previous.get("id"),
        "previous_license_key": previous.get("license_key"),
        "previous_license_product_id": previous.get("license_product_id"),
        "previous_license_max_activations": int(previous.get("license_max_activations") or 0),
        "correction_rebuild_number": used + 1,
    })
    return offer


class VstMakerPresenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: str = Field(default="", max_length=100)
    project_name: str = Field(default="", max_length=120)
    editor_tab: str = Field(default="interface", max_length=32)

    @field_validator("project_id", "project_name", "editor_tab", mode="before")
    @classmethod
    def strip_presence_text(cls, value):
        return str(value or "").strip()


class CustomerVstBuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    force_correction_rebuild: bool = False
    target_platform: Literal["windows", "macos"] = "windows"

def _vst_maker_template_snapshot(project: dict) -> dict:
    """Create a reusable project preset without private storage/build state."""
    payload = {
        key: value for key, value in project.items()
        if key in VST_MAKER_TEMPLATE_PROJECT_FIELDS
    }
    return VstMakerProjectInput(**payload).model_dump()


def _vst_maker_template_document(
    project: dict,
    existing: dict | None = None,
    template_id: str | None = None,
) -> dict:
    snapshot = _vst_maker_template_snapshot(project)
    is_effect = snapshot["plugin_kind"] == "effect"
    is_amp = snapshot["project_template"] in VST_MAKER_AMP_TEMPLATE_IDS
    timestamp = now_iso()
    source_project_id = (existing or {}).get("source_project_id") or project.get("id")
    if not source_project_id and template_id in VST_MAKER_BUILT_IN_TEMPLATE_IDS:
        source_project_id = f"built-in-template:{template_id}"
    return {
        "id": template_id or (existing.get("id") if existing else f"admin-{uuid.uuid4()}"),
        "source_project_id": source_project_id,
        "built_in_template": (template_id or (existing or {}).get("id")) in VST_MAKER_BUILT_IN_TEMPLATE_IDS,
        "name": snapshot["name"],
        "description": f"Template admin siap pakai dari project {snapshot['name']}.",
        "template_category": "amp" if is_amp else "plugin" if is_effect else "vst",
        "plugin_kind": snapshot["plugin_kind"],
        "instrument_type": snapshot["instrument_type"],
        "symbol": "AMP" if is_amp else "FX" if is_effect else "VST",
        "accent_color": snapshot["accent_color"],
        "background_url": snapshot.get("background_image_url"),
        "thumbnail_url": existing.get("thumbnail_url") if existing else snapshot.get("background_image_url"),
        "thumbnail_name": existing.get("thumbnail_name") if existing else snapshot.get("background_image_name"),
        "thumbnail_public_id": existing.get("thumbnail_public_id") if existing else None,
        "brand_tagline": snapshot.get("brand_tagline") or "ADMIN TEMPLATE",
        "highlights": ["Template admin", "Designer siap pakai", "DSP tersimpan"],
        "project": snapshot,
        "created_at": existing.get("created_at", timestamp) if existing else timestamp,
        "updated_at": timestamp,
    }


def _public_sample_asset(asset: dict) -> dict:
    return {
        "id": asset.get("id"),
        "sample_id": asset.get("sample_id"),
        "filename": asset.get("filename"),
        "size_bytes": asset.get("size_bytes"),
        "sha256": asset.get("sha256"),
        "uploaded_at": asset.get("uploaded_at"),
    }


def _public_impulse_asset(asset: dict) -> dict:
    return {
        "id": asset.get("id"),
        "impulse_id": asset.get("sample_id"),
        "filename": asset.get("filename"),
        "size_bytes": asset.get("size_bytes"),
        "sha256": asset.get("sha256"),
        "uploaded_at": asset.get("uploaded_at"),
    }


def _matching_sample_assets(project: dict, sample_assets: list[dict] | None) -> dict[str, dict]:
    samples = {sample.get("id"): sample for sample in project.get("samples") or []}
    matching = {}
    for asset in sample_assets or []:
        if asset.get("asset_kind") == "impulse_response":
            continue
        sample = samples.get(asset.get("sample_id"))
        if not sample:
            continue
        if (
            asset.get("filename") == sample.get("filename")
            and int(asset.get("size_bytes") or 0) == int(sample.get("size_bytes") or 0)
            and bool(asset.get("sha256"))
        ):
            matching[asset.get("sample_id")] = asset
    return matching


def _matching_impulse_assets(project: dict, sample_assets: list[dict] | None) -> dict[str, dict]:
    impulses = {impulse.get("id"): impulse for impulse in project.get("impulse_responses") or []}
    matching = {}
    for asset in sample_assets or []:
        if asset.get("asset_kind") != "impulse_response":
            continue
        impulse = impulses.get(asset.get("sample_id"))
        if not impulse:
            continue
        if (
            asset.get("filename") == impulse.get("filename")
            and int(asset.get("size_bytes") or 0) == int(impulse.get("size_bytes") or 0)
            and bool(asset.get("sha256"))
        ):
            matching[asset.get("sample_id")] = asset
    return matching


def _public_build_job(job: dict) -> dict:
    return {
        key: job.get(key)
        for key in (
            "id", "project_id", "project_name", "owner_customer_id", "status",
            "target_platform", "format", "attempts", "status_message", "last_error", "progress",
            "spec_sha256", "build_pipeline_revision",
            "business_entitlement_id", "business_plan_id", "business_plan_name", "business_access_source",
            "business_build_limit", "business_build_number", "business_quota_reserved",
            "artifact_filename", "artifact_size_bytes", "artifact_sha256",
            "validator_name", "validator_passed", "created_at", "updated_at",
            "started_at", "completed_at", "canceled_at", "artifact_expires_at",
            "license_key", "license_product_id", "license_max_activations",
            "correction_rebuild", "correction_root_build_id", "correction_previous_build_id",
            "correction_rebuild_number", "correction_rebuild_limit", "correction_rebuilds_remaining",
            "correction_window_days", "correction_window_started_at", "correction_window_expires_at",
            "correction_changes", "correction_changed_properties",
        )
    }


async def _prepare_customer_build_license(
    customer_id: str, job_id: str, project: dict, timestamp: str,
    max_activations: int = 2, target_platform: str = "windows",
) -> tuple[dict, dict]:
    customer = await db.customers.find_one(
        {"id": customer_id}, {"_id": 0, "email": 1, "name": 1, "first_name": 1, "last_name": 1}
    ) or {}
    customer_name = str(customer.get("name") or " ".join(filter(None, [customer.get("first_name"), customer.get("last_name")]))).strip()
    product_id = f"vst-maker-build:{job_id}"
    license_key = generate_license_key("TSVST")
    license_doc = {
        "id": str(uuid.uuid4()),
        "license_key": license_key,
        "product_id": product_id,
        "product_name": str(project.get("name") or "TripleSide VST").strip(),
        "customer_id": customer_id,
        "customer_name": customer_name,
        "customer_email": str(customer.get("email") or "").strip().lower(),
        "transaction_id": "",
        "platform": target_platform,
        "license_type": "vst_maker_personal",
        "source": "vst_maker_build",
        "build_job_id": job_id,
        "project_id": project.get("id"),
        "hardware_id": "",
        "machine_name": "",
        "activated_at": None,
        "activations": [],
        "max_activations": max(1, min(3, int(max_activations))),
        "status": "pending_build",
        "created_at": timestamp,
        "updated_at": timestamp,
    }
    runtime_spec = {
        "required": True,
        "product_id": product_id,
        "activation_url": f"{str(APP_PUBLIC_URL).rstrip('/')}/api/license/activate",
        "verify_url": f"{str(APP_PUBLIC_URL).rstrip('/')}/api/license/verify",
        "offline_mode": "permanent_with_online_refresh",
        "build_id": job_id,
    }
    return license_doc, runtime_spec


async def _enqueue_vst_build(
    project: dict,
    sample_assets: list[dict],
    requested_by: str,
    business_access: dict | None = None,
    billing_tier: str = "",
    force_correction_rebuild: bool = False,
    target_platform: Literal["windows", "macos"] = "windows",
) -> tuple[dict, bool]:
    spec = _ready_build_spec(project, sample_assets, require_uploaded=True)
    uses_sampler_routing = any(
        str(group.get("output_bus") or "master") == "separate"
        for group in spec.get("sampler_groups") or []
    ) or any(
        bool(module.get("samplerGroupId") or module.get("sampler_group_id"))
        for module in (spec.get("dsp_graph") or {}).get("modules") or []
    ) or any(
        control.get("kind") == "output_selector"
        for control in (spec.get("interface") or {}).get("controls") or []
    ) or any(
        bool(control.get("sampler_group_id")) and control.get("kind") != "output_selector"
        for control in (spec.get("interface") or {}).get("controls") or []
    ) or any(
        control.get("kind") == "panel_button"
        and control.get("panel_type") == "mixer"
        and control.get("mixer_show_default_controls") is False
        for control in (spec.get("interface") or {}).get("controls") or []
    )
    if target_platform == "macos" and uses_sampler_routing and not VST_MACOS_SAMPLER_ROUTING_ENABLED:
        raise HTTPException(
            503,
            "Build macOS untuk routing atau kontrol Mixer per sampler sementara ditunda sampai worker macOS tersinkron.",
        )
    spec["build"]["platforms"] = [target_platform]
    encoded_spec = json.dumps(spec, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    spec_sha256 = hashlib.sha256(encoded_spec).hexdigest()
    owner_customer_id = project.get("owner_customer_id")
    is_customer_build = bool(owner_customer_id and business_access)
    build_settings = await _load_vst_maker_build_settings() if is_customer_build else dict(DEFAULT_VST_MAKER_BUILD_SETTINGS)
    effective_license_activations = _customer_license_choice(project, build_settings, business_access) if is_customer_build else 0
    active_spec_key = hashlib.sha256(
        f"{owner_customer_id or 'admin'}\0{project['id']}\0{target_platform}\0{spec_sha256}"
        f"\0pipeline:{VST_BUILD_PIPELINE_REVISION}\0license:{effective_license_activations}".encode("utf-8")
    ).hexdigest()
    duplicate = await db.vst_maker_build_jobs.find_one({
        "active_spec_key": active_spec_key,
    }, {"_id": 0})
    if not duplicate:
        duplicate = await db.vst_maker_build_jobs.find_one({
            "project_id": project["id"],
            "owner_customer_id": owner_customer_id,
            "spec_sha256": spec_sha256,
            "target_platform": target_platform,
            "license_max_activations": effective_license_activations or {"$in": [None, 0]},
            "status": {"$in": sorted(ACTIVE_BUILD_STATUSES)},
            "active_spec_key": {"$exists": False},
        }, {"_id": 0})
    if duplicate:
        return duplicate, True
    completed_duplicate = await db.vst_maker_build_jobs.find_one({
        "project_id": project["id"],
        "owner_customer_id": owner_customer_id,
        "spec_sha256": spec_sha256,
        "build_pipeline_revision": VST_BUILD_PIPELINE_REVISION,
        "target_platform": target_platform,
        "license_max_activations": effective_license_activations or {"$in": [None, 0]},
        "status": "ready",
        "artifact_storage_key": {"$type": "string"},
        "$or": [
            {"artifact_expires_at": {"$gt": now_iso()}},
            {"artifact_expires_at": None},
            {"artifact_expires_at": {"$exists": False}},
        ],
    }, {"_id": 0})
    if completed_duplicate:
        return completed_duplicate, True

    timestamp = now_iso()
    matching_assets = _matching_sample_assets(project, sample_assets)
    matching_impulses = _matching_impulse_assets(project, sample_assets)
    job_id = str(uuid.uuid4())
    license_doc = None
    project = await _with_template_pricing_baseline(project)
    if is_customer_build and effective_license_activations:
        license_doc, license_runtime = await _prepare_customer_build_license(
            str(owner_customer_id), job_id, project, timestamp,
            max_activations=effective_license_activations,
            target_platform=target_platform,
        )
        spec["license"] = license_runtime

    quota_reserved = False
    if is_customer_build:
        business_access = await _bind_paid_business_entitlement(
            business_access,
            str(owner_customer_id),
            str(project["id"]),
            target_platform,
            job_id,
        )
        if business_access.get("source") == "paid_plan":
            reserved = await reserve_business_build_quota(db, business_access)
            if not reserved:
                limit = int(business_access.get("build_limit") or 0)
                raise HTTPException(409, f"Kuota {limit} build paket ini sudah habis")
            business_access = {**business_access, **reserved}
            quota_reserved = True
    job = {
        "id": job_id,
        "project_id": project["id"],
        "project_name": project.get("name"),
        "owner_customer_id": owner_customer_id,
        "requested_by": requested_by,
        "status": "queued",
        "target_platform": target_platform,
        "format": "VST3",
        "attempts": 0,
        "status_message": f"Menunggu worker build {'macOS' if target_platform == 'macos' else 'Windows'}",
        "last_error": "",
        "spec_sha256": spec_sha256,
        "build_pipeline_revision": VST_BUILD_PIPELINE_REVISION,
        "spec_dedupe_key": active_spec_key,
        "active_spec_key": active_spec_key,
        "spec_snapshot": spec,
        "sample_asset_ids": [matching_assets[sample["id"]]["id"] for sample in project.get("samples") or []]
        + [matching_impulses[impulse["id"]]["id"] for impulse in project.get("impulse_responses") or []],
        "artifact_filename": None,
        "artifact_size_bytes": None,
        "artifact_sha256": None,
        "artifact_storage_key": None,
        "validator_name": None,
        "validator_passed": None,
        "created_at": timestamp,
        "updated_at": timestamp,
        "started_at": None,
        "completed_at": None,
        "canceled_at": None,
        "next_attempt_at": timestamp,
        "business_entitlement_id": (business_access or {}).get("id"),
        "business_plan_id": (business_access or {}).get("plan_id"),
        "business_plan_name": (business_access or {}).get("plan_name"),
        "business_access_source": (business_access or {}).get("source"),
        "business_build_limit": (business_access or {}).get("build_limit"),
        "business_build_number": int((business_access or {}).get("builds_used") or 0) if quota_reserved else None,
        "business_quota_reserved": quota_reserved,
        "billing_tier": billing_tier,
        "artifact_retention_days": TIER_ARTIFACT_RETENTION_DAYS.get(billing_tier, 14),
        "artifact_limit": TIER_ARTIFACT_LIMIT.get(billing_tier, 2),
    }
    if license_doc:
        job.update({
            "license_key": license_doc["license_key"],
            "license_product_id": license_doc["product_id"],
            "license_max_activations": license_doc["max_activations"],
        })
    try:
        if license_doc:
            await db.licenses.insert_one(license_doc)
        await db.vst_maker_build_jobs.insert_one(job)
        return job, False
    except DuplicateKeyError:
        duplicate = await db.vst_maker_build_jobs.find_one(
            {"active_spec_key": active_spec_key}, {"_id": 0}
        )
        if duplicate:
            if license_doc:
                await db.licenses.delete_one({"id": license_doc["id"]})
            if quota_reserved:
                await release_business_build_quota(db, str((business_access or {}).get("id") or ""))
            return duplicate, True
        if license_doc:
            await db.licenses.delete_one({"id": license_doc["id"]})
        if quota_reserved:
            await release_business_build_quota(db, str((business_access or {}).get("id") or ""))
        raise
    except Exception:
        if license_doc:
            await db.licenses.delete_one({"id": license_doc["id"]})
        if quota_reserved:
            await release_business_build_quota(db, str((business_access or {}).get("id") or ""))
        raise


async def _set_build_license_status(job: dict, status: str) -> None:
    collection = getattr(db, "licenses", None)
    job_id = str(job.get("id") or job.get("build_job_id") or "")
    if collection is None or not job_id:
        return
    if status == "ready":
        license_doc = await collection.find_one(
            {"build_job_id": job_id, "source": "vst_maker_build", "status": {"$ne": "revoked"}},
            {"_id": 0, "activations": 1},
        )
        if not license_doc:
            return
        status = "active" if license_doc.get("activations") else "unactivated"
    await collection.update_one(
        {"build_job_id": job_id, "source": "vst_maker_build", "status": {"$ne": "revoked"}},
        {"$set": {"status": status, "updated_at": now_iso()}},
    )


async def _release_job_business_quota(job_id: str) -> None:
    """Idempotently return the quota held by a failed or canceled job."""
    job = await db.vst_maker_build_jobs.find_one_and_update(
        {"id": job_id, "business_quota_reserved": True},
        {"$set": {"business_quota_reserved": False, "updated_at": now_iso()}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "business_entitlement_id": 1},
    )
    if job:
        await release_business_build_quota(db, str(job.get("business_entitlement_id") or ""))


async def _reserve_retry_business_quota(job: dict) -> bool:
    entitlement_id = str(job.get("business_entitlement_id") or "")
    if not entitlement_id or job.get("business_access_source") != "paid_plan":
        return False
    entitlement = await db.vst_business_entitlements.find_one(
        {"id": entitlement_id, "status": "active"}, {"_id": 0}
    )
    if not entitlement or not await reserve_business_build_quota(db, entitlement):
        raise HTTPException(409, "Kuota build paket ini sudah habis")
    return True


async def _cancel_vst_build(query: dict) -> dict:
    timestamp = now_iso()
    job = await db.vst_maker_build_jobs.find_one_and_update(
        {**query, "status": {"$in": sorted(ACTIVE_BUILD_STATUSES)}},
        {
            "$set": {
                "status": "canceled",
                "status_message": "Build dibatalkan",
                "updated_at": timestamp,
                "completed_at": timestamp,
                "canceled_at": timestamp,
                "lease_expires_at": None,
                "lease_token_sha256": None,
            },
            "$unset": {"active_spec_key": ""},
        },
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not job:
        raise HTTPException(409, "Build tidak aktif atau tidak ditemukan")
    await _set_build_license_status(job, "build_canceled")
    await _release_job_business_quota(str(job.get("id") or ""))
    return _public_build_job(job)


async def _retry_vst_build(query: dict) -> dict:
    timestamp = now_iso()
    existing = await db.vst_maker_build_jobs.find_one(
        {**query, "status": {"$in": ["failed", "canceled"]}}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(409, "Hanya build gagal atau dibatalkan yang dapat diulang")
    quota_reserved = await _reserve_retry_business_quota(existing)
    active_spec_key = existing.get("spec_dedupe_key") or hashlib.sha256(
        f"{existing.get('owner_customer_id') or 'admin'}\0{existing.get('project_id')}\0{existing.get('spec_sha256')}".encode("utf-8")
    ).hexdigest()
    platform_label = "macOS" if existing.get("target_platform") == "macos" else "Windows"
    retry_updates = {
        "status": "queued",
        "status_message": f"Menunggu worker build {platform_label}",
        "last_error": "",
        "updated_at": timestamp,
        "completed_at": None,
        "canceled_at": None,
        "next_attempt_at": timestamp,
        "worker_id": None,
        "lease_expires_at": None,
        "lease_token_sha256": None,
        "spec_dedupe_key": active_spec_key,
        "active_spec_key": active_spec_key,
        "business_quota_reserved": quota_reserved,
    }
    try:
        job = await db.vst_maker_build_jobs.find_one_and_update(
            {**query, "status": {"$in": ["failed", "canceled"]}},
            {"$set": retry_updates},
            return_document=ReturnDocument.AFTER,
            projection={"_id": 0},
        )
    except DuplicateKeyError:
        job = None
    if not job:
        if quota_reserved:
            await release_business_build_quota(db, str(existing.get("business_entitlement_id") or ""))
        raise HTTPException(409, "Hanya build gagal atau dibatalkan yang dapat diulang")
    await _set_build_license_status(job, "pending_build")
    return _public_build_job(job)


def _lease_expiry() -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=WORKER_LEASE_SECONDS)).isoformat()


def _lease_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _build_error_summary(error: str) -> str:
    value = str(error or "")
    if len(value) <= MAX_BUILD_ERROR_CHARS:
        return value
    marker = "[... log awal dipotong ...]\n"
    return marker + value[-(MAX_BUILD_ERROR_CHARS - len(marker)):]


async def _worker_job_payload(job: dict, lease_token: str) -> dict:
    spec = job.get("spec_snapshot") or {}
    background = ((spec.get("interface") or {}).get("background") or {})
    try:
        background_url = _validated_background_url(background.get("url")) or ""
    except ValueError as error:
        raise RuntimeError("Sumber background build tidak diizinkan") from error
    asset_ids = list(job.get("sample_asset_ids") or [])
    assets = await db.vst_maker_sample_assets.find(
        {"id": {"$in": asset_ids}}, {"_id": 0}
    ).to_list(128)
    assets_by_id = {asset.get("id"): asset for asset in assets}
    if any(asset_id not in assets_by_id for asset_id in asset_ids):
        raise RuntimeError("Satu atau lebih aset sample build tidak ditemukan")

    samples = []
    for sample in spec.get("samples") or []:
        asset = assets_by_id.get(sample.get("assetId"))
        if not asset:
            raise RuntimeError(f"Aset sample tidak ditemukan: {sample.get('name') or sample.get('id')}")
        samples.append({
            "sample_id": sample.get("id"),
            "filename": asset.get("filename"),
            "size_bytes": asset.get("size_bytes"),
            "sha256": asset.get("sha256"),
            "download_url": await create_private_download_url(asset["storage_key"], 3600),
        })
    for impulse in spec.get("impulse_responses") or []:
        asset = assets_by_id.get(impulse.get("assetId"))
        if not asset:
            raise RuntimeError(f"Aset impulse response tidak ditemukan: {impulse.get('originalName') or impulse.get('id')}")
        samples.append({
            "sample_id": impulse.get("id"),
            "filename": impulse.get("name"),
            "size_bytes": asset.get("size_bytes"),
            "sha256": asset.get("sha256"),
            "download_url": await create_private_download_url(asset["storage_key"], 3600),
        })
    return {
        "job_id": job["id"],
        "lease_token": lease_token,
        "lease_expires_at": job.get("lease_expires_at"),
        "spec_sha256": job.get("spec_sha256"),
        "spec": spec,
        "samples": samples,
        "background": ({
            "download_url": background_url,
            "name": background.get("name") or "plugin-background",
        } if background_url else None),
        "target_platform": job.get("target_platform"),
        "format": job.get("format"),
    }


@worker_router.get("/pending", dependencies=[Depends(verify_vst_worker)])
async def pending_vst_build(target_platform: Literal["windows", "macos"] = "windows"):
    timestamp = now_iso()
    pending = await db.vst_maker_build_jobs.find_one({
        "target_platform": target_platform,
        "$or": [
            {"status": {"$in": ["queued", "retrying"]}, "next_attempt_at": {"$lte": timestamp}},
            {
                "status": {"$in": sorted(LEASED_BUILD_STATUSES)},
                "$or": [
                    {"lease_expires_at": {"$lte": timestamp}},
                    {"lease_expires_at": {"$exists": False}},
                ],
            },
        ],
    }, {"_id": 0, "id": 1})
    return {"pending": bool(pending)}


@worker_router.post("/claim", dependencies=[Depends(verify_vst_worker)])
async def claim_vst_build(body: WorkerClaimInput):
    timestamp = now_iso()
    current = await db.vst_maker_build_jobs.find_one({
        "worker_id": body.worker_id,
        "target_platform": body.target_platform,
        "status": {"$in": sorted(LEASED_BUILD_STATUSES)},
        "lease_expires_at": {"$gt": timestamp},
    }, {"_id": 0, "id": 1})
    if current:
        raise HTTPException(409, "Worker masih memiliki build aktif")

    lease_token = secrets.token_urlsafe(32)
    lease_expires_at = _lease_expiry()
    job = await db.vst_maker_build_jobs.find_one_and_update(
        {"target_platform": body.target_platform, "$or": [
            {
                "status": {"$in": ["queued", "retrying"]},
                "next_attempt_at": {"$lte": timestamp},
            },
            {
                "status": {"$in": sorted(LEASED_BUILD_STATUSES)},
                "$or": [
                    {"lease_expires_at": {"$lte": timestamp}},
                    {"lease_expires_at": {"$exists": False}},
                ],
            },
        ]},
        {
            "$set": {
                "status": "preparing",
                "status_message": f"Worker {'macOS' if body.target_platform == 'macos' else 'Windows'} menyiapkan build",
                "progress": 2,
                "worker_id": body.worker_id,
                "lease_token_sha256": _lease_hash(lease_token),
                "lease_expires_at": lease_expires_at,
                "updated_at": timestamp,
                "started_at": timestamp,
                "last_error": "",
            },
            "$inc": {"attempts": 1},
        },
        sort=[("created_at", 1)],
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not job:
        return Response(status_code=204)
    try:
        return await _worker_job_payload(job, lease_token)
    except Exception as error:
        logger.exception("Failed to prepare VST worker payload for job %s", job.get("id"))
        await db.vst_maker_build_jobs.update_one(
            {"id": job["id"], "lease_token_sha256": _lease_hash(lease_token)},
            {
                "$set": {
                    "status": "failed",
                    "status_message": "Aset build tidak dapat disiapkan",
                    "last_error": str(error)[:2000],
                    "updated_at": now_iso(),
                    "completed_at": now_iso(),
                    "lease_expires_at": None,
                    "lease_token_sha256": None,
                },
                "$unset": {"active_spec_key": ""},
            },
        )
        await _set_build_license_status(job, "build_failed")
        await _release_job_business_quota(str(job.get("id") or ""))
        raise HTTPException(502, "Aset build tidak dapat disiapkan") from error


@worker_router.post("/jobs/{job_id}/status", dependencies=[Depends(verify_vst_worker)])
async def update_vst_build_status(job_id: str, body: WorkerStatusInput):
    token_hash = _lease_hash(body.lease_token)
    timestamp = now_iso()
    existing = await db.vst_maker_build_jobs.find_one(
        {
            "id": job_id,
            "lease_token_sha256": token_hash,
            "lease_expires_at": {"$gt": timestamp},
        },
        {"_id": 0},
    )
    if not existing:
        raise HTTPException(409, "Lease build tidak berlaku")
    if body.status not in WORKER_STATUS_TRANSITIONS.get(existing.get("status"), set()):
        raise HTTPException(409, "Transisi status build tidak valid")

    updates = {
        "status": body.status,
        "status_message": body.message.strip() or f"Build: {body.status}",
        "progress": body.progress,
        "updated_at": timestamp,
    }
    if body.status == "failed":
        updates.update({
            # Fatal compiler/linker diagnostics are written at the end of long
            # MSBuild logs, so retain the tail rather than the configuration prelude.
            "last_error": _build_error_summary(body.error or body.message or "Build worker gagal"),
            "completed_at": timestamp,
            "lease_expires_at": None,
            "lease_token_sha256": None,
        })
    else:
        updates["lease_expires_at"] = _lease_expiry()
    update_operation = {"$set": updates}
    if body.status == "failed":
        update_operation["$unset"] = {"active_spec_key": ""}
    result = await db.vst_maker_build_jobs.update_one(
        {"id": job_id, "lease_token_sha256": token_hash, "status": existing["status"]},
        update_operation,
    )
    if not result.modified_count:
        raise HTTPException(409, "Status build baru saja berubah")
    if body.status == "failed":
        await _set_build_license_status(existing, "build_failed")
        await _release_job_business_quota(job_id)
    return {"ok": True, "lease_expires_at": updates.get("lease_expires_at")}


def _inspect_artifact(file_object, filename: str, expected_sha256: str) -> tuple[int, str]:
    safe_name = str(filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not safe_name.lower().endswith(".zip") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._ -]{0,199}\.zip", safe_name):
        raise ValueError("Artifact harus berupa ZIP dengan nama file yang aman")
    digest = hashlib.sha256()
    size = 0
    file_object.seek(0)
    while chunk := file_object.read(1024 * 1024):
        size += len(chunk)
        if size > MAX_ARTIFACT_BYTES:
            raise OverflowError("Artifact melebihi batas 1 GB")
        digest.update(chunk)
    file_object.seek(0)
    actual_sha256 = digest.hexdigest()
    if size < 22:
        raise ValueError("Artifact ZIP kosong atau rusak")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256 or "") or not hmac.compare_digest(
        actual_sha256, expected_sha256.lower()
    ):
        raise ValueError("Checksum artifact tidak cocok")
    return size, actual_sha256


async def _expire_artifact_job(job: dict, reason: str = "Masa simpan artifact berakhir") -> None:
    storage_key = str(job.get("artifact_storage_key") or "")
    if storage_key:
        await delete_private_file_reliably(storage_key, f"VST artifact expiry {job.get('id')}")
    await db.vst_maker_build_jobs.update_one(
        {"id": job["id"], "status": "ready"},
        {"$set": {
            "status": "expired",
            "status_message": reason,
            "artifact_storage_key": None,
            "artifact_expired_at": now_iso(),
            "updated_at": now_iso(),
        }},
    )


async def _prune_project_artifacts(job: dict) -> None:
    keep = max(1, int(job.get("artifact_limit") or 1))
    target_platform = "macos" if job.get("target_platform") == "macos" else "windows"
    platform_filter = {"target_platform": "macos"} if target_platform == "macos" else {"target_platform": {"$ne": "macos"}}
    ready = await db.vst_maker_build_jobs.find(
        {
            "project_id": job["project_id"],
            "owner_customer_id": job.get("owner_customer_id"),
            "status": "ready",
            "artifact_storage_key": {"$type": "string"},
            "marketplace_published": {"$ne": True},
            **platform_filter,
        },
        {"_id": 0},
    ).sort("completed_at", -1).to_list(50)
    for old_job in ready[keep:]:
        await _expire_artifact_job(old_job, "Artifact lama diganti build yang lebih baru")


@worker_router.post("/jobs/{job_id}/artifact", dependencies=[Depends(verify_vst_worker)])
async def upload_vst_build_artifact(
    job_id: str,
    file: UploadFile = File(...),
    x_lease_token: str = Header(default=""),
    x_artifact_sha256: str = Header(default=""),
    x_validator_name: str = Header(default="TripleSide export check"),
):
    if not R2_CONFIGURED:
        raise HTTPException(503, "Penyimpanan privat R2 belum dikonfigurasi")
    token_hash = _lease_hash(x_lease_token)
    timestamp = now_iso()
    job = await db.vst_maker_build_jobs.find_one({
        "id": job_id,
        "status": "validating",
        "lease_token_sha256": token_hash,
        "lease_expires_at": {"$gt": timestamp},
    }, {"_id": 0})
    if not job:
        raise HTTPException(409, "Lease build tidak berlaku atau build belum divalidasi")
    try:
        size, sha256 = await asyncio.to_thread(
            _inspect_artifact, file.file, file.filename or "", x_artifact_sha256
        )
    except OverflowError as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error

    reservation_token = await _reserve_storage_upload(global_increment=size)
    try:
        uploaded = await upload_private_file_stream(
            file.file,
            file.filename or f"vst3-{job.get('target_platform') or 'windows'}.zip",
            folder=f"vst-maker/{job.get('owner_customer_id') or 'admin'}/{job['project_id']}/builds/{job_id}",
            content_type="application/zip",
        )
        completed_at = now_iso()
        retention_days = max(1, int(job.get("artifact_retention_days") or 14))
        artifact_expires_at = (
            datetime.now(timezone.utc) + timedelta(days=retention_days)
        ).isoformat()
        result = await db.vst_maker_build_jobs.update_one(
            {"id": job_id, "status": "validating", "lease_token_sha256": token_hash},
            {
                "$set": {
                    "status": "ready",
                    "status_message": f"VST3 {'macOS' if job.get('target_platform') == 'macos' else 'Windows'} siap diunduh",
                    "progress": 100,
                    "artifact_filename": uploaded["filename"],
                    "artifact_size_bytes": size,
                    "artifact_sha256": sha256,
                    "artifact_storage_key": uploaded["storage_key"],
                    "artifact_expires_at": artifact_expires_at,
                    "validator_name": x_validator_name.strip()[:120] or "TripleSide export check",
                    "validator_passed": True,
                    "updated_at": completed_at,
                    "completed_at": completed_at,
                    "lease_expires_at": None,
                    "lease_token_sha256": None,
                },
                "$unset": {"active_spec_key": ""},
            },
        )
        if not result.modified_count:
            await delete_private_file(uploaded["storage_key"])
            raise HTTPException(409, "Status build berubah selama upload")
    finally:
        await _release_storage_upload(reservation_token)
    completed_job = {
        **job, "status": "ready", "progress": 100,
        "artifact_filename": uploaded["filename"], "artifact_size_bytes": size,
        "artifact_sha256": sha256, "artifact_storage_key": uploaded["storage_key"],
        "artifact_expires_at": artifact_expires_at, "completed_at": completed_at,
    }
    await _set_build_license_status(completed_job, "ready")
    if completed_job.get("business_plan_id") in {"creator", "studio"}:
        entitlement = await db.vst_business_entitlements.find_one(
            {
                "id": completed_job.get("business_entitlement_id"),
                "customer_id": completed_job.get("owner_customer_id"),
                "status": "active",
            },
            {"_id": 0},
        )
        if entitlement:
            await ensure_direct_distribution_plan(
                db,
                entitlement,
                completed_job,
                str(completed_job.get("owner_customer_id") or ""),
                int(completed_job.get("license_max_activations") or 1),
            )
    await _prune_project_artifacts(completed_job)
    return _public_build_job({
        **completed_job, "validator_name": x_validator_name.strip()[:120],
        "validator_passed": True, "updated_at": completed_at,
    })


async def _artifact_download(query: dict):
    job = await db.vst_maker_build_jobs.find_one(
        {**query, "status": "ready", "artifact_storage_key": {"$type": "string"}},
        {"_id": 0, "artifact_storage_key": 1},
    )
    if not job:
        raise HTTPException(404, "Artifact build belum tersedia")
    try:
        url = await create_private_download_url(job["artifact_storage_key"], 300)
    except Exception as error:
        logger.exception("Failed to sign VST artifact download")
        raise HTTPException(502, "Penyimpanan artifact sedang tidak dapat diakses") from error
    return {"download_url": url, "expires_in": 300}


async def _project_sample_assets(project_id: str, owner_customer_id: str | None) -> list[dict]:
    query = {"project_id": project_id, "owner_customer_id": owner_customer_id}
    return await db.vst_maker_sample_assets.find(query, {"_id": 0}).to_list(128)


async def _template_project_and_assets(template_id: str) -> tuple[dict, dict, list[dict]]:
    template = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    source_project_id = template.get("source_project_id")
    source = await db.vst_maker_projects.find_one({"id": source_project_id}, {"_id": 0})
    if not source:
        raise HTTPException(409, "Project sumber template tidak tersedia")
    assets = await _project_sample_assets(source["id"], source.get("owner_customer_id"))
    return template, source, assets


async def _inherit_template_assets(project: dict) -> None:
    """Attach template audio objects to a new project without copying R2 data."""
    template_id = project.get("pricing_template_id")
    if not template_id:
        return
    template = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0})
    if not template or not template.get("source_project_id"):
        return
    source = await db.vst_maker_projects.find_one(
        {"id": template["source_project_id"]}, {"_id": 0}
    )
    if not source:
        return
    source_assets = await _project_sample_assets(source["id"], source.get("owner_customer_id"))
    matches = [
        *_matching_sample_assets(project, source_assets).values(),
        *_matching_impulse_assets(project, source_assets).values(),
    ]
    timestamp = now_iso()
    for asset in matches:
        is_impulse = asset.get("asset_kind") == "impulse_response"
        prefix = "vst-ir" if is_impulse else "vst-sample"
        inherited = {
            **asset,
            "id": f"{prefix}:{project['id']}:{asset['sample_id']}",
            "project_id": project["id"],
            "owner_customer_id": project.get("owner_customer_id"),
            "shared_from_template_id": template_id,
            "uploaded_at": timestamp,
            "updated_at": timestamp,
        }
        inherited.pop("_id", None)
        await db.vst_maker_sample_assets.replace_one(
            {"id": inherited["id"]}, inherited, upsert=True
        )


async def _resolve_template_pricing_baseline(project: dict, existing: dict | None = None) -> dict:
    """Freeze the template's included items so later additions are billed."""
    template_id = str(project.get("pricing_template_id") or project.get("project_template") or "").strip()
    previous = (existing or {}).get("pricing_template_baseline") or {}
    previous_template_id = str((existing or {}).get("pricing_template_id") or (existing or {}).get("project_template") or "").strip()
    if previous and previous_template_id == template_id and str(previous.get("template_id") or "") == template_id:
        return previous

    templates = getattr(db, "vst_maker_templates", None)
    projects = getattr(db, "vst_maker_projects", None)
    template = await templates.find_one(
        {"id": template_id}, {"_id": 0, "source_project_id": 1, "project": 1}
    ) if template_id and templates is not None else None
    source = None
    if template and template.get("source_project_id") and projects is not None:
        source = await projects.find_one(
            {"id": template["source_project_id"]}, {"_id": 0}
        )
    template_project = source or (template or {}).get("project")
    baseline_source = dict(template_project or project)
    baseline_source["pricing_template_id"] = template_id
    return create_template_baseline(baseline_source)


async def _with_template_pricing_baseline(project: dict) -> dict:
    baseline = project.get("pricing_template_baseline") or {}
    template_id = str(project.get("pricing_template_id") or project.get("project_template") or "").strip()
    if baseline and str(baseline.get("template_id") or "") == template_id:
        return project
    return {**project, "pricing_template_baseline": await _resolve_template_pricing_baseline(project)}


async def _delete_asset_objects(assets: list[dict]) -> None:
    for asset in assets:
        storage_key = asset.get("storage_key")
        if not storage_key:
            continue
        if await db.vst_maker_sample_assets.find_one(
            {"storage_key": storage_key}, {"_id": 0, "id": 1}
        ):
            continue
        asset_label = "impulse" if asset.get("asset_kind") == "impulse_response" else "sample"
        await delete_private_file_reliably(storage_key, f"VST {asset_label} {asset.get('id')}")


async def _delete_project_sample_assets(project_id: str, owner_customer_id: str | None) -> None:
    assets = await _project_sample_assets(project_id, owner_customer_id)
    if not assets:
        return
    await db.vst_maker_sample_assets.delete_many({
        "project_id": project_id,
        "owner_customer_id": owner_customer_id,
    })
    await _delete_asset_objects(assets)


async def _cancel_project_builds(
    project_id: str, owner_customer_id: str | None, status_message: str = "Project dihapus"
) -> None:
    timestamp = now_iso()
    jobs = await db.vst_maker_build_jobs.find(
        {
            "project_id": project_id,
            "owner_customer_id": owner_customer_id,
            "status": {"$in": sorted(ACTIVE_BUILD_STATUSES)},
        },
        {"_id": 0},
    ).to_list(100)
    await db.vst_maker_build_jobs.update_many(
        {
            "project_id": project_id,
            "owner_customer_id": owner_customer_id,
            "status": {"$in": sorted(ACTIVE_BUILD_STATUSES)},
        },
        {
            "$set": {
                "status": "canceled",
                "status_message": status_message,
                "updated_at": timestamp,
                "completed_at": timestamp,
                "canceled_at": timestamp,
            },
            "$unset": {"active_spec_key": ""},
        },
    )
    for job in jobs:
        await _set_build_license_status(job, "build_canceled")
        await _release_job_business_quota(str(job.get("id") or ""))


async def _delete_project_builds(project_id: str, owner_customer_id: str | None) -> None:
    query = {"project_id": project_id, "owner_customer_id": owner_customer_id}
    jobs = await db.vst_maker_build_jobs.find(
        query, {"_id": 0, "id": 1, "artifact_storage_key": 1}
    ).to_list(None)
    for job in jobs:
        if job.get("artifact_storage_key"):
            await delete_private_file_reliably(
                job["artifact_storage_key"], f"VST build artifact {job.get('id')}"
            )
        await _set_build_license_status(job, "project_deleted")
    await db.vst_maker_build_jobs.delete_many(query)


async def _reserve_customer_project_slot(
    customer_id: str, project_id: str, project_limit: int, tier: str = ""
) -> int:
    """Claim one of a tier's finite slots using Mongo's unique _id atomically."""
    existing_projects = await db.vst_maker_projects.find(
        {"owner_customer_id": customer_id}, {"_id": 0, "id": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(project_limit + 1)
    if len(existing_projects) >= project_limit:
        raise HTTPException(403, f"Batas paket {tier.title()} adalah {project_limit} project")

    # Backfill reservations for projects created before atomic slots existed.
    for existing in existing_projects:
        reserved = await db.vst_maker_project_slots.find_one({
            "owner_customer_id": customer_id, "project_id": existing["id"]
        }, {"_id": 0, "slot": 1})
        if reserved:
            continue
        for slot in range(1, project_limit + 1):
            try:
                await db.vst_maker_project_slots.insert_one({
                    "_id": f"{customer_id}:{slot}", "owner_customer_id": customer_id,
                    "project_id": existing["id"], "slot": slot, "created_at": now_iso(),
                })
                break
            except DuplicateKeyError:
                reserved = await db.vst_maker_project_slots.find_one({
                    "owner_customer_id": customer_id, "project_id": existing["id"]
                }, {"_id": 0, "slot": 1})
                if reserved:
                    break

    for slot in range(1, project_limit + 1):
        try:
            await db.vst_maker_project_slots.insert_one({
                "_id": f"{customer_id}:{slot}", "owner_customer_id": customer_id,
                "project_id": project_id, "slot": slot, "created_at": now_iso(),
            })
            return slot
        except DuplicateKeyError:
            continue
    raise HTTPException(403, f"Batas paket {tier.title()} adalah {project_limit} project")


async def _release_customer_project_slot(customer_id: str, project_id: str) -> None:
    await db.vst_maker_project_slots.delete_many({
        "owner_customer_id": customer_id, "project_id": project_id
    })


async def _remove_orphaned_sample_assets(project: dict) -> None:
    project_id = project.get("id")
    owner_customer_id = project.get("owner_customer_id")
    samples = {
        sample.get("id"): (sample.get("filename"), int(sample.get("size_bytes") or 0))
        for sample in project.get("samples") or []
    }
    impulses = {
        impulse.get("id"): (impulse.get("filename"), int(impulse.get("size_bytes") or 0))
        for impulse in project.get("impulse_responses") or []
    }
    assets = await _project_sample_assets(project_id, owner_customer_id)
    orphans = [
        asset for asset in assets
        if (impulses if asset.get("asset_kind") == "impulse_response" else samples).get(asset.get("sample_id"))
        != (asset.get("filename"), int(asset.get("size_bytes") or 0))
    ]
    if not orphans:
        return
    orphan_ids = [asset["id"] for asset in orphans]
    await db.vst_maker_sample_assets.delete_many({"id": {"$in": orphan_ids}})
    await _cancel_project_builds(project_id, owner_customer_id, "Aset project berubah")
    await _delete_asset_objects(orphans)


async def _upload_project_sample(project: dict, sample_id: str, file: UploadFile) -> dict:
    if not R2_CONFIGURED:
        raise HTTPException(503, "Penyimpanan privat R2 belum dikonfigurasi")
    sample = next((item for item in project.get("samples") or [] if item.get("id") == sample_id), None)
    if not sample:
        raise HTTPException(404, "Sample tidak terdaftar pada project")
    filename = str(file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if filename != sample.get("filename"):
        raise HTTPException(409, "Nama file tidak cocok dengan metadata sample project")
    try:
        file_size, sha256, content_type = await asyncio.to_thread(_inspect_sample_file, file.file, filename)
    except OverflowError as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if file_size != int(sample.get("size_bytes") or 0):
        raise HTTPException(409, "Ukuran file tidak cocok dengan metadata sample project")

    owner_customer_id = project.get("owner_customer_id")
    asset_id = f"vst-sample:{project['id']}:{sample_id}"
    existing = await db.vst_maker_sample_assets.find_one({"id": asset_id}, {"_id": 0})
    if owner_customer_id:
        entitlement = await customer_vst_entitlement(owner_customer_id)
        file_limit = TIER_SAMPLE_FILE_LIMIT.get(entitlement["tier"], 0)
        if not file_limit or file_size > file_limit:
            raise HTTPException(
                413,
                f"Ukuran maksimal satu WAV untuk paket {entitlement['tier'].title()} adalah {file_limit // 1_000_000} MB.",
            )
    existing_size = int((existing or {}).get("size_bytes") or 0)
    reservation_token = await _reserve_storage_upload(
        customer_id=owner_customer_id or "",
        customer_increment=max(0, file_size - existing_size),
        # During replacement both old and new objects exist briefly.
        global_increment=file_size,
    )
    uploaded = None
    try:
        uploaded = await upload_private_file_stream(
            file.file,
            filename,
            folder=f"vst-maker/{owner_customer_id or 'admin'}/{project['id']}/samples",
            content_type=content_type,
        )
        current = await db.vst_maker_projects.find_one(
            {"id": project["id"], "owner_customer_id": owner_customer_id}, {"_id": 0, "samples": 1}
        )
        current_sample = next((item for item in (current or {}).get("samples", []) if item.get("id") == sample_id), None)
        if not current_sample or (
            current_sample.get("filename"), int(current_sample.get("size_bytes") or 0)
        ) != (filename, file_size):
            await delete_private_file(uploaded["storage_key"])
            raise HTTPException(409, "Metadata sample berubah selama upload; silakan ulangi")
        timestamp = now_iso()
        asset = {
            "id": asset_id,
            "project_id": project["id"],
            "sample_id": sample_id,
            "owner_customer_id": owner_customer_id,
            "filename": filename,
            "size_bytes": file_size,
            "sha256": sha256,
            "storage_provider": uploaded["storage_provider"],
            "storage_key": uploaded["storage_key"],
            "content_type": uploaded.get("content_type") or content_type,
            "etag": uploaded.get("etag"),
            "uploaded_at": timestamp,
            "updated_at": timestamp,
        }
        await db.vst_maker_sample_assets.replace_one({"id": asset_id}, asset, upsert=True)
    except HTTPException:
        raise
    except Exception as error:
        if uploaded and uploaded.get("storage_key"):
            try:
                await delete_private_file(uploaded["storage_key"])
            except Exception:
                logger.exception("Failed to roll back VST sample upload")
        logger.exception("VST sample upload failed")
        raise HTTPException(500, "Upload sample ke penyimpanan privat gagal") from error
    finally:
        await _release_storage_upload(reservation_token)

    await _cancel_project_builds(project["id"], owner_customer_id, "Aset sample berubah")
    if existing and existing.get("storage_key") and existing["storage_key"] != asset["storage_key"]:
        try:
            await _delete_asset_objects([existing])
        except Exception:
            logger.exception("Failed to remove replaced VST sample object %s", existing.get("id"))
    return _public_sample_asset(asset)


async def _upload_project_impulse(project: dict, impulse_id: str, file: UploadFile) -> dict:
    if not R2_CONFIGURED:
        raise HTTPException(503, "Penyimpanan privat R2 belum dikonfigurasi")
    impulse = next((item for item in project.get("impulse_responses") or [] if item.get("id") == impulse_id), None)
    if not impulse:
        raise HTTPException(404, "Impulse response tidak terdaftar pada project")
    filename = str(file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if filename != impulse.get("filename"):
        raise HTTPException(409, "Nama file tidak cocok dengan metadata impulse response")
    try:
        file_size, sha256, content_type = await asyncio.to_thread(
            _inspect_sample_file,
            file.file,
            filename,
            max_bytes=MAX_IMPULSE_RESPONSE_BYTES,
            size_label="impulse response",
        )
    except OverflowError as error:
        raise HTTPException(413, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    if file_size > MAX_IMPULSE_RESPONSE_BYTES:
        raise HTTPException(413, "Ukuran maksimal impulse response adalah 32 MB")
    if file_size != int(impulse.get("size_bytes") or 0):
        raise HTTPException(409, "Ukuran file tidak cocok dengan metadata impulse response")

    owner_customer_id = project.get("owner_customer_id")
    asset_id = f"vst-ir:{project['id']}:{impulse_id}"
    existing = await db.vst_maker_sample_assets.find_one({"id": asset_id}, {"_id": 0})
    existing_size = int((existing or {}).get("size_bytes") or 0)
    reservation_token = await _reserve_storage_upload(
        customer_id=owner_customer_id or "",
        customer_increment=max(0, file_size - existing_size),
        global_increment=file_size,
    )
    uploaded = None
    try:
        uploaded = await upload_private_file_stream(
            file.file,
            filename,
            folder=f"vst-maker/{owner_customer_id or 'admin'}/{project['id']}/impulse-responses",
            content_type=content_type,
        )
        current = await db.vst_maker_projects.find_one(
            {"id": project["id"], "owner_customer_id": owner_customer_id},
            {"_id": 0, "impulse_responses": 1},
        )
        current_impulse = next(
            (item for item in (current or {}).get("impulse_responses", []) if item.get("id") == impulse_id), None
        )
        if not current_impulse or (
            current_impulse.get("filename"), int(current_impulse.get("size_bytes") or 0)
        ) != (filename, file_size):
            await delete_private_file(uploaded["storage_key"])
            raise HTTPException(409, "Metadata impulse response berubah selama upload; silakan ulangi")
        timestamp = now_iso()
        asset = {
            "id": asset_id,
            "asset_kind": "impulse_response",
            "project_id": project["id"],
            "sample_id": impulse_id,
            "owner_customer_id": owner_customer_id,
            "filename": filename,
            "size_bytes": file_size,
            "sha256": sha256,
            "storage_provider": uploaded["storage_provider"],
            "storage_key": uploaded["storage_key"],
            "content_type": uploaded.get("content_type") or content_type,
            "etag": uploaded.get("etag"),
            "uploaded_at": timestamp,
            "updated_at": timestamp,
        }
        await db.vst_maker_sample_assets.replace_one({"id": asset_id}, asset, upsert=True)
    except HTTPException:
        raise
    except Exception as error:
        if uploaded and uploaded.get("storage_key"):
            try:
                await delete_private_file(uploaded["storage_key"])
            except Exception:
                logger.exception("Failed to roll back VST impulse upload")
        logger.exception("VST impulse response upload failed")
        raise HTTPException(500, "Upload impulse response ke penyimpanan privat gagal") from error
    finally:
        await _release_storage_upload(reservation_token)

    await _cancel_project_builds(project["id"], owner_customer_id, "Impulse response berubah")
    if existing and existing.get("storage_key") and existing["storage_key"] != asset["storage_key"]:
        await _delete_asset_objects([existing])
    return _public_impulse_asset(asset)


async def _preview_project_impulse(project: dict, impulse_id: str):
    asset = await db.vst_maker_sample_assets.find_one({
        "project_id": project["id"],
        "owner_customer_id": project.get("owner_customer_id"),
        "sample_id": impulse_id,
        "asset_kind": "impulse_response",
    }, {"_id": 0})
    if not asset or not asset.get("storage_key"):
        raise HTTPException(404, "Impulse response belum tersimpan")
    try:
        private_file = await open_private_file(asset["storage_key"])
    except Exception as error:
        logger.exception("Failed to open VST impulse preview %s", asset.get("id"))
        raise HTTPException(502, "Impulse response sedang tidak dapat diakses") from error
    return StreamingResponse(
        iter_private_file_chunks(asset["storage_key"], private_file),
        media_type=asset.get("content_type") or private_file.get("ContentType") or "audio/wav",
        headers={"Content-Length": str(private_file["ContentLength"]), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )


async def _delete_project_impulse(project: dict, impulse_id: str) -> None:
    query = {
        "project_id": project["id"],
        "owner_customer_id": project.get("owner_customer_id"),
        "sample_id": impulse_id,
        "asset_kind": "impulse_response",
    }
    asset = await db.vst_maker_sample_assets.find_one(query, {"_id": 0})
    result = await db.vst_maker_projects.update_one(
        {"id": project["id"], "owner_customer_id": project.get("owner_customer_id")},
        {"$pull": {"impulse_responses": {"id": impulse_id}}, "$set": {"updated_at": now_iso()}},
    )
    if not result.matched_count:
        raise HTTPException(404, "Project tidak ditemukan")
    await _cancel_project_builds(project["id"], project.get("owner_customer_id"))
    if asset:
        await db.vst_maker_sample_assets.delete_one({"id": asset["id"]})
        await _delete_asset_objects([asset])


async def _preview_project_sample(project: dict, sample_id: str):
    asset = await db.vst_maker_sample_assets.find_one({
        "project_id": project["id"],
        "owner_customer_id": project.get("owner_customer_id"),
        "sample_id": sample_id,
        "asset_kind": {"$ne": "impulse_response"},
    }, {"_id": 0})
    if not asset or not asset.get("storage_key"):
        raise HTTPException(404, "Audio sample belum tersimpan")
    try:
        private_file = await open_private_file(asset["storage_key"])
    except Exception as error:
        logger.exception("Failed to open VST sample preview %s", asset.get("id"))
        raise HTTPException(502, "Audio sample sedang tidak dapat diakses") from error
    return StreamingResponse(
        iter_private_file_chunks(asset["storage_key"], private_file),
        media_type=asset.get("content_type") or private_file.get("ContentType") or "application/octet-stream",
        headers={
            "Content-Length": str(private_file["ContentLength"]),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def _delete_project_sample(project: dict, sample_id: str) -> None:
    query = {
        "project_id": project["id"],
        "owner_customer_id": project.get("owner_customer_id"),
        "sample_id": sample_id,
        "asset_kind": {"$ne": "impulse_response"},
    }
    asset = await db.vst_maker_sample_assets.find_one(query, {"_id": 0})
    result = await db.vst_maker_projects.update_one(
        {"id": project["id"], "owner_customer_id": project.get("owner_customer_id")},
        {
            "$pull": {"samples": {"id": sample_id}, "sample_mappings": {"sample_id": sample_id}},
            "$set": {"updated_at": now_iso()},
        },
    )
    if not result.matched_count:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _cancel_project_builds(project["id"], project.get("owner_customer_id"))
    if not asset:
        return
    await db.vst_maker_sample_assets.delete_one({"id": asset["id"]})
    await _delete_asset_objects([asset])


def _dsp_graph_contract(project: dict, modules: list[dict], is_effect: bool) -> dict:
    if is_effect and not modules:
        rack = LEGACY_STANDARD_EFFECT_RACK
        if project.get("project_template") == "prismeq":
            rack = (
                ("legacy-input", "input_trim", "Input Trim"),
                ("legacy-prism", "prism_eq", "Prism EQ"),
                ("legacy-mix", "dry_wet", "Dry/Wet"),
                ("legacy-output", "output_trim", "Output Trim"),
            )
        return {
            "version": 2,
            "mode": "ordered_rack",
            "source": "legacy_compatibility",
            "modules": [
                {
                    "id": module_id,
                    "type": module_type,
                    "name": name,
                    "parentId": None,
                    "order": order,
                    "bypassed": False,
                    "mix": 1.0,
                    "parameters": {},
                }
                for order, (module_id, module_type, name) in enumerate(rack)
            ],
        }

    normalized_modules = []
    for source_index, module in enumerate(modules):
        module_type = str(module.get("type") or "").strip().lower().replace("-", "_")
        order_value = module.get("order")
        mix_value = module.get("mix")
        normalized_modules.append({
            "id": str(module.get("id") or "").strip(),
            "type": module_type,
            "name": str(module.get("name") or module_type).strip(),
            "parentId": module.get("parent_id") or module.get("parentId"),
            "samplerGroupId": module.get("sampler_group_id") or module.get("samplerGroupId"),
            "order": source_index if order_value is None else int(order_value),
            "bypassed": bool(module.get("bypassed", False)),
            "mix": max(0.0, min(1.0, 1.0 if mix_value is None else float(mix_value))),
            "parameters": {
                str(key): float(value)
                for key, value in (module.get("parameters") or {}).items()
                if not (module_type == "wave_generator" and str(key) == "note_priority")
            },
            "_sourceIndex": source_index,
        })
    normalized_modules.sort(key=lambda module: (module["order"], module["_sourceIndex"]))
    for module in normalized_modules:
        module.pop("_sourceIndex", None)
    return {
        "version": 2,
        "mode": "ordered_rack" if is_effect else "instrument_serial_rack",
        "source": "project",
        "modules": normalized_modules,
    }


def vst_maker_build_spec(project: dict, sample_assets: list[dict] | None = None) -> dict:
    """Convert the persisted API model into the versioned native build contract."""
    samples = project.get("samples") or []
    assets_by_sample = _matching_sample_assets(project, sample_assets)
    impulses = project.get("impulse_responses") or []
    assets_by_impulse = _matching_impulse_assets(project, sample_assets)
    mappings = project.get("sample_mappings") or []
    effects = {}
    controls = []
    for control in project.get("interface_controls") or []:
        label_position = str(control.get("label_position") or "top-left")
        if label_position not in {
            "top-left", "top-center", "top-right",
            "bottom-left", "bottom-center", "bottom-right",
        }:
            label_position = "top-left"
        try:
            label_gap = int(round(float(control.get("label_gap", 12))))
        except (TypeError, ValueError):
            label_gap = 12
        normalized_control = {**control, "label_position": label_position, "label_gap": max(0, min(24, label_gap))}
        if control.get("kind") == "knob" and control.get("component_variant") in {"open-led-ring", "pan-open-led-ring"}:
            try:
                raw_ring_thickness = control.get("ring_thickness")
                if raw_ring_thickness is None:
                    raw_ring_thickness = control.get("waveform_line_width", 5)
                ring_thickness = float(raw_ring_thickness)
            except (TypeError, ValueError):
                ring_thickness = 5
            normalized_control["ring_thickness"] = max(1, min(16, ring_thickness))
            try:
                ring_glow_intensity = float(control.get("ring_glow_intensity", 65))
            except (TypeError, ValueError):
                ring_glow_intensity = 65
            normalized_control["ring_glow_intensity"] = max(0, min(100, ring_glow_intensity))
        else:
            normalized_control.pop("ring_thickness", None)
            normalized_control.pop("ring_glow_intensity", None)
        if control.get("kind") == "button" and control.get("component_variant") == "mechanical-toggle":
            try:
                raw_state_gap = control.get("state_label_gap")
                state_label_gap = round(float(raw_state_gap)) if raw_state_gap is not None else round(5 + float(control.get("label_y", 0)))
            except (TypeError, ValueError):
                state_label_gap = 5
            normalized_control["state_label_gap"] = max(0, min(32, state_label_gap))
        else:
            normalized_control.pop("state_label_gap", None)
        if control.get("kind") == "output_selector":
            try:
                output_font_size = round(float(control.get("output_font_size", 11)))
            except (TypeError, ValueError):
                output_font_size = 11
            normalized_control["output_font_size"] = max(6, min(32, output_font_size))
            normalized_control["control_color"] = str(control.get("control_color") or "#111216")
            normalized_control["text_color"] = str(control.get("text_color") or "#F4F4F5")
        else:
            normalized_control.pop("output_font_size", None)
        if control.get("kind") == "fader":
            try:
                fader_meter_gap = round(float(control.get("fader_meter_gap", 4)))
            except (TypeError, ValueError):
                fader_meter_gap = 4
            try:
                fader_meter_width = round(float(control.get("fader_meter_width", 10)))
            except (TypeError, ValueError):
                fader_meter_width = 10
            try:
                fader_meter_height = round(float(control.get("fader_meter_height", 100)))
            except (TypeError, ValueError):
                fader_meter_height = 100
            fader_meter_color = str(control.get("fader_meter_color") or "#22C55E")
            if not re.fullmatch(r"#[0-9A-Fa-f]{6}", fader_meter_color):
                fader_meter_color = "#22C55E"
            normalized_control["fader_meter_enabled"] = control.get("fader_meter_enabled") is not False
            normalized_control["fader_meter_position"] = "left" if control.get("fader_meter_position") == "left" else "right"
            normalized_control["fader_meter_color"] = fader_meter_color
            normalized_control["fader_meter_gap"] = max(0, min(32, fader_meter_gap))
            normalized_control["fader_meter_width"] = max(4, min(32, fader_meter_width))
            normalized_control["fader_meter_height"] = max(20, min(100, fader_meter_height))
        else:
            normalized_control.pop("fader_meter_enabled", None)
            normalized_control.pop("fader_meter_position", None)
            normalized_control.pop("fader_meter_color", None)
            normalized_control.pop("fader_meter_gap", None)
            normalized_control.pop("fader_meter_width", None)
            normalized_control.pop("fader_meter_height", None)
        if control.get("kind") == "solo_mute":
            try:
                solo_mute_gap = round(float(control.get("solo_mute_gap", 8)))
            except (TypeError, ValueError):
                solo_mute_gap = 8
            solo_color = str(control.get("solo_color") or "#FACC15")
            mute_color = str(control.get("mute_color") or "#FB7185")
            normalized_control["solo_mute_gap"] = max(0, min(48, solo_mute_gap))
            normalized_control["solo_color"] = solo_color if re.fullmatch(r"#[0-9A-Fa-f]{6}", solo_color) else "#FACC15"
            normalized_control["mute_color"] = mute_color if re.fullmatch(r"#[0-9A-Fa-f]{6}", mute_color) else "#FB7185"
            normalized_control["button_shape"] = control.get("button_shape") if control.get("button_shape") in {"square", "capsule", "round"} else "square"
        else:
            normalized_control.pop("solo_mute_gap", None)
            normalized_control.pop("solo_color", None)
            normalized_control.pop("mute_color", None)
            normalized_control.pop("button_shape", None)
        controls.append(normalized_control)
    is_effect = project.get("plugin_kind") == "effect"
    sampler_groups = [] if is_effect else (project.get("sampler_groups") or [{"id": "main", "name": "Main", "volume": 100, "pan": 0, "mute": False, "solo": False}])
    sampler_groups_by_id = {str(group.get("id") or ""): group for group in sampler_groups}
    for control in controls:
        sampler_group_id = str(control.get("sampler_group_id") or "")
        if sampler_group_id and sampler_group_id not in sampler_groups_by_id:
            raise ValueError("Komponen merujuk ke sampler yang tidak tersedia")
        if control.get("kind") == "output_selector":
            target_group = sampler_groups_by_id.get(sampler_group_id)
            control["value"] = 100 if target_group and str(target_group.get("output_bus") or "master") == "separate" else 0
            continue
        target_group = sampler_groups_by_id.get(sampler_group_id)
        parameter = str(control.get("parameter") or "")
        if not target_group or parameter not in {"volume", "pan", "mute", "solo"}:
            continue
        if parameter == "volume":
            control["value"] = round(max(0, min(100, float(target_group.get("volume", 100)))))
        elif parameter == "pan":
            control["value"] = round((max(-1, min(1, float(target_group.get("pan", 0)))) + 1) * 50)
        else:
            control["value"] = 100 if bool(target_group.get(parameter, False)) else 0
    modules = project.get("engine_modules") or []

    warnings = []
    unsupported_parameters = sorted({
        str(control.get("parameter") or "").strip()
        for control in controls
        if control.get("kind") not in {"visual", "spectrum", "indicator", "text", "image", "panel_button"}
        and not control.get("module_id")
        and str(control.get("parameter") or "").strip() not in NATIVE_PARAMETERS
        and control.get("kind") != "output_selector"
        and control.get("kind") != "solo_mute"
        and not re.fullmatch(r"group_\d+_(volume|pan|mute|solo|output)", str(control.get("parameter") or "").strip())
    })
    if unsupported_parameters:
        warnings.append({
            "code": "unsupported_parameters",
            "message": "Parameter ini belum memiliki automation native: " + ", ".join(unsupported_parameters),
            "items": unsupported_parameters,
        })
    unsupported_modules = sorted({
        str(module.get("type") or "").strip().lower().replace("-", "_")
        for module in modules
        if str(module.get("type") or "").strip().lower().replace("-", "_") not in NATIVE_DSP_MODULE_TYPES
    })
    if unsupported_modules:
        warnings.append({
            "code": "unsupported_dsp_modules",
            "message": "Modul DSP ini belum memiliki processor native: " + ", ".join(unsupported_modules),
            "items": unsupported_modules,
        })
    modules_by_id = {str(module.get("id") or ""): module for module in modules}
    unsupported_module_parameters = sorted({
        f'{control.get("module_id")}.{str(control.get("parameter") or "").strip()}'
        for control in controls
        if control.get("module_id")
        and not (
            control.get("kind") in {"gain_meter", "vu_meter"}
            and str(control.get("parameter") or "").strip() == "gain_reduction"
        )
        and str(control.get("parameter") or "").strip() not in (
            NATIVE_DSP_MODULE_PARAMETERS.get(
                str(modules_by_id.get(str(control.get("module_id")), {}).get("type") or "").strip().lower().replace("-", "_"),
                set(),
            ) | {"bypass", "module_mix"}
        )
    } | {
        f'{module.get("id")}.{str(parameter).strip()}'
        for module in modules
        for parameter in (module.get("parameters") or {})
        if str(parameter).strip() not in NATIVE_DSP_MODULE_PARAMETERS.get(
            str(module.get("type") or "").strip().lower().replace("-", "_"), set()
        )
    })
    if unsupported_module_parameters:
        warnings.append({
            "code": "unsupported_module_parameters",
            "message": "Parameter modul ini belum memiliki automation native: " + ", ".join(unsupported_module_parameters),
            "items": unsupported_module_parameters,
        })
    invalid_module_parameter_values = sorted({
        f'{module.get("id")}.{str(parameter).strip()}'
        for module in modules
        for parameter, value in (module.get("parameters") or {}).items()
        if str(parameter).strip() != "gain_db"
        and (not math.isfinite(float(value)) or not 0.0 <= float(value) <= 1.0)
    })
    if invalid_module_parameter_values:
        warnings.append({
            "code": "invalid_module_parameter_values",
            "message": "Nilai parameter modul ini berada di luar rentang native 0–1: " + ", ".join(invalid_module_parameter_values),
            "items": invalid_module_parameter_values,
        })

    dsp_profile = "prism_eq" if project.get("project_template") == "prismeq" and not any(
        str(module.get("type") or "").replace("-", "_") == "prism_eq" for module in modules
    ) else "standard"
    visual_contract = {
        "version": 1,
        # The browser preview is always the static visual source of truth. Live
        # analyzers are drawn natively over their measured browser rectangles;
        # they no longer force the rest of the interface onto the approximate
        # procedural renderer.
        "mode": "shared_preview",
    }

    return {
        "schema_version": "1.0",
        "plugin_kind": project.get("plugin_kind") or "instrument",
        "project_template": project.get("project_template") or "sampler",
        "dsp_profile": dsp_profile,
        "dsp_graph": _dsp_graph_contract(project, modules, is_effect),
        "visual_contract": visual_contract,
        "project_id": project.get("id"),
        "name": project.get("name"),
        "instrument": {
            "type": project.get("instrument_type"),
            "root_note": project.get("root_note"),
            "note_range": project.get("note_range"),
            "velocity_layers": project.get("velocity_layers"),
            "polyphony": project.get("polyphony"),
            "tempoBpm": project.get("tempo_bpm") or 120.0,
            "sustainEnabled": bool(project.get("sustain_enabled", False)),
            "pitchBendEnabled": bool(project.get("pitch_bend_enabled", False)),
            "modulationEnabled": bool(project.get("modulation_enabled", False)),
        },
        "branding": {
            "manufacturer_name": project.get("manufacturer_name"),
            "tagline": project.get("brand_tagline") or "",
            "font": project.get("brand_font"),
            "font_size": project.get("brand_size"),
            "x": project.get("brand_x"),
            "y": project.get("brand_y"),
            "align": project.get("brand_align"),
        },
        "interface": {
            "template": project.get("ui_template"),
            "component_style": project.get("component_style") or ("filmstrip" if (project.get("plugin_kind") or "instrument") == "effect" else "css"),
            "filmstrip_skin": HERITAGE_FILMSTRIP_SKIN if any((c.get("component_style") if c.get("component_style") in ("css", "filmstrip") else project.get("component_style") or ("filmstrip" if is_effect else "css")) == "filmstrip" for c in controls) else None,
            "grid": {"snap": bool(project.get("grid_snap_enabled", True)), "size": project.get("grid_size") or 8},
            "ui_color": project.get("ui_color") or "#09090b",
            "accent_color": project.get("accent_color"),
            "canvas_width": project.get("canvas_width"),
            "canvas_height": project.get("canvas_height"),
            "background": {
                "url": project.get("background_image_url"),
                "name": project.get("background_image_name"),
                "fit": project.get("background_fit"),
                "opacity": project.get("background_opacity"),
                "x": project.get("background_image_x"),
                "y": project.get("background_image_y"),
                "width": project.get("background_image_width"),
                "height": project.get("background_image_height"),
            },
            "controls": controls,
        },
        "effects": effects,
        "engine_modules": modules,
        "sampler_groups": sampler_groups,
        "presets": project.get("presets") or [],
        "midi_mappings": [],
        "midi_sequences": project.get("midi_sequences") or [],
        "piano_roll": project.get("piano_roll_notes") or [],
        "samples": [{
            "id": sample.get("id"),
            "name": sample.get("filename"),
            "bytes": sample.get("size_bytes"),
            "assetId": (assets_by_sample.get(sample.get("id")) or {}).get("id"),
            "sha256": (assets_by_sample.get(sample.get("id")) or {}).get("sha256"),
        } for sample in samples],
        "impulse_responses": [{
            "id": impulse.get("id"),
            "moduleId": impulse.get("module_id"),
            "name": f"cabinet_ir_{index:03d}.wav",
            "originalName": impulse.get("filename"),
            "bytes": impulse.get("size_bytes"),
            "assetId": (assets_by_impulse.get(impulse.get("id")) or {}).get("id"),
            "sha256": (assets_by_impulse.get(impulse.get("id")) or {}).get("sha256"),
            "normalize": bool(impulse.get("normalize", True)),
            "autoTrim": bool(impulse.get("auto_trim", True)),
            "trimStart": impulse.get("trim_start", 0.0),
            "trimEnd": impulse.get("trim_end", 1.0),
            "polarityInverted": bool(impulse.get("polarity_inverted", False)),
            "phaseMs": impulse.get("phase_ms", 0.0),
        } for index, impulse in enumerate(impulses)],
        "sampler_map": [{
            "id": mapping.get("id"),
            "sampleId": mapping.get("sample_id"),
            "rootPitch": mapping.get("root_pitch"),
            "lowPitch": mapping.get("low_pitch"),
            "highPitch": mapping.get("high_pitch"),
            "velocityLow": mapping.get("velocity_low"),
            "velocityHigh": mapping.get("velocity_high"),
            "groupName": mapping.get("group_name"),
            "articulation": mapping.get("articulation"),
            "roundRobin": mapping.get("round_robin"),
            "micPosition": mapping.get("mic_position"),
            "sampleStart": mapping.get("sample_start"),
            "sampleEnd": mapping.get("sample_end"),
            "loopEnabled": mapping.get("loop_enabled"),
            "loopStart": mapping.get("loop_start"),
            "loopEnd": mapping.get("loop_end"),
            "loopCrossfadeMs": mapping.get("loop_crossfade_ms") or 0,
            "fadeInMs": mapping.get("fade_in_ms"),
            "fadeOutMs": mapping.get("fade_out_ms"),
            "tuneSemitones": mapping.get("tune_semitones") or 0,
            "tuneCents": mapping.get("tune_cents"),
            "playbackMode": "tempo_sync" if mapping.get("playback_mode") == "tempo_sync" and mapping.get("source_bpm_confirmed") else "sampler",
            "sourceBpm": mapping.get("source_bpm") or 120.0,
            "sourceBpmConfirmed": bool(mapping.get("source_bpm_confirmed")),
            "chokeTargetPitches": list(dict.fromkeys(mapping.get("choke_target_pitches") or []))[:16],
            "gainDb": mapping.get("gain_db"),
            "pan": mapping.get("pan"),
        } for mapping in mappings],
        "sample_packaging": {"mode": "private_object_storage", "monolith": False},
        "build": {
            "company_name": project.get("manufacturer_name"),
            "version": project.get("plugin_version"),
            "formats": ["VST3"],
            "platforms": ["windows"],
        },
        "compatibility": {
            "runtime": "tripleside-native",
            "supported_parameters": sorted(NATIVE_PARAMETERS),
            "supported_effects": sorted(NATIVE_EFFECTS),
            "warnings": warnings,
        },
    }


def vst_maker_build_issues(project: dict, sample_assets: list[dict] | None = None, require_uploaded: bool = False) -> list[str]:
    samples = project.get("samples") or []
    mappings = project.get("sample_mappings") or []
    sample_ids = {sample.get("id") for sample in samples}
    impulses = project.get("impulse_responses") or []
    issues = []
    if not str(project.get("name") or "").strip():
        issues.append("Nama plugin belum diisi")
    is_effect = project.get("plugin_kind") == "effect"
    if is_effect:
        if project.get("instrument_type") != "Audio Effect":
            issues.append("Project effect harus menggunakan tipe Audio Effect")
    else:
        has_wave_generator = any(
            str(module.get("type") or "").strip().lower().replace("-", "_") == "wave_generator"
            and not bool(module.get("bypassed", False))
            for module in (project.get("engine_modules") or [])
        )
        if not samples and not has_wave_generator:
            issues.append("Project belum memiliki sample")
        if any(_sample_suffix(sample.get("filename")) != ".wav" for sample in samples):
            issues.append("Semua sumber suara harus menggunakan format WAV")
        if any(not int(sample.get("size_bytes") or 0) for sample in samples):
            issues.append("Semua sample harus memiliki ukuran file yang valid")
        if not mappings and not has_wave_generator:
            issues.append("Project belum memiliki sample mapping")
        if any(mapping.get("sample_id") not in sample_ids for mapping in mappings):
            issues.append("Ada mapping yang merujuk ke sample yang tidak tersedia")
    if require_uploaded and not is_effect:
        uploaded = set(_matching_sample_assets(project, sample_assets))
        missing = sample_ids - uploaded
        if missing:
            issues.append(f"{len(missing)} sample belum diunggah ke penyimpanan build")
    if require_uploaded and impulses:
        uploaded_impulses = set(_matching_impulse_assets(project, sample_assets))
        missing_impulses = {impulse.get("id") for impulse in impulses} - uploaded_impulses
        if missing_impulses:
            issues.append(f"{len(missing_impulses)} impulse response belum diunggah ke penyimpanan build")
    return issues


def _ready_build_spec(project: dict, sample_assets: list[dict] | None = None, require_uploaded: bool = False) -> dict:
    issues = vst_maker_build_issues(project, sample_assets, require_uploaded)
    if issues:
        raise HTTPException(409, detail={"message": "Project belum siap diekspor", "issues": issues})
    return vst_maker_build_spec(project, sample_assets)


@admin_router.get("/vst-maker/projects")
async def list_vst_maker_projects(
    limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)
):
    return await db.vst_maker_projects.find({}, {"_id": 0}).sort("updated_at", -1).skip(offset).to_list(limit)


@admin_router.get("/vst-maker/templates")
async def list_admin_vst_maker_templates():
    return await db.vst_maker_templates.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)


@admin_router.get("/vst-maker/template-settings")
async def list_admin_vst_maker_template_settings():
    return await db.vst_maker_template_settings.find({}, {"_id": 0}).to_list(200)


@admin_router.get("/vst-maker/build-settings")
async def get_admin_vst_maker_build_settings():
    return await _load_vst_maker_build_settings()


@admin_router.get("/vst-maker/live-customers")
async def list_admin_vst_maker_live_customers():
    current = datetime.now(timezone.utc)
    presences = await db.vst_maker_presence.find(
        {"expires_at": {"$gt": current}}, {"_id": 0}
    ).sort("last_seen_at", -1).to_list(500)
    builds = await db.vst_maker_build_jobs.find(
        {
            "owner_customer_id": {"$type": "string"},
            "status": {"$in": sorted(ACTIVE_BUILD_STATUSES)},
        },
        {
            "_id": 0, "id": 1, "owner_customer_id": 1, "project_id": 1,
            "project_name": 1, "status": 1, "progress": 1, "status_message": 1,
            "updated_at": 1, "created_at": 1,
        },
    ).sort("updated_at", -1).to_list(500)
    customer_ids = {
        str(item.get("customer_id") or item.get("owner_customer_id") or "")
        for item in [*presences, *builds]
        if item.get("customer_id") or item.get("owner_customer_id")
    }
    customers = await db.customers.find(
        {"id": {"$in": sorted(customer_ids)}},
        {"_id": 0, "id": 1, "email": 1, "name": 1, "first_name": 1, "last_name": 1},
    ).to_list(len(customer_ids) or 1)
    customer_by_id = {str(item.get("id")): item for item in customers}
    rows: dict[str, dict] = {}

    def customer_row(customer_id: str) -> dict:
        if customer_id not in rows:
            customer = customer_by_id.get(customer_id, {})
            name = str(customer.get("name") or " ".join(filter(None, [customer.get("first_name"), customer.get("last_name")]))).strip()
            rows[customer_id] = {
                "customer_id": customer_id,
                "name": name,
                "email": str(customer.get("email") or ""),
                "editing": None,
                "builds": [],
            }
        return rows[customer_id]

    for presence in presences:
        customer_id = str(presence.get("customer_id") or "")
        if customer_id:
            customer_row(customer_id)["editing"] = {
                "project_id": presence.get("project_id"),
                "project_name": presence.get("project_name"),
                "editor_tab": presence.get("editor_tab"),
                "last_seen_at": presence.get("last_seen_at").isoformat() if isinstance(presence.get("last_seen_at"), datetime) else presence.get("last_seen_at"),
            }
    for build in builds:
        customer_id = str(build.get("owner_customer_id") or "")
        if customer_id:
            customer_row(customer_id)["builds"].append({key: build.get(key) for key in (
                "id", "project_id", "project_name", "status", "progress", "status_message", "updated_at", "created_at"
            )})
    items = sorted(
        rows.values(),
        key=lambda item: (bool(item["builds"]), bool(item["editing"]), item["email"]),
        reverse=True,
    )
    return {
        "items": items,
        "editing_count": sum(1 for item in items if item["editing"]),
        "building_count": sum(len(item["builds"]) for item in items),
        "updated_at": now_iso(),
    }


@admin_router.put("/vst-maker/build-settings")
async def update_admin_vst_maker_build_settings(body: VstMakerBuildSettingsInput):
    settings = _normalize_vst_maker_build_settings(body.model_dump())
    document = {"id": "default", **settings, "updated_at": now_iso()}
    await db.vst_maker_build_settings.update_one(
        {"id": "default"}, {"$set": document}, upsert=True
    )
    return settings


@admin_router.put("/vst-maker/template-order")
async def update_admin_vst_maker_template_order(body: VstMakerTemplateOrderInput):
    admin_ids = {
        item["id"] async for item in db.vst_maker_templates.find({}, {"_id": 0, "id": 1})
        if item.get("id")
    }
    allowed_ids = VST_MAKER_BUILT_IN_TEMPLATE_IDS | admin_ids
    unknown = [template_id for template_id in body.template_ids if template_id not in allowed_ids]
    if unknown:
        raise HTTPException(404, f"Template VST Maker tidak ditemukan: {unknown[0]}")
    timestamp = now_iso()
    for sort_order, template_id in enumerate(body.template_ids):
        await db.vst_maker_template_settings.update_one(
            {"template_id": template_id},
            {"$set": {"template_id": template_id, "sort_order": sort_order, "updated_at": timestamp}},
            upsert=True,
        )
    return {"template_ids": body.template_ids}


async def _upload_vst_image(file: UploadFile, folder: str) -> dict:
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(400, "Gambar harus berupa JPG, PNG, atau WebP")
    if not CLOUDINARY_CONFIGURED:
        raise HTTPException(503, "Penyimpanan gambar belum dikonfigurasi")
    file_size = file.size
    if file_size is None:
        position = file.file.tell()
        file.file.seek(0, 2)
        file_size = file.file.tell()
        file.file.seek(position)
    if not file_size or file_size > MAX_BACKGROUND_BYTES:
        raise HTTPException(413, "Ukuran gambar harus di antara 1 byte dan 10 MB")
    try:
        return await upload_file_stream(file.file, file.filename or "vst-image", folder=folder)
    except Exception:
        logger.exception("VST Maker image upload failed")
        raise HTTPException(500, "Upload gambar gagal. Silakan coba lagi.")


@admin_router.post("/vst-maker/images")
async def upload_admin_vst_maker_image(file: UploadFile = File(...)):
    return await _upload_vst_image(file, "tripleside/vst-component-images")


@admin_router.post("/vst-maker/projects/{project_id}/template")
async def save_admin_vst_maker_template(project_id: str):
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": {"$exists": False}}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = await _project_sample_assets(project_id, project.get("owner_customer_id"))
    if len(_matching_sample_assets(project, assets)) != len(project.get("samples") or []):
        raise HTTPException(409, "Semua sample harus selesai diunggah sebelum template disimpan")
    if len(_matching_impulse_assets(project, assets)) != len(project.get("impulse_responses") or []):
        raise HTTPException(409, "Semua impulse response harus selesai diunggah sebelum template disimpan")
    existing = await db.vst_maker_templates.find_one({"source_project_id": project_id}, {"_id": 0})
    template = _vst_maker_template_document(project, existing)
    await db.vst_maker_templates.update_one(
        {"source_project_id": project_id},
        {"$set": template},
        upsert=True,
    )
    return template


@admin_router.put("/vst-maker/templates/{template_id}/projects/{project_id}")
async def update_admin_vst_maker_template(template_id: str, project_id: str):
    """Replace an existing gallery template while retaining its stable identity."""
    existing = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0})
    is_builtin = template_id in VST_MAKER_BUILT_IN_TEMPLATE_IDS
    if not existing and not is_builtin:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": {"$exists": False}}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = await _project_sample_assets(project_id, project.get("owner_customer_id"))
    if len(_matching_sample_assets(project, assets)) != len(project.get("samples") or []):
        raise HTTPException(409, "Semua sample harus selesai diunggah sebelum template diperbarui")
    if len(_matching_impulse_assets(project, assets)) != len(project.get("impulse_responses") or []):
        raise HTTPException(409, "Semua impulse response harus selesai diunggah sebelum template diperbarui")
    template_source = {**(existing or {}), "source_project_id": project_id}
    template = _vst_maker_template_document(project, template_source, template_id=template_id)
    template_settings_collection = getattr(db, "vst_maker_template_settings", None)
    thumbnail_setting = await template_settings_collection.find_one(
        {"template_id": template_id},
        {"_id": 0, "thumbnail_url": 1, "thumbnail_name": 1, "thumbnail_public_id": 1},
    ) if template_settings_collection is not None else None
    if thumbnail_setting and thumbnail_setting.get("thumbnail_url"):
        template.update({
            key: thumbnail_setting.get(key)
            for key in ("thumbnail_url", "thumbnail_name", "thumbnail_public_id")
            if thumbnail_setting.get(key) is not None
        })
    await db.vst_maker_templates.update_one(
        {"id": template_id},
        {"$set": template},
        upsert=is_builtin,
    )
    return template


async def _list_template_assets(template_id: str, impulse: bool = False) -> list[dict]:
    template = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0})
    if not template:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    project = template.get("project") or {}
    project_assets = project.get("impulse_responses" if impulse else "samples") or []
    if not project_assets:
        return []
    _template, _source, assets = await _template_project_and_assets(template_id)
    matches = _matching_impulse_assets(project, assets) if impulse else _matching_sample_assets(project, assets)
    public = _public_impulse_asset if impulse else _public_sample_asset
    return [public(asset) for asset in matches.values()]


@admin_router.get("/vst-maker/templates/{template_id}/samples")
async def list_admin_vst_template_samples(template_id: str):
    return await _list_template_assets(template_id)


@admin_router.get("/vst-maker/templates/{template_id}/samples/{sample_id}/preview")
async def preview_admin_vst_template_sample(template_id: str, sample_id: str):
    _template, source, _assets = await _template_project_and_assets(template_id)
    return await _preview_project_sample(source, sample_id)


@admin_router.get("/vst-maker/templates/{template_id}/impulse-responses")
async def list_admin_vst_template_impulses(template_id: str):
    return await _list_template_assets(template_id, impulse=True)


@admin_router.get("/vst-maker/templates/{template_id}/impulse-responses/{impulse_id}/preview")
async def preview_admin_vst_template_impulse(template_id: str, impulse_id: str):
    _template, source, _assets = await _template_project_and_assets(template_id)
    return await _preview_project_impulse(source, impulse_id)


@admin_router.post("/vst-maker/templates/{template_id}/thumbnail")
async def upload_admin_vst_maker_template_thumbnail(template_id: str, file: UploadFile = File(...)):
    template = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0})
    is_builtin = template_id in VST_MAKER_BUILT_IN_TEMPLATE_IDS
    if not template and not is_builtin:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    uploaded = await _upload_vst_image(file, "tripleside/vst-template-thumbnails")
    thumbnail_fields = {
        "thumbnail_url": uploaded.get("url"),
        "thumbnail_name": file.filename or "vst-thumbnail",
        "thumbnail_public_id": uploaded.get("public_id"),
        "updated_at": now_iso(),
    }
    if is_builtin:
        await db.vst_maker_template_settings.update_one(
            {"template_id": template_id},
            {"$set": {"template_id": template_id, **thumbnail_fields}},
            upsert=True,
        )
        return {"template_id": template_id, **thumbnail_fields}
    updated = await db.vst_maker_templates.find_one_and_update(
        {"id": template_id},
        {"$set": thumbnail_fields},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    return updated


@admin_router.delete("/vst-maker/templates/{template_id}", status_code=204)
async def delete_admin_vst_maker_template(
    template_id: str,
    confirm_name: str = Query(..., min_length=1, max_length=160),
    confirm_scope: Literal["built_in", "admin"] = Query(...),
):
    if template_id in VST_MAKER_BUILT_IN_TEMPLATE_IDS:
        if confirm_scope != "built_in" or confirm_name.strip() != VST_MAKER_BUILT_IN_TEMPLATE_NAMES[template_id]:
            raise HTTPException(409, "Konfirmasi template tidak cocok. Muat ulang halaman sebelum mencoba lagi.")
        await db.vst_maker_template_settings.update_one(
            {"template_id": template_id},
            {"$set": {"template_id": template_id, "hidden": True, "updated_at": now_iso()}},
            upsert=True,
        )
        return Response(status_code=204)
    template = await db.vst_maker_templates.find_one({"id": template_id}, {"_id": 0, "name": 1})
    if not template:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    if confirm_scope != "admin" or confirm_name.strip() != template.get("name"):
        raise HTTPException(409, "Konfirmasi template tidak cocok. Muat ulang halaman sebelum mencoba lagi.")
    result = await db.vst_maker_templates.delete_one({"id": template_id})
    if not result.deleted_count:
        raise HTTPException(404, "Template VST Maker tidak ditemukan")
    return Response(status_code=204)


@admin_router.post("/vst-maker/templates/{template_id}/restore")
async def restore_admin_vst_maker_template(template_id: str):
    if template_id not in VST_MAKER_BUILT_IN_TEMPLATE_IDS:
        raise HTTPException(404, "Template bawaan VST Maker tidak ditemukan")
    await db.vst_maker_template_settings.update_one(
        {"template_id": template_id},
        {"$set": {"template_id": template_id, "hidden": False, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"template_id": template_id, "hidden": False}


@admin_router.get("/vst-maker/storage")
async def get_vst_maker_storage_status():
    used = await _r2_usage_bytes()
    return {
        "used_bytes": used,
        "warning_bytes": R2_WARNING_BYTES,
        "upload_stop_bytes": R2_UPLOAD_STOP_BYTES,
        "warning": used >= R2_WARNING_BYTES,
        "uploads_blocked": used >= R2_UPLOAD_STOP_BYTES,
    }


@admin_router.post("/vst-maker/projects", status_code=201)
async def create_vst_maker_project(body: VstMakerProjectInput):
    timestamp = now_iso()
    project = body.model_dump()
    project.update({
        "id": str(uuid.uuid4()),
        "status": "draft",
        "created_at": timestamp,
        "updated_at": timestamp,
    })
    project["pricing_template_baseline"] = await _resolve_template_pricing_baseline(project)
    await db.vst_maker_projects.insert_one(dict(project))
    return project


@admin_router.get("/vst-maker/projects/{project_id}/build-spec")
async def get_vst_maker_build_spec(project_id: str):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = await _project_sample_assets(project_id, project.get("owner_customer_id"))
    return _ready_build_spec(project, assets, require_uploaded=True)


@admin_router.get("/vst-maker/projects/{project_id}/samples")
async def list_vst_maker_sample_assets(project_id: str):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = _matching_sample_assets(
        project,
        await _project_sample_assets(project_id, project.get("owner_customer_id")),
    )
    return [_public_sample_asset(asset) for asset in assets.values()]


@admin_router.post("/vst-maker/projects/{project_id}/samples/{sample_id}")
async def upload_vst_maker_sample(project_id: str, sample_id: str, file: UploadFile = File(...)):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _upload_project_sample(project, sample_id, file)


@admin_router.get("/vst-maker/projects/{project_id}/samples/{sample_id}/preview")
async def preview_vst_maker_sample(project_id: str, sample_id: str):
    project = await db.vst_maker_projects.find_one(
        {"id": project_id}, {"_id": 0, "id": 1, "owner_customer_id": 1}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _preview_project_sample(project, sample_id)


@admin_router.delete("/vst-maker/projects/{project_id}/samples/{sample_id}", status_code=204)
async def delete_vst_maker_sample(project_id: str, sample_id: str):
    project = await db.vst_maker_projects.find_one(
        {"id": project_id}, {"_id": 0, "id": 1, "owner_customer_id": 1}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_sample(project, sample_id)
    return Response(status_code=204)


@admin_router.get("/vst-maker/projects/{project_id}/impulse-responses")
async def list_vst_maker_impulse_assets(project_id: str):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = _matching_impulse_assets(
        project,
        await _project_sample_assets(project_id, project.get("owner_customer_id")),
    )
    return [_public_impulse_asset(asset) for asset in assets.values()]


@admin_router.post("/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}")
async def upload_vst_maker_impulse(project_id: str, impulse_id: str, file: UploadFile = File(...)):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _upload_project_impulse(project, impulse_id, file)


@admin_router.get("/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}/preview")
async def preview_vst_maker_impulse(project_id: str, impulse_id: str):
    project = await db.vst_maker_projects.find_one(
        {"id": project_id}, {"_id": 0, "id": 1, "owner_customer_id": 1}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _preview_project_impulse(project, impulse_id)


@admin_router.delete("/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}", status_code=204)
async def delete_vst_maker_impulse(project_id: str, impulse_id: str):
    project = await db.vst_maker_projects.find_one(
        {"id": project_id}, {"_id": 0, "id": 1, "owner_customer_id": 1}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_impulse(project, impulse_id)
    return Response(status_code=204)


@admin_router.get("/vst-maker/projects/{project_id}/builds")
async def list_vst_maker_builds(project_id: str):
    if not await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    jobs = await db.vst_maker_build_jobs.find(
        {"project_id": project_id}, {"_id": 0, "spec_snapshot": 0, "artifact_storage_key": 0}
    ).sort("created_at", -1).to_list(50)
    return [_public_build_job(job) for job in jobs]


@admin_router.post("/vst-maker/projects/{project_id}/builds", status_code=202)
async def enqueue_vst_maker_build(
    project_id: str,
    body: CustomerVstBuildRequest | None = None,
    admin_email: str = Depends(verify_admin),
):
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = await _project_sample_assets(project_id, project.get("owner_customer_id"))
    job, duplicate = await _enqueue_vst_build(
        project, assets, f"admin:{admin_email}",
        force_correction_rebuild=bool(body and body.force_correction_rebuild),
        target_platform=body.target_platform if body else "windows",
    )
    return {**_public_build_job(job), "duplicate": duplicate}


@admin_router.post("/vst-maker/builds/{job_id}/cancel")
async def cancel_vst_maker_build(job_id: str):
    return await _cancel_vst_build({"id": job_id})


@admin_router.post("/vst-maker/builds/{job_id}/retry")
async def retry_vst_maker_build(job_id: str):
    return await _retry_vst_build({"id": job_id})


@admin_router.get("/vst-maker/builds/{job_id}/download")
async def download_vst_maker_build(job_id: str):
    return await _artifact_download({"id": job_id})


@admin_router.put("/vst-maker/projects/{project_id}")
async def update_vst_maker_project(project_id: str, body: VstMakerProjectInput):
    existing = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Project instrumen tidak ditemukan")

    updates = body.model_dump()
    updates["pricing_template_baseline"] = await _resolve_template_pricing_baseline(updates, existing)
    updates["updated_at"] = now_iso()
    await db.vst_maker_projects.update_one({"id": project_id}, {"$set": updates})
    project = await db.vst_maker_projects.find_one({"id": project_id}, {"_id": 0})
    await _remove_orphaned_sample_assets(project)
    return project


@admin_router.delete("/vst-maker/projects/{project_id}", status_code=204)
async def delete_vst_maker_project(project_id: str):
    # Admin projects do not have owner_customer_id. Include the required id in
    # the projection so Motor returns a truthy document instead of {}.
    project = await db.vst_maker_projects.find_one(
        {"id": project_id}, {"_id": 0, "id": 1, "owner_customer_id": 1}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    if await db.vst_maker_templates.find_one(
        {"source_project_id": project_id}, {"_id": 0, "id": 1}
    ):
        raise HTTPException(409, "Project ini adalah sumber template. Hapus template terlebih dahulu.")
    await _cancel_project_builds(project_id, project.get("owner_customer_id"))
    result = await db.vst_maker_projects.delete_one({"id": project_id})
    if not result.deleted_count:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_sample_assets(project_id, project.get("owner_customer_id"))
    await _delete_project_builds(project_id, project.get("owner_customer_id"))
    if project.get("owner_customer_id"):
        await _release_customer_project_slot(project["owner_customer_id"], project_id)
    return Response(status_code=204)


@customer_router.get("/customer/vst-maker/entitlements")
async def get_customer_vst_entitlements(customer_id: str = Depends(verify_customer)):
    return await customer_vst_entitlement(customer_id)


@customer_router.get("/customer/vst-maker/templates")
async def list_customer_vst_maker_templates(customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await db.vst_maker_templates.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)


@customer_router.get("/vst-maker/templates/catalog")
async def list_public_vst_maker_template_catalog():
    """Public, presentation-only template data used by the VST Maker landing page."""
    documents = await db.vst_maker_templates.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    settings = await db.vst_maker_template_settings.find(
        {}, {"_id": 0, "template_id": 1, "thumbnail_url": 1, "hidden": 1, "sort_order": 1}
    ).to_list(200)
    templates = []
    for document in documents:
        project = document.get("project") or {}
        templates.append({
            "id": document.get("id"),
            "name": document.get("name"),
            "description": document.get("description"),
            "template_category": document.get("template_category"),
            "plugin_kind": document.get("plugin_kind"),
            "instrument_type": document.get("instrument_type"),
            "symbol": document.get("symbol"),
            "accent_color": document.get("accent_color"),
            "background_url": document.get("background_url"),
            "thumbnail_url": document.get("thumbnail_url"),
            "brand_tagline": document.get("brand_tagline"),
            "highlights": document.get("highlights") or [],
            "keyboard_keys": project.get("keyboard_keys"),
            "built_in_template": bool(document.get("built_in_template")),
        })
    return {"templates": templates, "settings": settings}


@customer_router.get("/customer/vst-maker/templates/{template_id}/samples")
async def list_customer_vst_template_samples(
    template_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    return await _list_template_assets(template_id)


@customer_router.get("/customer/vst-maker/templates/{template_id}/samples/{sample_id}/preview")
async def preview_customer_vst_template_sample(
    template_id: str, sample_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    _template, source, _assets = await _template_project_and_assets(template_id)
    return await _preview_project_sample(source, sample_id)


@customer_router.get("/customer/vst-maker/templates/{template_id}/impulse-responses")
async def list_customer_vst_template_impulses(
    template_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    return await _list_template_assets(template_id, impulse=True)


@customer_router.get("/customer/vst-maker/templates/{template_id}/impulse-responses/{impulse_id}/preview")
async def preview_customer_vst_template_impulse(
    template_id: str, impulse_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    _template, source, _assets = await _template_project_and_assets(template_id)
    return await _preview_project_impulse(source, impulse_id)


@customer_router.get("/customer/vst-maker/template-settings")
async def list_customer_vst_maker_template_settings(customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await db.vst_maker_template_settings.find(
        {}, {"_id": 0, "template_id": 1, "thumbnail_url": 1, "hidden": 1, "sort_order": 1}
    ).to_list(200)


@customer_router.get("/customer/vst-maker/build-settings")
async def get_customer_vst_maker_build_settings(customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await _load_vst_maker_build_settings()


@customer_router.post("/customer/vst-maker/presence")
async def update_customer_vst_maker_presence(
    body: VstMakerPresenceInput, customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    current = datetime.now(timezone.utc)
    expires_at = current + timedelta(seconds=45)
    await db.vst_maker_presence.update_one(
        {"customer_id": customer_id},
        {"$set": {
            "customer_id": customer_id,
            "project_id": body.project_id,
            "project_name": body.project_name,
            "editor_tab": body.editor_tab,
            "last_seen_at": current,
            "expires_at": expires_at,
        }},
        upsert=True,
    )
    return {"online": True, "expires_at": expires_at.isoformat()}


@customer_router.delete("/customer/vst-maker/presence", status_code=204)
async def clear_customer_vst_maker_presence(customer_id: str = Depends(verify_customer)):
    await db.vst_maker_presence.delete_one({"customer_id": customer_id})
    return Response(status_code=204)


def _validate_customer_features(body: VstMakerProjectInput, entitlement: dict):
    if "premium_templates" not in entitlement.get("features", []):
        if body.project_template in {"premiumkeys", "regentstrip", "regentwhite", "mixforge", "vintageeq", "velofet", "azureeq", "prismeq", "modernreverb", "moderndelay", "modernsaturation"} or body.ui_template in {"aurum", "mixforge"}:
            raise HTTPException(403, "Template premium tidak tersedia pada paket ini")
        built_in_background = BUILT_IN_TEMPLATE_BACKGROUNDS.get(body.project_template)
        allowed_backgrounds = {built_in_background, *BUILT_IN_TEMPLATE_BACKGROUND_ALIASES.get(body.project_template, set())}
        if body.background_image_url and body.background_image_url not in allowed_backgrounds:
            raise HTTPException(403, "Background kustom tidak tersedia pada paket ini")


@customer_router.get("/customer/vst-maker/projects")
async def list_customer_vst_projects(
    limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0),
    customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    return await db.vst_maker_projects.find(
        {"owner_customer_id": customer_id}, {"_id": 0}
    ).sort("updated_at", -1).skip(offset).to_list(limit)


@customer_router.post("/customer/vst-maker/background")
async def upload_customer_vst_background(file: UploadFile = File(...), customer_id: str = Depends(verify_customer)):
    entitlement = await _require_customer_maker(customer_id)
    if "custom_backgrounds" not in entitlement["features"]:
        raise HTTPException(403, "Upload background tidak tersedia pada paket ini")
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(400, "Background harus berupa JPG, PNG, atau WebP")
    if not CLOUDINARY_CONFIGURED:
        raise HTTPException(503, "Penyimpanan gambar belum dikonfigurasi")
    file_size = file.size
    if file_size is None:
        position = file.file.tell()
        file.file.seek(0, 2)
        file_size = file.file.tell()
        file.file.seek(position)
    if not file_size or file_size > MAX_BACKGROUND_BYTES:
        raise HTTPException(413, "Ukuran background harus di antara 1 byte dan 10 MB")
    return await upload_file_stream(file.file, file.filename or "vst-background", folder=f"vst-backgrounds/{customer_id}")


@customer_router.post("/customer/vst-maker/images")
async def upload_customer_vst_maker_image(file: UploadFile = File(...), customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await _upload_vst_image(file, f"tripleside/vst-component-images/{customer_id}")


@customer_router.post("/customer/vst-maker/projects", status_code=201)
async def create_customer_vst_project(body: VstMakerProjectInput, customer_id: str = Depends(verify_customer)):
    entitlement = await _require_customer_maker(customer_id)
    _validate_customer_features(body, entitlement)
    timestamp = now_iso()
    project = body.model_dump()
    project_id = str(uuid.uuid4())
    project_limit = entitlement["project_limit"]
    project_slot = None
    if project_limit:
        project_slot = await _reserve_customer_project_slot(
            customer_id, project_id, project_limit, entitlement["tier"]
        )
    project.update({"id": project_id, "owner_customer_id": customer_id, "status": "draft", "created_at": timestamp, "updated_at": timestamp})
    project["pricing_template_baseline"] = await _resolve_template_pricing_baseline(project)
    if project_slot:
        project["project_slot"] = project_slot
    try:
        await db.vst_maker_projects.insert_one(dict(project))
        await _inherit_template_assets(project)
    except Exception:
        await db.vst_maker_sample_assets.delete_many({
            "project_id": project_id, "owner_customer_id": customer_id
        })
        await db.vst_maker_projects.delete_one({"id": project_id, "owner_customer_id": customer_id})
        if project_slot:
            await _release_customer_project_slot(customer_id, project_id)
        raise
    return project


@customer_router.get("/customer/vst-maker/projects/{project_id}/build-spec")
async def get_customer_vst_build_spec(project_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = await _project_sample_assets(project_id, customer_id)
    return _ready_build_spec(project, assets, require_uploaded=True)


@customer_router.get("/customer/vst-maker/projects/{project_id}/build-quote")
async def get_customer_vst_build_quote(
    project_id: str,
    force_correction_rebuild: bool = False,
    target_platform: Literal["windows", "macos"] = "windows",
    customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    business_access = await _customer_business_build_access(customer_id, project_id, target_platform)
    project = await _with_template_pricing_baseline(project)
    settings = await _load_vst_maker_build_settings()
    quote, activations = _customer_build_plan_quote(project, settings, business_access)
    assets = await _project_sample_assets(project_id, customer_id)
    spec = _ready_build_spec(project, assets, require_uploaded=True)
    spec["build"]["platforms"] = [target_platform]
    builds_used, build_limit = await business_build_usage(db, business_access)
    builds_remaining = None if build_limit is None else max(0, build_limit - builds_used)
    can_build = build_limit is None or builds_remaining > 0
    return {
        "billing": "one_time_plan",
        "included": True,
        "can_build": can_build,
        "plan_id": business_access.get("plan_id"),
        "plan_name": business_access.get("plan_name"),
        "business_entitlement_id": business_access.get("id"),
        "target_platform": target_platform,
        "license_enabled": True,
        "license_max_activations": activations,
        "build_limit": build_limit,
        "builds_used": builds_used,
        "builds_remaining": builds_remaining,
        "reasons": [] if can_build else [f"Kuota {build_limit} build paket ini sudah habis"],
    }


@customer_router.get("/customer/vst-maker/projects/{project_id}/samples")
async def list_customer_vst_sample_assets(project_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = _matching_sample_assets(project, await _project_sample_assets(project_id, customer_id))
    return [_public_sample_asset(asset) for asset in assets.values()]


@customer_router.post("/customer/vst-maker/projects/{project_id}/samples/{sample_id}")
async def upload_customer_vst_sample(
    project_id: str,
    sample_id: str,
    file: UploadFile = File(...),
    customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _upload_project_sample(project, sample_id, file)


@customer_router.get("/customer/vst-maker/projects/{project_id}/samples/{sample_id}/preview")
async def preview_customer_vst_sample(project_id: str, sample_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id},
        {"_id": 0, "id": 1, "owner_customer_id": 1},
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _preview_project_sample(project, sample_id)


@customer_router.delete("/customer/vst-maker/projects/{project_id}/samples/{sample_id}", status_code=204)
async def delete_customer_vst_sample(project_id: str, sample_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id},
        {"_id": 0, "id": 1, "owner_customer_id": 1},
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_sample(project, sample_id)
    return Response(status_code=204)


@customer_router.get("/customer/vst-maker/projects/{project_id}/impulse-responses")
async def list_customer_vst_impulse_assets(project_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    assets = _matching_impulse_assets(project, await _project_sample_assets(project_id, customer_id))
    return [_public_impulse_asset(asset) for asset in assets.values()]


@customer_router.post("/customer/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}")
async def upload_customer_vst_impulse(
    project_id: str,
    impulse_id: str,
    file: UploadFile = File(...),
    customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _upload_project_impulse(project, impulse_id, file)


@customer_router.get("/customer/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}/preview")
async def preview_customer_vst_impulse(
    project_id: str, impulse_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id},
        {"_id": 0, "id": 1, "owner_customer_id": 1},
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    return await _preview_project_impulse(project, impulse_id)


@customer_router.delete("/customer/vst-maker/projects/{project_id}/impulse-responses/{impulse_id}", status_code=204)
async def delete_customer_vst_impulse(
    project_id: str, impulse_id: str, customer_id: str = Depends(verify_customer)
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id},
        {"_id": 0, "id": 1, "owner_customer_id": 1},
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_impulse(project, impulse_id)
    return Response(status_code=204)


@customer_router.get("/customer/vst-maker/projects/{project_id}/builds")
async def list_customer_vst_builds(project_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    if not await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0, "id": 1}
    ):
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    jobs = await db.vst_maker_build_jobs.find(
        {"project_id": project_id, "owner_customer_id": customer_id},
        {"_id": 0, "spec_snapshot": 0, "artifact_storage_key": 0},
    ).sort("created_at", -1).to_list(50)
    return [_public_build_job(job) for job in jobs]


@customer_router.post("/customer/vst-maker/projects/{project_id}/builds", status_code=202)
async def enqueue_customer_vst_build(
    project_id: str,
    body: CustomerVstBuildRequest | None = None,
    customer_id: str = Depends(verify_customer),
):
    await _require_customer_maker(customer_id)
    project = await db.vst_maker_projects.find_one(
        {"id": project_id, "owner_customer_id": customer_id}, {"_id": 0}
    )
    if not project:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    target_platform = body.target_platform if body else "windows"
    business_access = await _customer_business_build_access(customer_id, project_id, target_platform)
    assets = await _project_sample_assets(project_id, customer_id)
    job, duplicate = await _enqueue_vst_build(
        project, assets, f"customer:{customer_id}",
        business_access=business_access,
        billing_tier=str(business_access.get("plan_id") or "partner"),
        force_correction_rebuild=bool(body and body.force_correction_rebuild),
        target_platform=target_platform,
    )
    return {**_public_build_job(job), "duplicate": duplicate}


@customer_router.post("/customer/vst-maker/builds/{job_id}/cancel")
async def cancel_customer_vst_build(job_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await _cancel_vst_build({"id": job_id, "owner_customer_id": customer_id})


@customer_router.post("/customer/vst-maker/builds/{job_id}/retry")
async def retry_customer_vst_build(job_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    existing = await db.vst_maker_build_jobs.find_one(
        {"id": job_id, "owner_customer_id": customer_id},
        {"_id": 0, "project_id": 1, "target_platform": 1},
    )
    if not existing:
        raise HTTPException(404, "Build tidak ditemukan")
    await _customer_business_build_access(
        customer_id,
        str(existing.get("project_id") or ""),
        str(existing.get("target_platform") or "windows"),
    )
    return await _retry_vst_build({"id": job_id, "owner_customer_id": customer_id})


@customer_router.get("/customer/vst-maker/builds/{job_id}/download")
async def download_customer_vst_build(job_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    return await _artifact_download({"id": job_id, "owner_customer_id": customer_id})


@customer_router.put("/customer/vst-maker/projects/{project_id}")
async def update_customer_vst_project(project_id: str, body: VstMakerProjectInput, customer_id: str = Depends(verify_customer)):
    entitlement = await _require_customer_maker(customer_id)
    _validate_customer_features(body, entitlement)
    query = {"id": project_id, "owner_customer_id": customer_id}
    existing = await db.vst_maker_projects.find_one(query, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    updates = body.model_dump()
    updates["pricing_template_baseline"] = await _resolve_template_pricing_baseline(updates, existing)
    updates["updated_at"] = now_iso()
    await db.vst_maker_projects.update_one(query, {"$set": updates})
    project = await db.vst_maker_projects.find_one(query, {"_id": 0})
    await _remove_orphaned_sample_assets(project)
    return project


@customer_router.delete("/customer/vst-maker/projects/{project_id}", status_code=204)
async def delete_customer_vst_project(project_id: str, customer_id: str = Depends(verify_customer)):
    await _require_customer_maker(customer_id)
    await _cancel_project_builds(project_id, customer_id)
    result = await db.vst_maker_projects.delete_one({"id": project_id, "owner_customer_id": customer_id})
    if not result.deleted_count:
        raise HTTPException(404, "Project instrumen tidak ditemukan")
    await _delete_project_sample_assets(project_id, customer_id)
    await _delete_project_builds(project_id, customer_id)
    await _release_customer_project_slot(customer_id, project_id)
    return Response(status_code=204)
