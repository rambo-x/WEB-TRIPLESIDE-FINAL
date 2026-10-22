import importlib.util
import json
from pathlib import Path
import pytest


MODULE_PATH = Path(__file__).parents[1] / "tools" / "compile_manifest.py"
SPEC = importlib.util.spec_from_file_location("compile_manifest", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def project_spec():
    return {
        "name": "Native Piano",
        "build": {"company_name": "TripleSide Studio", "version": "1.2.3"},
        "instrument": {"polyphony": 64},
        "interface": {"controls": [
            {"parameter": "volume", "value": 75},
            {"parameter": "attack", "value": 10},
            {"parameter": "release", "value": 25},
        ]},
        "samples": [{"id": "sample-a", "name": "Piano.wav", "resource_name": "sample_000_wav"}],
        "sampler_map": [{
            "sampleId": "sample-a", "rootPitch": 60, "lowPitch": 48, "highPitch": 72,
            "velocityLow": 1, "velocityHigh": 127, "sampleStart": 0.0,
        }],
    }


def test_compiles_project_to_cpp_manifest(tmp_path):
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(project_spec()), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert '#define TS_PRODUCT_NAME "Native Piano"' in result
    assert '#define TS_PLUGIN_VERSION "1.2.3"' in result
    assert "inline constexpr int kPolyphony = 64;" in result
    assert 'SampleInfo{"sample_000.wav"}' in result
    assert "ZoneInfo{0, 0, 0, 0, 0, 60, 48, 72, 1, 127" in result
    assert "kDefaultVolume = 0.75f" in result
    assert "kDefaultPan = 0.5f" in result
    assert "kEmbeddedResourceCount" in result


def test_compiles_master_pan_default_from_designer_control(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"].append({"parameter": "pan", "value": 25})
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    assert "kDefaultPan = 0.25f" in output.read_text(encoding="utf-8")


def test_compiles_linked_led_and_realtime_waveform_contract(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        {"id": "power", "kind": "button", "label": "Power", "parameter": "bypass", "value": 0},
        {"id": "power-led", "kind": "indicator", "label": "Power LED", "parameter": "visual", "value": 0, "indicator_source_id": "power", "control_color": "#39FF88", "component_variant": "round-indicator"},
        {"id": "waveform", "kind": "spectrum", "label": "Waveform", "parameter": "visual", "value": 0, "visual_color": "#A78BFA", "component_variant": "realtime-waveform", "width": 480, "height": 180},
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "int indicatorSourceIndex;" in result
    assert 'ControlInfo{"power-led", "indicator", "Power LED", "Power LED", "ON", "visual", -1, 0,' in result
    assert "0x39FF88" in result
    assert '"realtime-waveform"' in result
    assert "0xA78BFA" in result


def test_compiles_midi_sequence_loop_setting(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"].append({
        "id": "pattern-button", "kind": "button", "label": "Pattern",
        "parameter": "space", "value": 0, "midi_sequence_id": "groove-1",
    })
    spec["presets"] = [{
        "id": "pattern-preset", "name": "Pattern Preset", "category": "user",
        "midi_sequence_id": "groove-1",
    }]
    spec["midi_sequences"] = [{
        "id": "groove-1", "name": "Main Groove", "ppq": 480,
        "duration_ticks": 1920, "loop_enabled": True,
        "events": [
            {"tick": 0, "type": "control_change", "controller": 64, "value": 127, "channel": 9},
            {"tick": 0, "type": "note_on", "note": 36, "velocity": 110, "channel": 9},
            {"tick": 120, "type": "note_off", "note": 36, "velocity": 0, "channel": 9},
            {"tick": 120, "type": "control_change", "controller": 64, "value": 0, "channel": 9},
        ],
        "tempos": [{"tick": 0, "bpm": 120}],
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "bool loopEnabled" in result
    assert 'MidiSequenceInfo{"groove-1", "Main Groove", 480, 1920, true, 0, 2' in result
    assert result.count("MidiEventInfo{") == 2
    assert 'ControlInfo{"pattern-button", "button", "Pattern", "Pattern", "ON", "space", -1, -1, 0,' in result
    assert 'PresetInfo{"pattern-preset", "Pattern Preset", false, 0, 0, 0, 0, 0, 0, 0}' in result


def test_compiles_customer_build_license_contract(tmp_path):
    spec = project_spec()
    spec["license"] = {
        "required": True,
        "product_id": "vst-maker-build:12345678-1234-1234-1234-123456789abc",
        "activation_url": "https://triplesidestudio.com/api/license/activate",
        "verify_url": "https://triplesidestudio.com/api/license/verify",
        "offline_mode": "permanent_with_online_refresh",
        "build_id": "12345678-1234-1234-1234-123456789abc",
    }
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kLicenseRequired = true" in result
    assert 'kLicenseProductId = "vst-maker-build:12345678-1234-1234-1234-123456789abc"' in result
    assert 'kLicenseActivationUrl = "https://triplesidestudio.com/api/license/activate"' in result
    assert "kLicenseOfflineGraceDays" not in result


def test_compiles_sampleless_wave_generator_as_synth(tmp_path):
    spec = project_spec()
    spec["samples"] = []
    spec["sampler_map"] = []
    spec["dsp_graph"] = {
        "version": 2, "mode": "instrument_sources", "source": "project",
        "modules": [{
            "id": "osc-1", "type": "wave_generator", "name": "Wave Generator",
            "bypassed": False, "mix": 1,
            "parameters": {"waveform": 0.5, "octave": 0.5, "semitone": 0.5, "fine": 0.5, "level": 0.65, "pulse_width": 0.5, "phase_reset": 1, "attack": 0, "decay": 0.2, "sustain": 0.8, "release": 0.18, "filter_cutoff": 0.75, "filter_resonance": 0.2, "osc2_enabled": 0, "glide": 0.35, "glide_mode": 1, "vibrato_rate": 0.45, "vibrato_depth": 0.25, "vibrato_delay": 0.1},
        }],
    }
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'kVstCategory = "Instrument|Synth"' in result
    assert 'DspModuleInfo{"osc-1", "wave_generator"' in result
    assert 'DspParameterInfo{0, "pulse_width", 0.5f}' in result
    assert 'DspParameterInfo{0, "glide", 0.35f}' in result
    assert 'DspParameterInfo{0, "osc2_enabled", 0.0f}' in result
    assert 'DspParameterInfo{0, "vibrato_depth", 0.25f}' in result


def test_compiles_complete_wave_generator_parameter_contract(tmp_path):
    spec = project_spec()
    spec["samples"] = []
    spec["sampler_map"] = []
    parameters = {
        key: 0.5
        for key in (
            "waveform", "octave", "semitone", "fine", "level", "pulse_width",
            "phase_reset", "voice_mode", "retrigger", "attack", "decay", "sustain",
            "release", "filter_cutoff", "filter_resonance", "filter_env_amount",
            "velocity_sensitivity", "velocity_curve", "velocity_min_level",
            "filter_key_tracking", "osc2_enabled", "osc2_waveform", "osc2_octave",
            "osc2_detune", "osc2_level", "osc2_pulse_width", "sub_level", "noise_level",
            "noise_color", "unison_voices", "unison_detune", "stereo_spread", "glide",
            "glide_mode", "vibrato_rate", "vibrato_depth", "vibrato_delay",
        )
    }
    assert len(parameters) == 37
    spec["dsp_graph"] = {
        "version": 2, "mode": "instrument_sources", "source": "project",
        "modules": [{
            "id": "osc-full", "type": "wave_generator", "name": "Wave Generator",
            "bypassed": False, "mix": 1, "parameters": parameters,
        }],
    }
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "std::array<DspParameterInfo, 37> kDspParameters" in result
    assert 'DspParameterInfo{0, "vibrato_delay", 0.5f}' in result


def test_compiles_global_tuning_and_fine_tune_parameters(tmp_path):
    spec = project_spec()
    spec["dsp_graph"] = {
        "version": 2, "mode": "instrument_sources", "source": "project",
        "modules": [{
            "id": "global-tuning", "type": "tuning", "name": "Tuning & Fine Tune",
            "bypassed": False, "mix": 1,
            "parameters": {"tuning": 0.75, "fine_tune": 0.25},
        }],
    }
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'DspModuleInfo{"global-tuning", "tuning"' in result
    assert 'DspParameterInfo{0, "tuning", 0.75f}' in result
    assert 'DspParameterInfo{0, "fine_tune", 0.25f}' in result


def test_native_manifest_rejects_more_than_bounded_dsp_parameter_limit(tmp_path):
    spec = project_spec()
    spec["dsp_graph"] = {
        "version": 2, "mode": "instrument_sources", "source": "project",
        "modules": [{
            "id": "oversized", "type": "wave_generator", "name": "Oversized",
            "parameters": {
                f"parameter_{index}": 0.5
                for index in range(MODULE.MAX_DSP_PARAMETERS_PER_MODULE + 1)
            },
        }],
    }
    source = tmp_path / "project.json"
    source.write_text(json.dumps(spec), encoding="utf-8")

    with pytest.raises(SystemExit, match="supported parameter limit"):
        MODULE.compile_manifest(source, tmp_path / "NativeProject.h")


def test_compiles_module_control_binding_to_native_module_index(tmp_path):
    spec = project_spec()
    spec["plugin_kind"] = "effect"
    spec["instrument_type"] = "Audio Effect"
    spec["samples"] = []
    spec["sampler_map"] = []
    spec["dsp_graph"] = {
        "version": 2,
        "mode": "ordered_rack",
        "source": "project",
        "modules": [{"id": "drive-a", "type": "soft_clip", "name": "Drive A"}],
    }
    spec["interface"]["controls"] = [{
        "id": "drive-control", "kind": "knob", "label": "Drive",
        "parameter": "drive", "module_id": "drive-a", "value": 35,
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'ControlInfo{"drive-control", "knob", "Drive", "Drive", "ON", "drive", 0,' in result
    assert "int moduleIndex;" in result


def test_compiles_instrument_macro_to_first_matching_rack_module(tmp_path):
    spec = project_spec()
    spec["dsp_graph"] = {
        "version": 2,
        "mode": "instrument_serial_rack",
        "source": "project",
        "modules": [
            {"id": "tone-a", "type": "tone_shaper", "name": "Tone A", "parameters": {"tone": 0.4}},
            {"id": "tone-b", "type": "tone_shaper", "name": "Tone B", "parameters": {"tone": 0.6}},
        ],
    }
    spec["interface"]["controls"] = [{
        "id": "tone-macro", "kind": "knob", "label": "Tone",
        "parameter": "tone", "module_id": None, "value": 70,
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'kDspGraphMode = "instrument_serial_rack"' in result
    assert 'ControlInfo{"tone-macro", "knob", "Tone", "Tone", "ON", "tone", 0,' in result


def test_compiles_mono_and_stereo_meter_modes(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        {"id": "peak", "kind": "gain_meter", "label": "Peak", "parameter": "output_level", "meter_mode": "stereo"},
        {"id": "vu", "kind": "vu_meter", "label": "VU", "parameter": "output_level", "meter_mode": "mono"},
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert '"classic", "stereo", "space-grotesk", 0xF4F4F5, true, false, true}' in result
    assert '"classic", "mono", "space-grotesk", 0xF4F4F5, true, false, true}' in result
    assert "const char* meterMode;" in result


def test_compiles_gain_reduction_meter_with_compressor_target(tmp_path):
    spec = project_spec()
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "custom", "modules": [{
        "id": "comp", "type": "linked_compressor", "name": "Compressor", "order": 0,
        "bypassed": False, "mix": 1, "parameters": {"compress": 0.5},
    }]}
    spec["interface"]["controls"] = [{
        "id": "gr", "kind": "vu_meter", "label": "Gain Reduction", "parameter": "gain_reduction",
        "module_id": "comp", "meter_mode": "mono",
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    assert 'ControlInfo{"gr", "vu_meter", "Gain Reduction", "Gain Reduction", "ON", "gain_reduction", 0,' in output.read_text(encoding="utf-8")


def test_compiles_de_esser_module_and_all_parameters(tmp_path):
    spec = project_spec()
    parameters = {
        "amount": 0.55, "frequency": 0.5, "threshold": 0.58,
        "range": 0.5, "attack": 0.35, "release": 0.45,
    }
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "custom", "modules": [{
        "id": "de-esser", "type": "de_esser", "name": "De-Esser", "order": 0,
        "bypassed": False, "mix": 1, "parameters": parameters,
    }]}
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'DspModuleInfo{"de-esser", "de_esser", "De-Esser"' in result
    for key in parameters:
        assert f'"{key}"' in result


@pytest.mark.parametrize("module_type,parameters", [
    ("parametric_eq", {"mode": 1, "low_cut_enabled": 1, "low_cut_frequency": 0.3, "low_cut_q": 0.2,
        "low_gain": 0.6, "low_frequency": 0.3, "low_q": 0.2, "mid_gain": 0.7, "mid_frequency": 0.5,
        "mid_q": 0.3, "high_gain": 0.55, "high_frequency": 0.6, "high_q": 0.2,
        "high_cut_enabled": 1, "high_cut_frequency": 0.8, "high_cut_q": 0.2, "output": 0.5}),
    ("multiband_compressor", {"amount": 0.65, "low_crossover": 0.48, "high_crossover": 0.42,
        "low_threshold": 0.58, "low_ratio": 0.2, "low_attack": 0.62, "low_release": 0.5, "low_makeup": 0,
        "mid_threshold": 0.54, "mid_ratio": 0.26, "mid_attack": 0.5, "mid_release": 0.45, "mid_makeup": 0,
        "high_threshold": 0.5, "high_ratio": 0.3, "high_attack": 0.38, "high_release": 0.4, "high_makeup": 0}),
])
def test_compiles_new_eq_and_multiband_modules(tmp_path, module_type, parameters):
    spec = project_spec()
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "custom", "modules": [{
        "id": "processor", "type": module_type, "name": module_type, "order": 0,
        "bypassed": False, "mix": 1, "parameters": parameters,
    }]}
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")
    MODULE.compile_manifest(source, output)
    result = output.read_text(encoding="utf-8")
    assert f'"{module_type}"' in result
    for key in parameters:
        assert f'"{key}"' in result


def test_compiles_panel_button_children_and_function_data(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        {
            "id": "presets", "kind": "panel_button", "label": "Presets",
            "parameter": "visual", "panel_type": "preset_browser",
            "panel_x": 48, "panel_y": 50, "panel_width": 76, "panel_height": 64,
        },
        {
            "id": "tone", "kind": "knob", "label": "Tone", "parameter": "tone",
            "parent_panel_id": "presets", "x": 25, "y": 40, "value": 55,
        },
    ]
    spec["dsp_graph"] = {
        "version": 2, "mode": "ordered_rack", "source": "project",
        "modules": [{
            "id": "hidden-tone", "type": "tone_shaper", "name": "Hidden Tone",
            "order": 0, "bypassed": False, "mix": 1, "parameters": {"tone": 0.5},
        }],
    }
    spec["presets"] = [{
        "id": "bright", "name": "Bright", "category": "factory",
        "control_values": {"tone": 82}, "group_values": {},
        "module_values": {"hidden-tone": {"bypassed": True, "mix": 0.75, "parameters": {"tone": 0.91}}},
    }]
    spec["midi_mappings"] = [{
        "id": "tone-cc", "source_type": "cc", "channel": 0,
        "source_number": 74, "target_control_id": "tone",
        "minimum": 0, "maximum": 100, "inverted": False,
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'PanelControlInfo{-1, "preset_browser", 48.0f, 50.0f, 76.0f, 64.0f}' in result
    assert 'PanelControlInfo{0, "", 50.0f, 52.0f, 88.0f, 78.0f}' in result
    assert 'PresetInfo{"bright", "Bright", true, 0, 1, 0, 0, 0, 1, -1}' in result
    assert 'PresetModuleInfo{0, true, 0.75f, 0, 1}' in result
    assert 'PresetModuleParameterInfo{0, "tone", 0.91f}' in result
    assert 'MidiMappingInfo{false, 0, 74, 1, 0.0f, 1.0f, false}' not in result


def test_rejects_invalid_panel_references(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [{
        "id": "tone", "kind": "knob", "label": "Tone", "parameter": "tone",
        "parent_panel_id": "missing-panel",
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    with pytest.raises(SystemExit, match="unknown panel button"):
        MODULE.compile_manifest(source, output)


def test_rejects_duplicate_preset_names_case_insensitively(tmp_path):
    spec = project_spec()
    spec["presets"] = [
        {"id": "warm-1", "name": "Warm Pad"},
        {"id": "warm-2", "name": " warm   PAD "},
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    with pytest.raises(SystemExit, match="preset names must be unique"):
        MODULE.compile_manifest(source, output)


def test_compiles_custom_cabinet_ir_resource_and_processing_settings(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": []})
    spec["dsp_graph"] = {
        "version": 2, "mode": "ordered_rack", "source": "project",
        "modules": [{"id": "cab", "type": "cabinet_ir", "name": "Cabinet"}],
    }
    spec["impulse_responses"] = [{
        "id": "ir-1", "moduleId": "cab", "name": "cabinet_ir_000.wav",
        "resource_name": "cabinet_ir_000.wav", "normalize": False, "autoTrim": True,
        "trimStart": 0.1, "trimEnd": 0.9, "polarityInverted": True, "phaseMs": -0.5,
    }]
    source = tmp_path / "project.json"; output = tmp_path / "NativeProject.h"
    assets = tmp_path / "assets"; assets.mkdir()
    (assets / "cabinet_ir_000.wav").write_bytes(b"RIFF\x04\x00\x00\x00WAVE")
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'ImpulseResponseInfo{0, "cabinet_ir_000.wav", false, true, 0.1f, 0.9f, true, -0.5f}' in result
    assert 'std::array<ImpulseResponseInfo, 1> kImpulseResponses' in result
    assert '"cabinet_ir_000.wav" RCDATA' in (tmp_path / "NativeAssets.rc").read_text(encoding="utf-8")


def test_static_visual_does_not_override_audio_parameter_defaults(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        {"id": "scale", "kind": "visual", "label": "Scale", "parameter": "volume", "value": 0},
        {"id": "volume", "kind": "knob", "label": "Volume", "parameter": "volume", "value": 75},
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kDefaultVolume = 0.75f" in result
    assert 'ControlInfo{"scale", "visual", "Scale"' in result


def test_compiles_static_text_component_opacity_and_rotation(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [{
        "id": "headline", "kind": "text", "label": "MY INSTRUMENT",
        "parameter": "visual", "value": 0, "opacity": 45, "rotation": -37.5,
        "component_variant": "plain-text", "show_background": False,
        "width": 76, "height": 24, "text_font": "cinzel", "text_color": "#C084FC",
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'ControlInfo{"headline", "text", "MY INSTRUMENT"' in result
    assert "float value, opacity, rotation;" in result
    assert "0.45f, -37.5f, 0x000000, false" in result
    assert '24, 0.0f, 0.45f, -37.5f' in result
    assert '"cinzel", 0xC084FC' in result


def test_compiles_led_expression_control_color(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [{
        "id": "bend-led", "kind": "fader", "label": "Pitch Bend",
        "parameter": "pitch_bend", "value": 50, "component_variant": "pitch-bend-led",
        "component_style": "css", "control_color": "#22C55E",
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "unsigned int colorRgb;" in result
    assert "0x22C55E" in result


def test_compiles_spectrum_visual_color_for_native_analyzer(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [{
        "id": "analyzer", "kind": "spectrum", "label": "Spectrum Analyzer",
        "parameter": "output_level", "value": 0, "component_variant": "realtime-spectrum",
        "component_style": "css", "visual_color": "#F97316", "width": 640, "height": 300,
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'ControlInfo{"analyzer", "spectrum", "Spectrum Analyzer"' in result
    assert "0xF97316" in result


def test_generates_windows_resource_table_for_every_project_asset(tmp_path):
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "sample_000.wav").write_bytes(b"RIFF\x04\x00\x00\x00WAVE")
    (assets / "ui_background.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    source.write_text(json.dumps(project_spec()), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    resource_script = (tmp_path / "NativeAssets.rc").read_text(encoding="utf-8")
    assert '"project.json" RCDATA' in resource_script
    assert '"sample_000.wav" RCDATA' in resource_script
    assert '"ui_background.png" RCDATA' in resource_script
    assert '"heritage-knob-64x128-v2.png" RCDATA' in resource_script


def test_compiles_designer_and_sampler_runtime_fields(tmp_path):
    spec = project_spec()
    spec["instrument"]["sustainEnabled"] = True
    spec["instrument"]["tempoBpm"] = 132.5
    spec["instrument"]["pitchBendEnabled"] = True
    spec["instrument"]["modulationEnabled"] = False
    spec["branding"] = {"manufacturer_name": "Acme Audio", "tagline": "Play it", "font": "cinzel"}
    spec["effects"] = {"reverb": True, "delay": True, "chorus": True, "saturation": True}
    spec["sampler_groups"] = [{"id": "one", "name": "Sampler 1", "volume": 72, "pan": -0.2}]
    spec["interface"].update({"accent_color": "#123456", "ui_color": "#234567", "canvas_width": 900, "canvas_height": 540})
    spec["interface"]["controls"].append({"id": "keys", "kind": "keyboard", "label": "Keys", "parameter": "keyboard", "x": 50, "y": 80, "width": 600, "height": 120, "key_count": 37, "key_colors": {"36": "#ff0088", "37": "#00aaff", "invalid": "#ffffff"}, "note_pitch": 48, "show_background": False, "label_position": "bottom-right", "label_gap": 5})
    spec["interface"]["controls"].append({"id": "bypass", "kind": "button", "label": "Bypass", "off_label": "Bypass", "on_label": "ON", "parameter": "bypass", "x": 90, "y": 80, "value": 0})
    spec["interface"]["controls"].append({"id": "blank", "kind": "button", "label": "", "off_label": "", "on_label": "", "parameter": "bypass", "x": 80, "y": 80, "value": 0})
    spec["sampler_map"][0].update({"groupName": "Sampler 1", "sampleEnd": .8, "loopEnabled": True, "loopStart": .2, "loopEnd": .7, "loopCrossfadeMs": 12, "fadeInMs": 4, "roundRobin": 2, "chokeTargetPitches": [44, 46]})
    source = tmp_path / "project.json"; output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")
    MODULE.compile_manifest(source, output)
    result = output.read_text(encoding="utf-8")
    assert "kAccentRgb = 0x123456" in result
    assert "kUiRgb = 0x234567" in result
    assert "kReverbEnabled = false" in result
    assert "kDelayEnabled = false" in result
    assert "kChorusEnabled = false" in result
    assert "kSaturationEnabled = false" in result
    assert "kDefaultSustain = true" in result
    assert "kPitchBendEnabled = true" in result
    assert "kModulationEnabled = false" in result
    assert "kFallbackTempoBpm = 132.5f" in result
    assert ", 12.0f, 0, 0, 0, 0, true" in result
    assert "std::array<int, 16>{44, 46, -1" in result
    assert "}, 2}" in result
    assert 'kManufacturer = "Acme Audio"' in result
    assert 'GroupInfo{"one", "Sampler 1", 0.72f, -0.2f' in result
    assert 'ControlInfo{"keys", "keyboard"' in result
    assert '37, "bottom-right", 5, "classic"' in result
    assert "struct KeyColorInfo { int control, pitch; unsigned int colorRgb; };" in result
    assert "KeyColorInfo{" in result
    assert ", 36, 0xFF0088}" in result
    assert ", 37, 0x00AAFF}" in result
    assert "kKeyColors" in result
    assert 'ControlInfo{"bypass", "button", "Bypass", "Bypass", "ON", "bypass"' in result
    assert 'ControlInfo{"blank", "button", "", "", "", "bypass"' in result


def test_colored_keyboard_smoke_fixture_has_distinct_white_and_black_key_colors(tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "colored-keyboard-smoke.json"
    spec = json.loads(fixture.read_text(encoding="utf-8"))
    keyboard = next(control for control in spec["interface"]["controls"] if control["kind"] == "keyboard")
    colors = {int(pitch): color.lower() for pitch, color in keyboard["key_colors"].items()}
    white_pitches = [pitch for pitch in colors if pitch % 12 in {0, 2, 4, 5, 7, 9, 11}]
    black_pitches = [pitch for pitch in colors if pitch % 12 in {1, 3, 6, 8, 10}]

    assert white_pitches and black_pitches
    assert colors[white_pitches[0]] != colors[black_pitches[0]]

    output = tmp_path / "NativeProject.h"
    MODULE.compile_manifest(fixture, output)
    result = output.read_text(encoding="utf-8")
    assert "KeyColorInfo{1, 48, 0xFF2D55}" in result
    assert "KeyColorInfo{1, 61, 0x00D4FF}" in result


def test_compiles_static_knob_assets_and_variant(tmp_path):
    spec = project_spec()
    spec["branding"] = {"font": "cormorant-garamond"}
    spec["interface"]["controls"] = [{
        "id": "spectrum", "kind": "knob", "label": "Spectrum", "parameter": "tone",
        "component_style": "filmstrip", "component_variant": "modern-spectrum",
    }]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'ControlInfo{"spectrum", "knob", "Spectrum"' in result
    assert '"modern-spectrum", "mono", "space-grotesk", 0xF4F4F5, true, false, true}' in result
    assert 'kModernSpectrumKnobFile = "modern-spectrum-knob-v2.png"' in result
    assert 'kStudioScallopKnobFile = "studio-scallop-knob-64x128-v2.png"' in result
    assert 'kBlackPrecisionKnobFile = "black-precision-knob-64x128-v1.png"' in result
    assert 'kCrimsonWingKnobFile = "crimson-wing-knob-64x128-v4.png"' in result
    assert 'kBlackCrimsonWingKnobFile = "black-crimson-wing-knob-64x128-v1.png"' in result
    assert 'kRegentWhiteWingKnobFile = "regent-white-wing-knob-64x128-v1.png"' in result
    assert 'kGraphiteRidgeKnobFile = "graphite-ridge-knob-64x128-v1.png"' in result
    assert 'kBrandFontFamily = "Cormorant Garamond"' in result
    assert 'kBrandFontFile = "CormorantGaramond-wght.ttf"' in result
    resource_script = (tmp_path / "NativeAssets.rc").read_text(encoding="utf-8")
    assert '"CormorantGaramond-wght.ttf" RCDATA' in resource_script


def test_css_procedural_knobs_override_legacy_filmstrip_style(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        {
            "id": "scallop", "kind": "knob", "label": "Scallop", "parameter": "tone",
            "component_style": "filmstrip", "component_variant": "studio-scallop",
        },
        {
            "id": "ridge", "kind": "knob", "label": "Ridge", "parameter": "space",
            "component_style": "filmstrip", "component_variant": "graphite-ridge",
        },
        {
            "id": "clean-chicken", "kind": "knob", "label": "Clean Chicken", "parameter": "width",
            "component_style": "filmstrip", "component_variant": "chicken-head-clean",
        },
        {
            "id": "orbit", "kind": "knob", "label": "Orbit", "parameter": "compress",
            "component_style": "filmstrip", "component_variant": "orbit-encoder",
        },
        {
            "id": "ivory", "kind": "knob", "label": "Ivory Lever", "parameter": "tone",
            "component_style": "filmstrip", "component_variant": "ivory-lever",
        },
        {
            "id": "pan-chicken", "kind": "knob", "label": "Chicken Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-chicken-head-clean",
        },
        {
            "id": "pan-ivory", "kind": "knob", "label": "Ivory Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-ivory-lever",
        },
        {
            "id": "pan-ring-chicken", "kind": "knob", "label": "Chicken Ring Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-ring-chicken-head-clean",
        },
        {
            "id": "pan-ring-ivory", "kind": "knob", "label": "Ivory Ring Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-ring-ivory-lever",
        },
        {
            "id": "black-dome", "kind": "knob", "label": "Black Dome", "parameter": "tone",
            "component_style": "filmstrip", "component_variant": "black-dome",
        },
        *[
            {
                "id": variant, "kind": "knob", "label": variant, "parameter": "tone",
                "component_style": "filmstrip", "component_variant": variant,
            }
            for variant in (
                "regent-white", "regent-green", "regent-red", "regent-blue", "regent-brown", "regent-black", "regent-gray",
                "regent-white-green", "regent-white-red", "regent-white-blue", "regent-white-brown", "regent-white-black", "regent-white-gray",
            )
        ],
        {
            "id": "pan-black-dome", "kind": "knob", "label": "Black Dome Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-black-dome",
        },
        {
            "id": "pan-ring-black-dome", "kind": "knob", "label": "Black Dome Ring Pan", "parameter": "group_0_pan",
            "component_style": "filmstrip", "component_variant": "pan-ring-black-dome",
        },
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert '"studio-scallop", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"graphite-ridge", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"chicken-head-clean", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"orbit-encoder", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"ivory-lever", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"pan-chicken-head-clean", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"pan-ivory-lever", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"pan-ring-chicken-head-clean", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"pan-ring-ivory-lever", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"black-dome", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    for variant in (
        "regent-white", "regent-green", "regent-red", "regent-blue", "regent-brown", "regent-black", "regent-gray",
        "regent-white-green", "regent-white-red", "regent-white-blue", "regent-white-brown", "regent-white-black", "regent-white-gray",
    ):
        assert f'"{variant}", "mono", "space-grotesk", 0xF4F4F5, true, false, false}}' in result
    assert '"pan-black-dome", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result
    assert '"pan-ring-black-dome", "mono", "space-grotesk", 0xF4F4F5, true, false, false}' in result


def test_uses_safe_master_headroom_without_a_volume_control(tmp_path):
    spec = project_spec()
    spec["interface"]["controls"] = [
        control for control in spec["interface"]["controls"]
        if control.get("parameter") != "volume"
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    assert "kDefaultVolume = 0.85f" in output.read_text(encoding="utf-8")


def test_rejects_formats_not_supported_by_runtime(tmp_path):
    spec = project_spec()
    spec["samples"][0]["name"] = "Piano.flac"
    source = tmp_path / "project.json"
    source.write_text(json.dumps(spec), encoding="utf-8")

    try:
        MODULE.compile_manifest(source, tmp_path / "NativeProject.h")
    except SystemExit as error:
        assert "currently supports WAV only" in str(error)
    else:
        raise AssertionError("expected unsupported format to fail")


def test_compiles_stereo_audio_effect_without_samples(tmp_path):
    spec = project_spec()
    spec.update({"name": "MixForge", "plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["interface"]["template"] = "mixforge"
    spec["interface"]["controls"] = [
        {"parameter": "input", "value": 50},
        {"parameter": "drive", "value": 24},
        {"parameter": "compress", "value": 32},
        {"parameter": "width", "value": 50},
        {"parameter": "mix", "value": 100},
        {"parameter": "output", "value": 75},
        {"parameter": "bypass", "value": 0},
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kIsEffect = true" in result
    assert 'kVstCategory = "Fx|Dynamics|Stereo"' in result
    assert "std::array<SampleInfo, 0>" in result
    assert "kDefaultDrive = 0.24f" in result


def test_compiles_versioned_dsp_rack_and_flattened_parameters(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["dsp_graph"] = {
        "version": 2,
        "mode": "ordered_rack",
        "source": "project",
        "modules": [
            {
                "id": "clip-a", "type": "soft_clip", "name": "Clip A",
                "parentId": None, "order": 10, "bypassed": False, "mix": 0.75,
                "parameters": {"drive": 0.6},
            },
            {
                "id": "output-a", "type": "output_trim", "name": "Output A",
                "parentId": "clip-a", "order": 20, "bypassed": True, "mix": 1,
                "parameters": {"gain_db": -1.5},
            },
        ],
    }
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kDspGraphVersion = 2" in result
    assert 'kDspGraphMode = "ordered_rack"' in result
    assert 'DspModuleInfo{"clip-a", "soft_clip", "Clip A", -1, 10, false, 0.75f, 0, 1}' in result
    assert 'DspModuleInfo{"output-a", "output_trim", "Output A", 0, 20, true, 1.0f, 1, 1}' in result
    assert 'DspParameterInfo{0, "drive", 0.6f}' in result
    assert 'DspParameterInfo{1, "gain_db", -1.5f}' in result


def test_rejects_unknown_or_out_of_range_parameters_for_native_modules(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["dsp_graph"] = {
        "version": 2,
        "mode": "ordered_rack",
        "source": "project",
        "modules": [{"id": "clip", "type": "soft_clip", "parameters": {"mystery": 0.5}}],
    }
    spec_path = tmp_path / "unknown-parameter.json"
    output = tmp_path / "NativeProject.h"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(SystemExit, match="unsupported parameter mystery"):
        MODULE.compile_manifest(spec_path, output)

    spec["dsp_graph"]["modules"][0]["parameters"] = {"drive": 1.5}
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    with pytest.raises(SystemExit, match="between 0 and 1"):
        MODULE.compile_manifest(spec_path, output)


def test_compiles_original_amp_chain_parameters(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    modules = [
        {"id": "gate", "type": "noise_gate", "parameters": {"threshold": 0.4, "release": 0.5}},
        {"id": "drive", "type": "amp_overdrive", "parameters": {"drive": 0.6, "tone": 0.55, "level": 0.5}},
        {"id": "amp", "type": "amp_model", "parameters": {"gain": 0.55, "bass": 0.6, "mid": 0.45, "treble": 0.65, "presence": 0.4, "master": 0.75}},
        {"id": "cab", "type": "cabinet_ir", "parameters": {"cabinet": 0.5, "mic_position": 0.55, "resonance": 0.5, "level": 0.5}},
    ]
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "project", "modules": modules}
    source = tmp_path / "amp-project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    for module_type in ("noise_gate", "amp_overdrive", "amp_model", "cabinet_ir"):
        assert f'"{module_type}"' in result
    assert 'DspParameterInfo{3, "mic_position", 0.55f}' in result


def test_compiles_dual_high_gain_amp_parameters(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["dsp_graph"] = {
        "version": 2,
        "mode": "ordered_rack",
        "source": "project",
        "modules": [{
            "id": "obsidian", "type": "dual_high_gain",
            "parameters": {"mode": 0, "gain": 0.82, "tight": 0.72, "bass": 0.58, "mid": 0.36,
                           "treble": 0.64, "presence": 0.62, "depth": 0.68, "sag": 0.2, "master": 0.62},
        }],
    }
    source = tmp_path / "high-gain-project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert 'DspModuleInfo{"obsidian", "dual_high_gain"' in result
    assert 'DspParameterInfo{0, "mode", 0.0f}' in result
    assert 'DspParameterInfo{0, "sag", 0.2f}' in result


def test_compiles_all_creative_effect_parameters(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    parameters = {
        "chorus": {"mix": 0.4, "rate": 0.3, "depth": 0.6, "delay": 0.5, "feedback": 0.3, "stereo": 0.8},
        "flanger": {"mix": 0.4, "rate": 0.3, "depth": 0.6, "manual": 0.4, "feedback": 0.7, "stereo": 0.6},
        "tremolo": {"mix": 1, "rate": 0.5, "depth": 0.7, "shape": 0.4, "stereo": 0.5},
        "vibrato": {"mix": 1, "rate": 0.4, "depth": 0.5, "stereo": 0.4},
        "digital_delay": {"mix": 0.3, "time": 0.6, "feedback": 0.4, "tone": 0.6, "character": 0.7, "stereo": 0.35},
        "reverb": {"mix": 0.25, "mode": 1, "size": 0.6, "decay": 0.55, "damping": 0.5, "pre_delay": 0.2, "modulation": 0.2},
        "shimmer": {"mix": 0.3, "size": 0.7, "decay": 0.7, "damping": 0.45, "pre_delay": 0.2, "shimmer": 0.55},
    }
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "project", "modules": [
        {"id": module_type, "type": module_type, "name": module_type, "parameters": module_parameters}
        for module_type, module_parameters in parameters.items()
    ]}
    source = tmp_path / "creative-effects.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")
    MODULE.compile_manifest(source, output)
    result = output.read_text(encoding="utf-8")
    assert "std::array<DspModuleInfo, 7> kDspModules" in result
    for module_type in parameters:
        assert f'"{module_type}"' in result
    assert 'DspParameterInfo{4, "character", 0.7f}' in result
    assert 'DspParameterInfo{5, "mode", 1.0f}' in result
    assert 'DspParameterInfo{6, "shimmer", 0.55f}' in result


def test_compiles_complete_amp_simulator_fixture_with_module_automation(tmp_path):
    source = Path(__file__).parent / "fixtures" / "amp-simulator-effect.json"
    output = tmp_path / "NativeProject.h"

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "std::array<DspModuleInfo, 6> kDspModules" in result
    assert "std::array<DspParameterInfo, 17> kDspParameters" in result
    assert "std::array<ControlInfo, 15> kControls" in result
    assert 'ControlInfo{"gate-threshold", "knob", "Gate Threshold", "Gate Threshold", "ON", "threshold", 1,' in result
    assert 'ControlInfo{"amp-master", "knob", "Master", "Master", "ON", "master", 3,' in result
    assert 'ControlInfo{"cab-mic", "knob", "Mic", "Mic", "ON", "mic_position", 4,' in result


def test_native_manifest_accepts_96_controls_and_rejects_97(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["interface"]["controls"] = [
        {"id": f"control-{index}", "kind": "knob", "label": f"K{index}", "parameter": "tone"}
        for index in range(96)
    ]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)
    assert "std::array<ControlInfo, 96> kControls" in output.read_text(encoding="utf-8")

    spec["interface"]["controls"].append({
        "id": "control-96", "kind": "knob", "label": "K96", "parameter": "tone",
    })
    source.write_text(json.dumps(spec), encoding="utf-8")
    try:
        MODULE.compile_manifest(source, output)
    except SystemExit as error:
        assert "supported collection limit" in str(error)
    else:
        raise AssertionError("expected 97 controls to exceed the native manifest limit")


def test_native_manifest_allows_three_bundled_prism_context_controls(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "samples": [], "sampler_map": [], "sampler_groups": []})
    spec["interface"]["controls"] = [
        {"id": f"control-{index}", "kind": "knob", "label": f"K{index}", "parameter": "tone"}
        for index in range(95)
    ] + [{
        "id": "analyzer", "kind": "spectrum", "label": "Spectrum", "parameter": "output_level",
        "component_variant": "realtime-spectrum", "prism_control_mode": "contextual",
    }] + [{
        "id": f"context-{name}", "kind": "knob", "label": name.title(), "parameter": f"prism_{name}",
        "prism_context": name, "prism_owner_id": "analyzer",
    } for name in ("frequency", "gain", "q")]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "std::array<ControlInfo, 99> kControls" in result
    assert "kPrismContextualEnabled = true" in result


def test_compiles_prism_eq_native_dsp_profile(tmp_path):
    spec = project_spec()
    spec.update({
        "name": "Prism Spectrum EQ",
        "plugin_kind": "effect",
        "project_template": "prismeq",
        "dsp_profile": "prism_eq",
        "samples": [],
        "sampler_map": [],
        "sampler_groups": [],
    })
    spec["interface"]["controls"].append({
        "id": "low-cut", "kind": "knob", "label": "Low Cut", "parameter": "tone",
        "value": 20, "frequency": 30000, "q": 40, "spectrum_band": True,
    })
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kIsEffect = true" in result
    assert "kIsPrismEq = true" in result
    assert "kHasPrismModule = false" in result
    assert 'kVstCategory = "Fx|EQ|Stereo"' in result
    assert "kPrismLowCutFrequency = 30000.0f" in result
    assert "kPrismLowCutQ = 40.0f" in result
    assert "kPrismBandFrequencies" in result
    assert "kPrismBandQs" in result
    assert "kPrismBandEnabled" in result
    assert 'true, true}' in next(line for line in result.splitlines() if 'ControlInfo{"low-cut"' in line)


def test_explicit_prism_module_enables_contextual_native_routing(tmp_path):
    spec = project_spec()
    spec.update({"plugin_kind": "effect", "project_template": "prismeq", "samples": [], "sampler_map": [], "sampler_groups": []})
    prism = {"id": "prism", "type": "prism_eq", "name": "Prism", "order": 0, "bypassed": False, "mix": 1, "parameters": {"band_1_enabled": 1}}
    spec["engine_modules"] = [prism]
    spec["dsp_graph"] = {"version": 2, "mode": "ordered_rack", "source": "project", "modules": [prism]}
    spec["interface"]["controls"] = [{
        "id": "analyzer", "kind": "spectrum", "label": "Spectrum", "parameter": "output_level",
        "component_variant": "realtime-spectrum", "prism_control_mode": "contextual",
    }] + [{
        "id": f"context-{name}", "kind": "knob", "label": name.title(), "parameter": f"prism_{name}",
        "module_id": "prism", "prism_context": name, "prism_owner_id": "analyzer",
    } for name in ("frequency", "gain", "q")]
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    result = output.read_text(encoding="utf-8")
    assert "kIsPrismEq = false" in result
    assert "kHasPrismModule = true" in result
    assert "kPrismContextualEnabled = true" in result
    assert '"prism_frequency", 0' in result
    assert '"prism_gain", 0' in result
    assert '"prism_q", 0' in result


def test_marks_neon_drums_for_preview_matched_native_dsp(tmp_path):
    spec = project_spec()
    spec["project_template"] = "neonpopdrums"
    source = tmp_path / "project.json"
    output = tmp_path / "NativeProject.h"
    source.write_text(json.dumps(spec), encoding="utf-8")

    MODULE.compile_manifest(source, output)

    assert "kIsNeonDrums = true" in output.read_text(encoding="utf-8")
