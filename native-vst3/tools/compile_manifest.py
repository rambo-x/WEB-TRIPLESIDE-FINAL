#!/usr/bin/env python3
"""Compile a normalized VST Maker project into a dependency-free C++ manifest."""
from __future__ import annotations
import argparse, hashlib, json, math, re
from pathlib import Path

NORMALIZED_DSP_PARAMETERS = {
    "tuning": {"tuning", "fine_tune"},
    "wave_generator": {
        "waveform", "octave", "semitone", "fine", "level", "pulse_width", "phase_reset", "voice_mode", "retrigger",
        "attack", "decay", "sustain", "release", "filter_cutoff", "filter_resonance",
        "velocity_sensitivity", "velocity_curve", "velocity_min_level",
        "filter_env_amount", "filter_key_tracking", "osc2_enabled", "osc2_waveform", "osc2_octave",
        "osc2_detune", "osc2_level", "osc2_pulse_width", "sub_level", "noise_level",
        "noise_color", "unison_voices", "unison_detune", "stereo_spread", "glide",
        "glide_mode", "vibrato_rate", "vibrato_depth", "vibrato_delay",
    },
    "input_trim": {"normalized", "value", "amount", "input", "gain"},
    "soft_clip": {"normalized", "value", "amount", "drive", "character", "output"},
    "linked_compressor": {"normalized", "value", "amount", "compress", "threshold", "ratio", "attack", "release", "makeup"},
    "de_esser": {"normalized", "value", "amount", "frequency", "threshold", "range", "attack", "release"},
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
    "output_trim": {"normalized", "value", "amount", "output", "gain"},
}
SPECIAL_DSP_PARAMETERS = {"input_trim": {"gain_db"}, "output_trim": {"gain_db"}}

def fail(message: str) -> None: raise SystemExit(f"error: {message}")
def cpp_string(value: object) -> str: return json.dumps(str(value or ""), ensure_ascii=True)
def cpp_float(value: object, fallback: float = 0.0) -> str:
    try: number = float(value)
    except (TypeError, ValueError): number = fallback
    rendered = f"{number:.9g}"
    if "." not in rendered and "e" not in rendered.lower(): rendered += ".0"
    return rendered + "f"
def clamp(value: object, low: float, high: float, fallback: float) -> float:
    try: return min(high, max(low, float(value)))
    except (TypeError, ValueError): return fallback
def cpp_bool(value: object) -> str: return "true" if bool(value) else "false"
def label_position(value: object) -> str:
    normalized = str(value or "top-left")
    supported = {
        "top-left", "top-center", "top-right",
        "bottom-left", "bottom-center", "bottom-right",
    }
    return normalized if normalized in supported else "top-left"

def rc_string(value: str) -> str:
    return value.replace('"', '""')

def write_resource_script(spec_path: Path, output_path: Path) -> list[Path]:
    """Generate a Windows RCDATA table so the module owns every runtime asset."""
    runtime_root = Path(__file__).resolve().parents[1]
    workspace_root = runtime_root.parent
    candidates = [spec_path.resolve()]
    candidates.extend(sorted((spec_path.parent / "assets").glob("*")))
    candidates.extend(sorted((runtime_root / "Assets").glob("*.png")))
    candidates.extend(sorted((runtime_root / "Assets/fonts").glob("*.ttf")))
    candidates.extend(sorted((workspace_root / "frontend/public/images/vst-knobs").glob("*-v2.png")))

    resources: dict[str, Path] = {}
    for candidate in candidates:
        if not candidate.is_file():
            continue
        name = candidate.name
        previous = resources.get(name)
        if previous and previous.resolve() != candidate.resolve():
            fail(f"embedded resources have a duplicate filename: {name}")
        resources[name] = candidate.resolve()

    lines = ["// Generated by compile_manifest.py. Do not edit.", "#include <windows.h>"]
    for name, path in sorted(resources.items()):
        lines.append(f'"{rc_string(name)}" RCDATA "{rc_string(path.as_posix())}"')
    output_path.with_name("NativeAssets.rc").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return list(resources.values())
def control_default(spec: dict, parameter: str, fallback: float) -> float:
    controls = [control for control in ((spec.get("interface") or {}).get("controls") or [])
                if isinstance(control, dict) and control.get("parameter") == parameter]
    # Legacy drum pads carry a `tone` trigger binding and value 0. Prefer a
    # real macro control (the Neon template's Drive knob) for DSP defaults.
    for control in controls:
        if control.get("kind") not in {"pad", "keyboard", "gain_meter", "vu_meter", "visual", "spectrum", "text", "image"}:
            return clamp(control.get("value"), 0, 100, fallback) / 100
    for control in controls:
        return clamp(control.get("value"), 0, 100, fallback) / 100
    return fallback / 100

def control_setting(spec: dict, parameter: str, field: str, low: float, high: float, fallback: float) -> float:
    controls = [control for control in ((spec.get("interface") or {}).get("controls") or [])
                if isinstance(control, dict) and control.get("parameter") == parameter]
    for control in controls:
        if control.get("kind") not in {"pad", "keyboard", "gain_meter", "vu_meter", "visual", "spectrum", "text", "image"}:
            return clamp(control.get(field), low, high, fallback)
    return fallback

def has_parameter_control(spec: dict, parameter: str) -> bool:
    return any(isinstance(control, dict) and control.get("parameter") == parameter
               and control.get("kind") not in {"spectrum", "visual", "text", "image"}
               for control in ((spec.get("interface") or {}).get("controls") or []))

MAX_DSP_PARAMETERS_PER_MODULE = 48


def compile_manifest(spec_path: Path, output_path: Path) -> None:
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    is_effect = spec.get("plugin_kind") == "effect"
    is_neon_drums = spec.get("project_template") == "neonpopdrums"
    source_dsp_modules = spec.get("engine_modules") or spec.get("dsp_graph", {}).get("modules") or []
    has_prism_module = any(str(module.get("type") or "").replace("-", "_") == "prism_eq" for module in source_dsp_modules)
    is_prism_eq = is_effect and not has_prism_module and (spec.get("dsp_profile") == "prism_eq" or spec.get("project_template") == "prismeq")
    samples, zones = spec.get("samples") or [], spec.get("sampler_map") or []
    impulses = spec.get("impulse_responses") or []
    groups = [] if is_effect else (spec.get("sampler_groups") or [{"id": "sampler-1", "name": "Sampler 1"}])
    interface = spec.get("interface") or {}; controls = interface.get("controls") or []
    prism_contextual_enabled = any(
        str(control.get("kind") or "") == "spectrum"
        and str(control.get("component_variant") or "realtime-spectrum") == "realtime-spectrum"
        and str(control.get("prism_control_mode") or "direct") == "contextual"
        for control in controls
    )
    presets = spec.get("presets") or []
    # Legacy MIDI CC maps are intentionally ignored. The panel is now a groove browser.
    midi_mappings = []
    midi_sequences = spec.get("midi_sequences") or []
    dsp_graph = spec.get("dsp_graph") or {"version": 2, "mode": "ordered_rack", "source": "legacy_spec", "modules": []}
    dsp_modules = dsp_graph.get("modules") or []
    prism_module_index = next((index for index, module in enumerate(dsp_modules) if str(module.get("type") or "").replace("-", "_") == "prism_eq"), -1)
    prism_module = dsp_modules[prism_module_index] if prism_module_index >= 0 else {}
    prism_parameters = prism_module.get("parameters") or {}
    if dsp_graph.get("version") != 2:
        fail("native VST3 requires DSP graph contract version 2")
    if dsp_graph.get("mode") not in {"ordered_rack", "instrument_post_fx", "instrument_sources", "instrument_serial_rack"}:
        fail("native VST3 received an unsupported DSP graph mode")
    if is_effect:
        if samples or zones: fail("native audio effect must not contain samples or mapping zones")
    elif (not samples or not zones) and not any(str(module.get("type") or "") == "wave_generator" and not module.get("bypassed", False) for module in dsp_modules):
        fail("native VST3 instrument requires a sample mapping or an active wave generator")
    ordinary_controls = [control for control in controls if str(control.get("parameter") or "") not in {"prism_frequency", "prism_gain", "prism_q"}]
    if len(samples) > 128 or len(zones) > 128 or len(groups) > 16 or len(ordinary_controls) > 96 or len(controls) > 99 or len(dsp_modules) > 128 or len(impulses) > 16 or len(presets) > 128 or len(midi_mappings) > 128 or len(midi_sequences) > 16: fail("native VST3 project exceeds a supported collection limit")

    dsp_module_ids = {}
    for index, module in enumerate(dsp_modules):
        module_id = str(module.get("id") or "").strip()
        if not module_id or module_id in dsp_module_ids:
            fail("DSP module ids must be present and unique")
        dsp_module_ids[module_id] = index
    macro_bindings = {
        "input": ("input_trim", "input"),
        "drive": ("soft_clip", "drive"),
        "compress": ("linked_compressor", "compress"),
        "gain_reduction": ("linked_compressor", "compress"),
        "tone": ("tone_shaper", "tone"),
        "width": ("stereo_width", "width"),
        "space": ("cross_delay", "space"),
        "mix": ("dry_wet", "mix"),
        "output": ("output_trim", "output"),
    }
    macro_module_indices = {}
    for parameter, (module_type, module_parameter) in macro_bindings.items():
        macro_module_indices[parameter] = next((
            index for index, module in enumerate(dsp_modules)
            if str(module.get("type") or "").strip() == module_type
        ), -1)
    dsp_module_lines, dsp_parameter_lines = [], []
    for index, module in enumerate(dsp_modules):
        module_type = str(module.get("type") or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", module_type):
            fail("DSP module type is invalid")
        parent_id = module.get("parentId")
        if parent_id and str(parent_id) not in dsp_module_ids:
            fail("DSP module references an unknown parent")
        parent_index = dsp_module_ids.get(str(parent_id), -1) if parent_id else -1
        parameters = module.get("parameters") or {}
        if len(parameters) > MAX_DSP_PARAMETERS_PER_MODULE:
            fail("DSP module exceeds the supported parameter limit")
        parameter_offset = len(dsp_parameter_lines)
        for key, value in parameters.items():
            parameter_key = str(key or "").strip()
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,47}", parameter_key):
                fail("DSP module parameter name is invalid")
            numeric_value = float(value)
            if not math.isfinite(numeric_value) or abs(numeric_value) > 1_000_000:
                fail("DSP module parameter value is invalid")
            if module_type in NORMALIZED_DSP_PARAMETERS:
                supported = NORMALIZED_DSP_PARAMETERS[module_type] | SPECIAL_DSP_PARAMETERS.get(module_type, set())
                if parameter_key not in supported:
                    fail(f"DSP module {module_id} has unsupported parameter {parameter_key}")
                if parameter_key == "gain_db":
                    if not -120.0 <= numeric_value <= 24.0:
                        fail("DSP gain_db parameter must be between -120 and +24 dB")
                elif not 0.0 <= numeric_value <= 1.0:
                    fail("normalized DSP module parameters must be between 0 and 1")
            dsp_parameter_lines.append(
                "    DspParameterInfo{" + ", ".join((str(index), cpp_string(parameter_key), cpp_float(numeric_value))) + "},"
            )
        dsp_module_lines.append(
            "    DspModuleInfo{" + ", ".join((
                cpp_string(module.get("id")),
                cpp_string(module_type),
                cpp_string(module.get("name") or module_type),
                str(parent_index),
                str(int(module.get("order", index))),
                cpp_bool(module.get("bypassed", False)),
                cpp_float(clamp(module.get("mix"), 0, 1, 1)),
                str(parameter_offset),
                str(len(parameters)),
            )) + "},"
        )

    impulse_lines, impulse_ids, impulse_modules = [], set(), set()
    for impulse in impulses:
        impulse_id = str(impulse.get("id") or "").strip()
        module_id = str(impulse.get("moduleId") or "").strip()
        module_index = dsp_module_ids.get(module_id, -1)
        resource_file = str(impulse.get("resource_name") or impulse.get("name") or "").strip()
        trim_start = clamp(impulse.get("trimStart"), 0, 1, 0)
        trim_end = clamp(impulse.get("trimEnd"), 0, 1, 1)
        phase_ms = clamp(impulse.get("phaseMs"), -2, 2, 0)
        if not impulse_id or impulse_id in impulse_ids or module_id in impulse_modules:
            fail("impulse response ids and module assignments must be unique")
        if module_index < 0 or str(dsp_modules[module_index].get("type") or "") != "cabinet_ir":
            fail("impulse response references an unknown cabinet_ir module")
        if not resource_file.lower().endswith(".wav") or trim_start >= trim_end:
            fail("impulse response resource or trim range is invalid")
        impulse_ids.add(impulse_id); impulse_modules.add(module_id)
        impulse_lines.append("    ImpulseResponseInfo{" + ", ".join((
            str(module_index), cpp_string(resource_file), cpp_bool(impulse.get("normalize", True)),
            cpp_bool(impulse.get("autoTrim", True)), cpp_float(trim_start), cpp_float(trim_end),
            cpp_bool(impulse.get("polarityInverted", False)), cpp_float(phase_ms),
        )) + "},")

    sample_indices, sample_lines = {}, []
    for index, sample in enumerate(samples):
        sample_id, name = str(sample.get("id") or "").strip(), str(sample.get("name") or "").strip()
        if not sample_id or sample_id in sample_indices: fail("sample ids must be present and unique")
        suffix = Path(name).suffix.lower()
        if suffix != ".wav": fail(f"native VST3 currently supports WAV only: {name}")
        sample_indices[sample_id] = index
        sample_lines.append(f"    SampleInfo{{{cpp_string(f'sample_{index:03d}{suffix}')}}},")

    group_indices, group_lines = {}, []
    for index, group in enumerate(groups):
        name = str(group.get("name") or f"Sampler {index + 1}").strip(); group_indices[name.casefold()] = index
        group_lines.append("    GroupInfo{" + ", ".join((cpp_string(group.get("id") or f"sampler-{index + 1}"), cpp_string(name), cpp_float(clamp(group.get("volume"), 0, 100, 100) / 100), cpp_float(clamp(group.get("pan"), -1, 1, 0)), cpp_bool(group.get("mute", False)), cpp_bool(group.get("solo", False)))) + "},")

    articulation_names, mic_names = [], []
    for zone in zones:
        articulation, mic = str(zone.get("articulation") or "Sustain"), str(zone.get("micPosition") or "Main")
        if articulation not in articulation_names: articulation_names.append(articulation)
        if mic not in mic_names: mic_names.append(mic)

    zone_lines, rr_sets = [], {}
    for zone in zones:
        sample_id = str(zone.get("sampleId") or "")
        if sample_id not in sample_indices: fail(f"zone references unknown sample: {sample_id}")
        root = int(zone.get("rootPitch", 60)); low = int(zone.get("lowPitch", root)); high = int(zone.get("highPitch", root))
        velocity_low = int(zone.get("velocityLow", 1)); velocity_high = int(zone.get("velocityHigh", 127))
        if not 0 <= low <= root <= high <= 127 or not 1 <= velocity_low <= velocity_high <= 127: fail("zone has an invalid pitch or velocity range")
        start = clamp(zone.get("sampleStart"), 0, 1, 0); end = clamp(zone.get("sampleEnd"), start, 1, 1)
        loop_start = clamp(zone.get("loopStart"), start, end, start); loop_end = clamp(zone.get("loopEnd"), loop_start, end, end)
        group_name = str(zone.get("groupName") or groups[0].get("name") or "Sampler 1"); group_index = group_indices.get(group_name.casefold(), 0)
        articulation, mic = str(zone.get("articulation") or "Sustain"), str(zone.get("micPosition") or "Main")
        rr_key = (group_index, articulation, mic, root, low, high, velocity_low, velocity_high); rr_set = rr_sets.setdefault(rr_key, len(rr_sets))
        choke_targets = []
        for target in zone.get("chokeTargetPitches") or []:
            target_pitch = int(target)
            if not 0 <= target_pitch <= 127: fail("zone has an invalid choke target pitch")
            if target_pitch not in choke_targets: choke_targets.append(target_pitch)
        if len(choke_targets) > 16: fail("zone has more than 16 choke target pitches")
        values = (sample_indices[sample_id], group_index, articulation_names.index(articulation), mic_names.index(mic), rr_set, root, low, high, velocity_low, velocity_high, max(1, min(32, int(zone.get("roundRobin", 1)))), start, end, loop_start, loop_end, clamp(zone.get("fadeInMs"), 0, 10000, 0), clamp(zone.get("fadeOutMs"), 0, 10000, 0), clamp(zone.get("loopCrossfadeMs"), 0, 100, 8), max(-24, min(24, int(zone.get("tuneSemitones", 0)))), clamp(zone.get("tuneCents"), -1200, 1200, 0), clamp(zone.get("gainDb"), -24, 12, 0), clamp(zone.get("pan"), -1, 1, 0), bool(zone.get("loopEnabled", False)), str(zone.get("playbackMode", "sampler")) == "tempo_sync", clamp(zone.get("sourceBpm"), 20, 300, 120))
        rendered = [str(v) if isinstance(v, int) and not isinstance(v, bool) else cpp_bool(v) if isinstance(v, bool) else cpp_float(v) for v in values]
        padded_choke_targets = choke_targets + [-1] * (16 - len(choke_targets))
        rendered.extend((f"std::array<int, 16>{{{', '.join(map(str, padded_choke_targets))}}}", str(len(choke_targets))))
        zone_lines.append("    ZoneInfo{" + ", ".join(rendered) + "},")

    control_ids = [str(control.get("id") or f"control-{index + 1}") for index, control in enumerate(controls)]
    if len(control_ids) != len(set(control_ids)):
        fail("control ids must be unique")
    control_indices = {control_id: index for index, control_id in enumerate(control_ids)}
    panel_indices = {control_id: index for control_id, index in control_indices.items() if str(controls[index].get("kind") or "") == "panel_button"}
    for index, control in enumerate(controls):
        kind = str(control.get("kind") or "knob")
        parent_panel_id = str(control.get("parent_panel_id") or "")
        panel_type = str(control.get("panel_type") or "")
        meter_mode = str(control.get("meter_mode") or ("stereo" if kind == "gain_meter" else "mono"))
        if meter_mode not in {"mono", "stereo"}:
            fail("meter mode is invalid")
        if kind not in {"gain_meter", "vu_meter"} and meter_mode != "mono":
            fail("meter mode is only valid for meters")
        if kind == "panel_button" and panel_type not in {"preset_browser", "mixer", "midi_map"}:
            fail("panel button type is invalid")
        if kind != "panel_button" and panel_type:
            fail("panel type is only valid for panel buttons")
        if kind == "panel_button" and parent_panel_id:
            fail("panel buttons cannot be nested")
        if parent_panel_id and parent_panel_id not in panel_indices:
            fail("control references an unknown panel button")
    control_lines, panel_lines = [], []
    for index, control in enumerate(controls):
        label = "Control" if control.get("label") is None else control.get("label")
        off_label = label if control.get("off_label") is None else control.get("off_label")
        on_label = "ON" if control.get("on_label") is None else control.get("on_label")
        color_value = control.get("visual_color") if str(control.get("kind") or "") == "spectrum" else control.get("control_color")
        control_color_match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(color_value or ""))
        control_color_rgb = int(control_color_match.group(1), 16) if control_color_match else 0
        text_color_match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(control.get("text_color") or "#F4F4F5"))
        text_color_rgb = int(text_color_match.group(1), 16) if text_color_match else 0xF4F4F5
        control_kind = str(control.get("kind") or "knob")
        minimum_width = 240 if control_kind in {"keyboard", "spectrum"} else 32 if control_kind == "text" else 48
        minimum_height = 120 if control_kind == "spectrum" else 112 if control_kind == "keyboard" else 24 if control_kind == "text" else 48
        fields = (
            cpp_string(control.get("id") or f"control-{index + 1}"),
            cpp_string(control.get("kind") or "knob"), cpp_string(label),
            cpp_string(off_label), cpp_string(on_label),
            cpp_string(control.get("parameter") or "tone"), str(
                dsp_module_ids.get(str(control.get("module_id") or ""), macro_module_indices.get(str(control.get("parameter") or ""), -1))
            ),
            cpp_float(clamp(control.get("x"), 0, 100, 50)),
            cpp_float(clamp(control.get("y"), 0, 100, 50)), str(max(minimum_width, min(2048, int(control.get("width", 112))))),
            str(max(minimum_height, min(2048, int(control.get("height", 122))))), cpp_float(clamp(control.get("value"), 0, 100, 50) / 100),
            cpp_float(clamp(control.get("opacity"), 0, 100, 100) / 100),
            cpp_float(clamp(control.get("rotation"), -180, 180, 0)),
            f"0x{control_color_rgb:06X}",
            cpp_bool(control.get("show_background", True)), str(max(0, min(127, int(control.get("note_pitch", 60))))),
            str(max(12, min(88, int(control.get("key_count") or 49)))),
            cpp_string(label_position(control.get("label_position"))),
            str(max(0, min(24, int(control.get("label_gap", 12))))),
            cpp_string(control.get("component_variant") or "classic"),
            cpp_string(control.get("meter_mode") or ("stereo" if control.get("kind") == "gain_meter" else "mono")),
            cpp_string(control.get("text_font") or "space-grotesk"),
            f"0x{text_color_rgb:06X}",
            cpp_bool(control.get("show_correlation_meter", True)),
            cpp_bool(control.get("spectrum_band", False)),
            cpp_bool(
                control.get("component_variant") not in {"chicken-head-clean", "orbit-encoder", "studio-scallop", "graphite-ridge", "ivory-lever", "black-dome", "regent-cap", "regent-white", "regent-green", "regent-red", "regent-blue", "regent-brown", "regent-black", "regent-gray", "regent-white-green", "regent-white-red", "regent-white-blue", "regent-white-brown", "regent-white-black", "regent-white-gray", "pan-chicken-head-clean", "pan-ivory-lever", "pan-ring-chicken-head-clean", "pan-ring-ivory-lever", "pan-black-dome", "pan-ring-black-dome"}
                and (control.get("component_style") if control.get("component_style") in ("css", "filmstrip") else interface.get("component_style") or "filmstrip") == "filmstrip"
            ),
        )
        control_lines.append("    ControlInfo{" + ", ".join(fields) + "},")
        panel_lines.append("    PanelControlInfo{" + ", ".join((
            str(panel_indices.get(str(control.get("parent_panel_id") or ""), -1)), cpp_string(control.get("panel_type") or ""),
            cpp_float(clamp(control.get("panel_x"), 0, 100, 50)), cpp_float(clamp(control.get("panel_y"), 0, 100, 52)),
            cpp_float(clamp(control.get("panel_width"), 35, 96, 88)), cpp_float(clamp(control.get("panel_height"), 30, 92, 78)),
        )) + "},")

    preset_names = [" ".join(str(preset.get("name") or "Preset").split()).casefold() for preset in presets]
    if len(preset_names) != len(set(preset_names)):
        fail("preset names must be unique")
    preset_lines, preset_value_lines, preset_group_lines, preset_module_lines, preset_module_parameter_lines = [], [], [], [], []
    for preset in presets:
        value_offset = len(preset_value_lines)
        for control_id, value in (preset.get("control_values") or {}).items():
            control_index = control_indices.get(str(control_id), -1)
            if control_index >= 0:
                preset_value_lines.append(f"    PresetValueInfo{{{control_index}, {cpp_float(clamp(value, 0, 100, 50) / 100)}}},")
        group_offset = len(preset_group_lines)
        for group_id, values in (preset.get("group_values") or {}).items():
            group_index = next((i for i, group in enumerate(groups) if str(group.get("id") or "") == str(group_id)), -1)
            if group_index < 0: continue
            values = values or {}
            preset_group_lines.append("    PresetGroupInfo{" + ", ".join((
                str(group_index), cpp_float(clamp(values.get("volume"), 0, 100, groups[group_index].get("volume", 100)) / 100),
                cpp_float((clamp(values.get("pan"), -1, 1, groups[group_index].get("pan", 0)) + 1) / 2),
                cpp_bool(values.get("mute", groups[group_index].get("mute", False))), cpp_bool(values.get("solo", groups[group_index].get("solo", False))),
            )) + "},")
        module_offset = len(preset_module_lines)
        for module_id, values in (preset.get("module_values") or {}).items():
            module_index = dsp_module_ids.get(str(module_id), -1)
            if module_index < 0: continue
            values = values or {}
            parameter_offset = len(preset_module_parameter_lines)
            for key, value in (values.get("parameters") or {}).items():
                preset_module_parameter_lines.append("    PresetModuleParameterInfo{" + ", ".join((str(module_index), cpp_string(key), cpp_float(float(value)))) + "},")
            preset_module_lines.append("    PresetModuleInfo{" + ", ".join((
                str(module_index), cpp_bool(values.get("bypassed", False)), cpp_float(clamp(values.get("mix"), 0, 1, 1)),
                str(parameter_offset), str(len(preset_module_parameter_lines) - parameter_offset),
            )) + "},")
        preset_lines.append("    PresetInfo{" + ", ".join((
            cpp_string(preset.get("id") or f"preset-{len(preset_lines) + 1}"), cpp_string(preset.get("name") or "Preset"),
            cpp_bool(preset.get("category") == "factory"), str(value_offset), str(len(preset_value_lines) - value_offset),
            str(group_offset), str(len(preset_group_lines) - group_offset), str(module_offset), str(len(preset_module_lines) - module_offset),
        )) + "},")

    midi_mapping_lines = []
    for mapping in midi_mappings:
        target_index = control_indices.get(str(mapping.get("target_control_id") or ""), -1)
        if target_index < 0: continue
        midi_mapping_lines.append("    MidiMappingInfo{" + ", ".join((
            cpp_bool(mapping.get("source_type") == "note"), str(max(0, min(16, int(mapping.get("channel", 0))))),
            str(max(0, min(127, int(mapping.get("source_number", 0))))), str(target_index),
            cpp_float(clamp(mapping.get("minimum"), 0, 100, 0) / 100), cpp_float(clamp(mapping.get("maximum"), 0, 100, 100) / 100), cpp_bool(mapping.get("inverted", False)),
        )) + "},")

    midi_sequence_lines, midi_event_lines, midi_tempo_lines = [], [], []
    for sequence in midi_sequences:
        event_offset = len(midi_event_lines)
        events = sorted(sequence.get("events") or [], key=lambda event: int(event.get("tick", 0)))
        if len(events) > 8192: fail("native MIDI sequence exceeds the supported event limit")
        for event in events:
            midi_event_lines.append("    MidiEventInfo{" + ", ".join((
                str(max(0, int(event.get("tick", 0)))), cpp_bool(event.get("type") == "note_on"),
                str(max(0, min(127, int(event.get("note", 60))))), str(max(0, min(127, int(event.get("velocity", 0))))),
                str(max(0, min(15, int(event.get("channel", 0))))),
            )) + "},")
        tempo_offset = len(midi_tempo_lines)
        tempos = sorted(sequence.get("tempos") or [{"tick": 0, "bpm": 120}], key=lambda tempo: int(tempo.get("tick", 0)))
        for tempo in tempos:
            midi_tempo_lines.append(f"    MidiTempoInfo{{{max(0, int(tempo.get('tick', 0)))}, {cpp_float(clamp(tempo.get('bpm'), 20, 400, 120))}}},")
        midi_sequence_lines.append("    MidiSequenceInfo{" + ", ".join((
            cpp_string(sequence.get("id") or f"midi-{len(midi_sequence_lines) + 1}"), cpp_string(sequence.get("name") or "MIDI"),
            str(max(24, min(9600, int(sequence.get("ppq", 480))))), str(max(0, int(sequence.get("duration_ticks", 0)))),
            str(event_offset), str(len(midi_event_lines) - event_offset), str(tempo_offset), str(len(midi_tempo_lines) - tempo_offset),
        )) + "},")

    name = str(spec.get("name") or "TripleSide Instrument").strip(); build = spec.get("build") or {}
    company = str(build.get("company_name") or "TripleSide Studio").strip(); version = str(build.get("version") or "1.0.0").strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version): fail("version must use MAJOR.MINOR.PATCH")
    digest = hashlib.sha256(f"tripleside-native-vst3:{company}:{name}".encode()).digest(); cid = [int.from_bytes(digest[o:o + 4], "big") for o in range(0, 16, 4)]
    branding, background = spec.get("branding") or {}, interface.get("background") or {}
    brand_font_id = str(branding.get("font") or "outfit")
    brand_fonts = {
        "outfit": ("Outfit", "Outfit-wght.ttf"),
        "manrope": ("Manrope", "Manrope-wght.ttf"),
        "space-grotesk": ("Space Grotesk", "SpaceGrotesk-wght.ttf"),
        "cinzel": ("Cinzel", "Cinzel-wght.ttf"),
        "cormorant-garamond": ("Cormorant Garamond", "CormorantGaramond-wght.ttf"),
    }
    brand_font_family, brand_font_file = brand_fonts.get(brand_font_id, brand_fonts["outfit"])
    background_file = next((p.name for p in sorted((spec_path.parent / "assets").glob("ui_background.*"))), "")
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(interface.get("accent_color") or "#f43f5e")); accent_rgb = int(match.group(1), 16) if match else 0xF43F5E
    ui_match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(interface.get("ui_color") or "#09090b")); ui_rgb = int(ui_match.group(1), 16) if ui_match else 0x09090B
    instrument, effects = spec.get("instrument") or {}, spec.get("effects") or {}
    license_spec = spec.get("license") or {}
    license_required = license_spec.get("required") is True
    license_product_id = str(license_spec.get("product_id") or "")
    license_activation_url = str(license_spec.get("activation_url") or "")
    license_verify_url = str(license_spec.get("verify_url") or "")
    license_build_id = str(license_spec.get("build_id") or "")
    if license_required and (not license_product_id or not license_activation_url.startswith("https://") or not license_verify_url.startswith("https://")):
        fail("native licensed build requires product id and HTTPS activation endpoints")
    visual_path = spec_path.parent / 'assets' / 'visual_manifest.json'
    visual = json.loads(visual_path.read_text(encoding='utf-8')) if visual_path.exists() else {}
    if visual and (visual.get('version') != 1 or len(visual.get('controls', [])) != len(controls)):
        fail('visual manifest version/control count mismatch')
    def rect_values(rect):
        return ', '.join(cpp_float(rect[key]) for key in ('x', 'y', 'width', 'height'))
    visual_controls, visual_keys = [], []
    for item in visual.get('controls', []):
        meter_channels = item.get('meter_channels') or []
        empty_rect = {'x': 0, 'y': 0, 'width': 0, 'height': 0}
        left_meter = meter_channels[0] if len(meter_channels) > 0 else empty_rect
        right_meter = meter_channels[1] if len(meter_channels) > 1 else empty_rect
        visual_controls.append('VisualControl{' + ', '.join((
            cpp_string(item['file']), rect_values(item['rect']), rect_values(item['hit']),
            rect_values(left_meter), rect_values(right_meter),
            str(item['frames']), str(item['columns']),
        )) + '}')
    for item in visual.get('keys', []):
        visual_keys.append('VisualKey{' + ', '.join((cpp_string(item['file']), str(item['control']), str(item['pitch']), rect_values(item['rect']), rect_values(item['hit']), str(item['frame']), str(item['columns']), str(item['cell_width']), str(item['cell_height']))) + '}')
    embedded_resources = write_resource_script(spec_path, output_path)
    content = f'''#pragma once
#include <array>
#define TS_COMPANY_NAME {cpp_string(company)}
#define TS_PRODUCT_NAME {cpp_string(name)}
#define TS_PLUGIN_VERSION {cpp_string(version)}
#define TS_PLUGIN_CID_A 0x{cid[0]:08X}
#define TS_PLUGIN_CID_B 0x{cid[1]:08X}
#define TS_PLUGIN_CID_C 0x{cid[2]:08X}
#define TS_PLUGIN_CID_D 0x{cid[3]:08X}
namespace tripleside::project {{
struct SampleInfo {{ const char* resourceFile; }};
struct GroupInfo {{ const char* id; const char* name; float volume; float pan; bool mute; bool solo; }};
struct ZoneInfo {{ int sampleIndex, groupIndex, articulationIndex, micIndex, roundRobinSet, rootPitch, lowPitch, highPitch, velocityLow, velocityHigh, roundRobin; float sampleStart, sampleEnd, loopStart, loopEnd, fadeInMs, fadeOutMs, loopCrossfadeMs; int tuneSemitones; float tuneCents, gainDb, pan; bool loopEnabled, tempoSync; float sourceBpm; std::array<int, 16> chokeTargetPitches; int chokeTargetCount; }};
struct ControlInfo {{ const char* id; const char* kind; const char* label; const char* offLabel; const char* onLabel; const char* parameter; int moduleIndex; float x, y; int width, height; float value, opacity, rotation; unsigned int colorRgb; bool showBackground; int notePitch, keyCount; const char* labelPosition; int labelGap; const char* variant; const char* meterMode; const char* textFont; unsigned int textColorRgb; bool showCorrelationMeter; bool spectrumBand; bool useFilmstrip; }};
struct PanelControlInfo {{ int parentPanelIndex; const char* panelType; float panelX, panelY, panelWidth, panelHeight; }};
struct PresetInfo {{ const char* id; const char* name; bool factory; int valueOffset, valueCount, groupOffset, groupCount, moduleOffset, moduleCount; }};
struct PresetValueInfo {{ int controlIndex; float value; }};
struct PresetGroupInfo {{ int groupIndex; float volume, pan; bool mute, solo; }};
struct PresetModuleInfo {{ int moduleIndex; bool bypassed; float mix; int parameterOffset, parameterCount; }};
struct PresetModuleParameterInfo {{ int moduleIndex; const char* key; float value; }};
struct MidiMappingInfo {{ bool note; int channel, sourceNumber, targetControlIndex; float minimum, maximum; bool inverted; }};
struct MidiSequenceInfo {{ const char* id; const char* name; int ppq, durationTicks, eventOffset, eventCount, tempoOffset, tempoCount; }};
struct MidiEventInfo {{ int tick; bool noteOn; int note, velocity, channel; }};
struct MidiTempoInfo {{ int tick; float bpm; }};
struct DspModuleInfo {{ const char* id; const char* type; const char* name; int parentIndex, order; bool bypassed; float mix; int parameterOffset, parameterCount; }};
struct DspParameterInfo {{ int moduleIndex; const char* key; float value; }};
struct ImpulseResponseInfo {{ int moduleIndex; const char* resourceFile; bool normalize, autoTrim; float trimStart, trimEnd; bool polarityInverted; float phaseMs; }};
struct VisualControl {{ const char* file; float x,y,w,h,hx,hy,hw,hh,mlx,mly,mlw,mlh,mrx,mry,mrw,mrh; int frames,columns; }};
struct VisualKey {{ const char* file; int control,pitch; float x,y,w,h,hx,hy,hw,hh; int frame,columns,cellWidth,cellHeight; }};
inline constexpr const char* kVisualBackdrop = {cpp_string('visual_backdrop.png' if visual else '')};
inline constexpr std::array<VisualControl, {len(visual_controls)}> kVisualControls {{{{ {', '.join(visual_controls)} }}}};
inline constexpr std::array<VisualKey, {len(visual_keys)}> kVisualKeys {{{{ {', '.join(visual_keys)} }}}};
inline constexpr int kPolyphony = {min(128, max(8, int(instrument.get("polyphony", 32))))};
inline constexpr int kCanvasWidth = {visual.get('width') or max(320, min(1920, int(interface.get("canvas_width", 760))))};
inline constexpr int kCanvasHeight = {visual.get('height') or max(240, min(1080, int(interface.get("canvas_height", 480))))};
inline constexpr unsigned kAccentRgb = 0x{accent_rgb:06X};
inline constexpr unsigned kUiRgb = 0x{ui_rgb:06X};
inline constexpr bool kIsEffect = {cpp_bool(is_effect)};
inline constexpr bool kIsNeonDrums = {cpp_bool(is_neon_drums)};
inline constexpr bool kIsPrismEq = {cpp_bool(is_prism_eq)};
inline constexpr bool kHasPrismModule = {cpp_bool(has_prism_module)};
inline constexpr int kPrismModuleIndex = {prism_module_index};
inline constexpr bool kPrismContextualEnabled = {cpp_bool(prism_contextual_enabled)};
inline constexpr bool kReverbEnabled = {cpp_bool(effects.get("reverb", False))};
inline constexpr bool kDelayEnabled = {cpp_bool(effects.get("delay", False))};
inline constexpr bool kChorusEnabled = {cpp_bool(effects.get("chorus", False))};
inline constexpr bool kSaturationEnabled = {cpp_bool(effects.get("saturation", False))};
inline constexpr bool kDefaultSustain = {cpp_bool(instrument.get("sustainEnabled", False))};
inline constexpr bool kPitchBendEnabled = {cpp_bool(instrument.get("pitchBendEnabled", False))};
inline constexpr bool kModulationEnabled = {cpp_bool(instrument.get("modulationEnabled", False))};
inline constexpr bool kLicenseRequired = {cpp_bool(license_required)};
inline constexpr const char* kLicenseProductId = {cpp_string(license_product_id)};
inline constexpr const char* kLicenseActivationUrl = {cpp_string(license_activation_url)};
inline constexpr const char* kLicenseVerifyUrl = {cpp_string(license_verify_url)};
inline constexpr const char* kLicenseBuildId = {cpp_string(license_build_id)};
inline constexpr float kFallbackTempoBpm = {cpp_float(clamp(instrument.get("tempoBpm"), 20, 300, 120))};
inline constexpr float kDefaultVolume = {cpp_float(control_default(spec, "volume", 85))};
inline constexpr float kDefaultTone = {cpp_float(control_default(spec, "tone", 59.6))};
inline constexpr float kDefaultAttack = {cpp_float(control_default(spec, "attack", 0.2))};
inline constexpr float kDefaultRelease = {cpp_float(control_default(spec, "release", 6.4))};
inline constexpr float kDefaultSpace = {cpp_float(control_default(spec, "space", 18))};
inline constexpr float kDefaultInput = {cpp_float(control_default(spec, "input", 50))};
inline constexpr float kDefaultDrive = {cpp_float(control_default(spec, "drive", 24))};
inline constexpr float kDefaultCompress = {cpp_float(control_default(spec, "compress", 32))};
inline constexpr float kDefaultWidth = {cpp_float(control_default(spec, "width", 50))};
inline constexpr float kDefaultMix = {cpp_float(control_default(spec, "mix", 100))};
inline constexpr float kDefaultOutput = {cpp_float(control_default(spec, "output", 75))};
inline constexpr float kDefaultPan = {cpp_float(control_default(spec, "pan", 50))};
inline constexpr float kDefaultBypass = {cpp_float(control_default(spec, "bypass", 0))};
inline constexpr float kPrismLowCutFrequency = {cpp_float(control_setting(spec, "tone", "frequency", 10, 30000, 50))};
inline constexpr float kPrismLowCutQ = {cpp_float(control_setting(spec, "tone", "q", .025, 40, .707))};
inline constexpr float kPrismLowBodyFrequency = {cpp_float(control_setting(spec, "drive", "frequency", 10, 30000, 120))};
inline constexpr float kPrismLowBodyQ = {cpp_float(control_setting(spec, "drive", "q", .025, 40, .7))};
inline constexpr float kPrismMidFocusFrequency = {cpp_float(control_setting(spec, "compress", "frequency", 10, 30000, 900))};
inline constexpr float kPrismMidFocusQ = {cpp_float(control_setting(spec, "compress", "q", .025, 40, .85))};
inline constexpr float kPrismPresenceFrequency = {cpp_float(control_setting(spec, "width", "frequency", 10, 30000, 3600))};
inline constexpr float kPrismPresenceQ = {cpp_float(control_setting(spec, "width", "q", .025, 40, .9))};
inline constexpr float kPrismAirFrequency = {cpp_float(control_setting(spec, "space", "frequency", 10, 30000, 9000))};
inline constexpr float kPrismAirQ = {cpp_float(control_setting(spec, "space", "q", .025, 40, .7))};
inline constexpr bool kPrismLowCutEnabled = {cpp_bool(has_parameter_control(spec, "tone"))};
inline constexpr bool kPrismLowBodyEnabled = {cpp_bool(has_parameter_control(spec, "drive"))};
inline constexpr bool kPrismMidFocusEnabled = {cpp_bool(has_parameter_control(spec, "compress"))};
inline constexpr bool kPrismPresenceEnabled = {cpp_bool(has_parameter_control(spec, "width"))};
inline constexpr bool kPrismAirEnabled = {cpp_bool(has_parameter_control(spec, "space"))};
inline constexpr std::array<float,5> kPrismBandFrequencies = {{{', '.join(cpp_float(10 * (3000 ** clamp(prism_parameters.get(f'band_{band}_frequency'), 0, 1, 0.5))) for band in range(1, 6)) if has_prism_module else 'kPrismLowCutFrequency, kPrismLowBodyFrequency, kPrismMidFocusFrequency, kPrismPresenceFrequency, kPrismAirFrequency'}}};
inline constexpr std::array<float,5> kPrismBandGains = {{{', '.join(cpp_float(clamp(prism_parameters.get(f'band_{band}_gain'), 0, 1, 0.5)) for band in range(1, 6)) if has_prism_module else '0.5f, kDefaultDrive, kDefaultCompress, kDefaultWidth, kDefaultSpace'}}};
inline constexpr std::array<float,5> kPrismBandQs = {{{', '.join(cpp_float(.025 * (1600 ** clamp(prism_parameters.get(f'band_{band}_q'), 0, 1, 0.5))) for band in range(1, 6)) if has_prism_module else 'kPrismLowCutQ, kPrismLowBodyQ, kPrismMidFocusQ, kPrismPresenceQ, kPrismAirQ'}}};
inline constexpr std::array<bool,5> kPrismBandEnabled = {{{', '.join(cpp_bool(clamp(prism_parameters.get(f'band_{band}_enabled'), 0, 1, 0) >= .5) for band in range(1, 6)) if has_prism_module else 'kPrismLowCutEnabled, kPrismLowBodyEnabled, kPrismMidFocusEnabled, kPrismPresenceEnabled, kPrismAirEnabled'}}};
inline constexpr const char* kVstCategory = {cpp_string("Fx|EQ|Stereo" if is_prism_eq or has_prism_module else "Fx|Dynamics|Stereo" if is_effect else "Instrument|Synth" if any(str(module.get('type') or '') == 'wave_generator' and not module.get('bypassed', False) for module in dsp_modules) else "Instrument|Sampler")};
inline constexpr const char* kTemplate = {cpp_string(interface.get("template") or "studio")};
inline constexpr int kDspGraphVersion = 2;
inline constexpr const char* kDspGraphMode = {cpp_string(dsp_graph.get("mode"))};
inline constexpr const char* kDspGraphSource = {cpp_string(dsp_graph.get("source") or "project")};
inline constexpr const char* kBackgroundFile = {cpp_string(background_file)};
inline constexpr bool kUseFilmstripSkin = {cpp_bool(any((c.get("component_style") if c.get("component_style") in ("css", "filmstrip") else interface.get("component_style") or "filmstrip") == "filmstrip" for c in controls))};
inline constexpr int kEmbeddedResourceCount = {len(embedded_resources)};
inline constexpr const char* kKnobFilmstripFile = "heritage-knob-64x128-v2.png";
inline constexpr const char* kPultecKnobFilmstripFile = "pultec-knob-64x128-v1.png";
inline constexpr const char* kModernSpectrumKnobFile = "modern-spectrum-knob-v2.png";
inline constexpr const char* kStudioScallopKnobFile = "studio-scallop-knob-64x128-v2.png";
inline constexpr const char* kBlackPrecisionKnobFile = "black-precision-knob-64x128-v1.png";
inline constexpr const char* kCrimsonWingKnobFile = "crimson-wing-knob-64x128-v4.png";
inline constexpr const char* kBlackCrimsonWingKnobFile = "black-crimson-wing-knob-64x128-v1.png";
inline constexpr const char* kRegentWhiteWingKnobFile = "regent-white-wing-knob-64x128-v1.png";
inline constexpr const char* kGraphiteRidgeKnobFile = "graphite-ridge-knob-64x128-v1.png";
inline constexpr const char* kButtonFilmstripFile = "heritage-button-6x96.png";
inline constexpr const char* kFaderFilmstripFile = "heritage-fader-64x96x256.png";
inline constexpr const char* kMeterFilmstripFile = "heritage-meter-64x256x128.png";
inline constexpr int kKnobFilmstripFrames = 64, kButtonFilmstripFrames = 6, kFaderFilmstripFrames = 64, kMeterFilmstripFrames = 64;
inline constexpr int kKnobFrameWidth = 128, kKnobFrameHeight = 128, kButtonFrameWidth = 96, kButtonFrameHeight = 96;
inline constexpr int kFaderFrameWidth = 96, kFaderFrameHeight = 256, kMeterFrameWidth = 256, kMeterFrameHeight = 128;
inline constexpr const char* kBackgroundFit = {cpp_string(background.get("fit") or "cover")};
inline constexpr float kBackgroundOpacity = {cpp_float(clamp(background.get("opacity"), 0, 100, 70) / 100)};
inline constexpr float kBackgroundX = {cpp_float(clamp(background.get("x"), 0, 100, 50))}, kBackgroundY = {cpp_float(clamp(background.get("y"), 0, 100, 50))};
inline constexpr float kBackgroundWidth = {cpp_float(clamp(background.get("width"), 1, 200, 100))}, kBackgroundHeight = {cpp_float(clamp(background.get("height"), 1, 200, 100))};
inline constexpr const char* kManufacturer = {cpp_string(branding.get("manufacturer_name") or company)};
inline constexpr const char* kTagline = {cpp_string(branding.get("tagline") or "")};
inline constexpr const char* kBrandFont = {cpp_string(brand_font_id)};
inline constexpr const char* kBrandFontFamily = {cpp_string(brand_font_family)};
inline constexpr const char* kBrandFontFile = {cpp_string(brand_font_file)};
inline constexpr const char* kBrandAlign = {cpp_string(branding.get("align") or "left")};
inline constexpr float kBrandFontSize = {cpp_float(clamp(branding.get("font_size"), 8, 96, 24))};
inline constexpr float kBrandX = {cpp_float(clamp(branding.get("x"), 0, 100, 18))}, kBrandY = {cpp_float(clamp(branding.get("y"), 0, 100, 13))};
inline constexpr std::array<SampleInfo, {len(sample_lines)}> kSamples {{{{\n{chr(10).join(sample_lines)}\n}}}};
inline constexpr std::array<GroupInfo, {len(group_lines)}> kGroups {{{{\n{chr(10).join(group_lines)}\n}}}};
inline constexpr std::array<ZoneInfo, {len(zone_lines)}> kZones {{{{\n{chr(10).join(zone_lines)}\n}}}};
inline constexpr std::array<ControlInfo, {len(control_lines)}> kControls {{{{\n{chr(10).join(control_lines)}\n}}}};
inline constexpr std::array<PanelControlInfo, {len(panel_lines)}> kPanelControls {{{{\n{chr(10).join(panel_lines)}\n}}}};
inline constexpr std::array<PresetInfo, {len(preset_lines)}> kPresets {{{{\n{chr(10).join(preset_lines)}\n}}}};
inline constexpr std::array<PresetValueInfo, {len(preset_value_lines)}> kPresetValues {{{{\n{chr(10).join(preset_value_lines)}\n}}}};
inline constexpr std::array<PresetGroupInfo, {len(preset_group_lines)}> kPresetGroups {{{{\n{chr(10).join(preset_group_lines)}\n}}}};
inline constexpr std::array<PresetModuleInfo, {len(preset_module_lines)}> kPresetModules {{{{\n{chr(10).join(preset_module_lines)}\n}}}};
inline constexpr std::array<PresetModuleParameterInfo, {len(preset_module_parameter_lines)}> kPresetModuleParameters {{{{\n{chr(10).join(preset_module_parameter_lines)}\n}}}};
inline constexpr std::array<MidiMappingInfo, {len(midi_mapping_lines)}> kMidiMappings {{{{\n{chr(10).join(midi_mapping_lines)}\n}}}};
inline constexpr std::array<MidiSequenceInfo, {len(midi_sequence_lines)}> kMidiSequences {{{{\n{chr(10).join(midi_sequence_lines)}\n}}}};
inline constexpr std::array<MidiEventInfo, {len(midi_event_lines)}> kMidiEvents {{{{\n{chr(10).join(midi_event_lines)}\n}}}};
inline constexpr std::array<MidiTempoInfo, {len(midi_tempo_lines)}> kMidiTempos {{{{\n{chr(10).join(midi_tempo_lines)}\n}}}};
inline constexpr std::array<DspModuleInfo, {len(dsp_module_lines)}> kDspModules {{{{\n{chr(10).join(dsp_module_lines)}\n}}}};
inline constexpr std::array<DspParameterInfo, {len(dsp_parameter_lines)}> kDspParameters {{{{\n{chr(10).join(dsp_parameter_lines)}\n}}}};
inline constexpr std::array<ImpulseResponseInfo, {len(impulse_lines)}> kImpulseResponses {{{{\n{chr(10).join(impulse_lines)}\n}}}};
inline constexpr std::array<const char*, {len(articulation_names)}> kArticulations {{{{ {', '.join(cpp_string(v) for v in articulation_names)} }}}};
inline constexpr std::array<const char*, {len(mic_names)}> kMicPositions {{{{ {', '.join(cpp_string(v) for v in mic_names)} }}}};
}} // namespace tripleside::project
'''
    output_path.parent.mkdir(parents=True, exist_ok=True); output_path.write_text(content, encoding="utf-8")

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("spec", type=Path); parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(); compile_manifest(args.spec, args.output)
if __name__ == "__main__": main()
