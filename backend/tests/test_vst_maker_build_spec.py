import pytest
from fastapi import HTTPException

from routers.vst_maker import (
    VstMakerEngineModuleInput,
    VstMakerImpulseResponseInput,
    VstMakerProjectInput,
    VstMakerSampleMappingInput,
    _ready_build_spec,
    vst_maker_build_spec,
)


def project_document(**overrides):
    project = {
        "id": "project-1",
        "name": "Studio Piano",
        "manufacturer_name": "TripleSide Studio",
        "plugin_version": "1.2.3",
        "instrument_type": "Piano",
        "root_note": "C3",
        "note_range": "C1–C6",
        "velocity_layers": 2,
        "polyphony": 32,
        "brand_tagline": "Concert instrument",
        "brand_font": "outfit",
        "brand_size": 24,
        "brand_x": 18,
        "brand_y": 13,
        "brand_align": "left",
        "ui_template": "studio",
        "ui_color": "#132238",
        "accent_color": "#e11d48",
        "canvas_width": 760,
        "canvas_height": 480,
        "background_image_url": None,
        "background_image_name": None,
        "background_fit": "cover",
        "background_opacity": 70,
        "background_image_x": 50,
        "background_image_y": 50,
        "background_image_width": 100,
        "background_image_height": 100,
        "effects": {"reverb": True, "delay": True},
        "interface_controls": [{
            "id": "volume-1", "kind": "knob", "label": "Volume",
            "parameter": "volume", "module_id": None, "x": 20, "y": 40,
            "value": 80, "width": 112, "height": 122, "label_position": "bottom-right", "label_gap": 5,
        }],
        "engine_modules": [],
        "piano_roll_notes": [],
        "samples": [{"id": "sample-1", "filename": "Piano C3.wav", "size_bytes": 1024}],
        "sample_mappings": [{
            "id": "zone-1", "sample_id": "sample-1", "root_pitch": 60,
            "low_pitch": 48, "high_pitch": 72, "velocity_low": 1,
            "velocity_high": 127, "group_name": "Main",
            "articulation": "Sustain", "round_robin": 1,
            "mic_position": "Main", "sample_start": 0.0, "sample_end": 1.0,
            "loop_enabled": False, "loop_start": 0.0, "loop_end": 1.0,
            "loop_crossfade_ms": 8,
            "fade_in_ms": 0, "fade_out_ms": 0, "tune_semitones": -12, "tune_cents": 0,
            "playback_mode": "tempo_sync", "source_bpm": 96.0, "source_bpm_confirmed": True,
            "choke_target_pitches": [44, 46],
            "gain_db": 0.0, "pan": 0.0,
        }],
    }
    project.update(overrides)
    return project


def test_project_resize_mode_defaults_locked_and_accepts_free_mode():
    payload = project_document()
    payload.pop("id")
    locked = VstMakerProjectInput(**payload)
    free = VstMakerProjectInput(**{**payload, "resize_aspect_locked": False})

    assert locked.resize_aspect_locked is True
    assert free.resize_aspect_locked is False


def test_build_spec_converts_api_fields_to_native_contract():
    spec = vst_maker_build_spec(project_document(sustain_enabled=True))

    assert spec["schema_version"] == "1.0"
    assert spec["samples"][0]["name"] == "Piano C3.wav"
    assert spec["sampler_map"][0]["sampleId"] == "sample-1"
    assert spec["sampler_map"][0]["rootPitch"] == 60
    assert spec["sampler_map"][0]["tuneSemitones"] == -12
    assert spec["sampler_map"][0]["playbackMode"] == "tempo_sync"
    assert spec["sampler_map"][0]["sourceBpm"] == 96.0
    assert spec["sampler_map"][0]["loopCrossfadeMs"] == 8
    assert spec["sampler_map"][0]["chokeTargetPitches"] == [44, 46]
    assert spec["instrument"]["sustainEnabled"] is True
    assert spec["build"] == {
        "company_name": "TripleSide Studio",
        "version": "1.2.3",
        "formats": ["VST3"],
        "platforms": ["windows"],
    }
    assert spec["sample_packaging"] == {"mode": "private_object_storage", "monolith": False}
    assert spec["interface"]["background"] == {
        "url": None,
        "name": None,
        "fit": "cover",
        "opacity": 70,
        "x": 50,
        "y": 50,
        "width": 100,
        "height": 100,
    }
    assert spec["interface"]["component_style"] == "css"
    assert spec["interface"]["ui_color"] == "#132238"
    assert spec["interface"]["controls"][0]["label_position"] == "bottom-right"
    assert spec["interface"]["controls"][0]["label_gap"] == 5
    assert spec["interface"]["filmstrip_skin"] is None
    assert spec["visual_contract"] == {"version": 1, "mode": "shared_preview"}


def test_build_spec_preserves_stereo_meter_mode():
    project = project_document(interface_controls=[{
        "id": "meter-1", "kind": "gain_meter", "label": "Output",
        "parameter": "output_level", "module_id": None, "x": 80, "y": 50,
        "value": 0, "width": 96, "height": 180, "meter_mode": "stereo",
    }])

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["meter_mode"] == "stereo"


def test_build_spec_preserves_integrated_fader_meter_configuration():
    project = project_document(interface_controls=[{
        "id": "volume-fader", "kind": "fader", "label": "Volume",
        "parameter": "volume", "module_id": None, "x": 50, "y": 50,
        "value": 80, "width": 92, "height": 220,
        "fader_meter_enabled": True,
        "fader_meter_position": "left",
        "fader_meter_color": "#12ABEF",
        "fader_meter_gap": 9,
        "fader_meter_width": 14,
        "fader_meter_height": 72,
    }])

    payload = project.copy()
    payload.pop("id")
    parsed = VstMakerProjectInput(**payload)
    control = parsed.interface_controls[0]
    assert control.fader_meter_enabled is True
    assert control.fader_meter_position == "left"
    assert control.fader_meter_color == "#12ABEF"
    assert control.fader_meter_gap == 9
    assert control.fader_meter_width == 14
    assert control.fader_meter_height == 72

    spec = vst_maker_build_spec(project)
    assert spec["interface"]["controls"][0]["fader_meter_enabled"] is True
    assert spec["interface"]["controls"][0]["fader_meter_position"] == "left"
    assert spec["interface"]["controls"][0]["fader_meter_color"] == "#12ABEF"
    assert spec["interface"]["controls"][0]["fader_meter_gap"] == 9
    assert spec["interface"]["controls"][0]["fader_meter_width"] == 14
    assert spec["interface"]["controls"][0]["fader_meter_height"] == 72


def test_build_spec_preserves_combined_solo_mute_appearance_and_target():
    control = {
        "id": "solo-mute-main", "kind": "solo_mute", "label": "Channel State",
        "parameter": "solo_mute", "sampler_group_id": "main", "module_id": None,
        "x": 50, "y": 50, "value": 0, "width": 160, "height": 86,
        "solo_mute_gap": 13, "solo_color": "#12ABEF", "mute_color": "#EF4444",
        "button_shape": "capsule",
    }
    sampler_groups = [{
        "id": "main", "name": "Main", "volume": 100, "pan": 0,
        "mute": False, "solo": True, "output_bus": "master",
    }]
    payload = project_document(interface_controls=[control], sampler_groups=sampler_groups)
    parsed_payload = payload.copy()
    parsed_payload.pop("id")
    parsed = VstMakerProjectInput(**parsed_payload)
    parsed_control = parsed.interface_controls[0]
    assert parsed_control.solo_mute_gap == 13
    assert parsed_control.solo_color == "#12ABEF"
    assert parsed_control.mute_color == "#EF4444"
    assert parsed_control.button_shape == "capsule"

    spec = vst_maker_build_spec(payload)
    assert spec["interface"]["controls"][0]["sampler_group_id"] == "main"
    assert spec["interface"]["controls"][0]["solo_mute_gap"] == 13
    assert spec["interface"]["controls"][0]["solo_color"] == "#12ABEF"
    assert spec["interface"]["controls"][0]["mute_color"] == "#EF4444"
    assert spec["interface"]["controls"][0]["button_shape"] == "capsule"


def test_build_spec_normalizes_semantic_toggle_gap_without_repurposing_label_y():
    controls = [{
        "id": "toggle-new", "kind": "button", "label": "Power", "parameter": "bypass",
        "x": 40, "y": 50, "value": 0, "width": 100, "height": 132,
        "component_variant": "mechanical-toggle", "label_x": 11, "label_y": 17,
        "state_label_gap": 32,
    }, {
        "id": "toggle-legacy", "kind": "button", "label": "Legacy", "parameter": "bypass",
        "x": 60, "y": 50, "value": 0, "width": 100, "height": 132,
        "component_variant": "mechanical-toggle", "label_y": -5,
    }]

    spec = vst_maker_build_spec(project_document(interface_controls=controls))

    assert spec["interface"]["controls"][0]["state_label_gap"] == 32
    assert spec["interface"]["controls"][0]["label_x"] == 11
    assert spec["interface"]["controls"][0]["label_y"] == 17
    assert spec["interface"]["controls"][1]["state_label_gap"] == 0
    assert spec["interface"]["controls"][1]["label_y"] == -5


def test_build_spec_preserves_compressor_gain_reduction_meter_binding():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        engine_modules=[{"id": "comp", "type": "linked_compressor", "name": "Compressor"}],
        interface_controls=[{
            "id": "gr-meter", "kind": "vu_meter", "label": "Gain Reduction",
            "parameter": "gain_reduction", "module_id": "comp", "x": 50, "y": 50,
            "value": 0, "width": 180, "height": 120, "meter_mode": "mono",
        }],
    )

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["parameter"] == "gain_reduction"
    assert spec["interface"]["controls"][0]["module_id"] == "comp"
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])
    assert not any(warning["code"] == "unsupported_module_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_preserves_master_pan_control():
    project = project_document(interface_controls=[{
        "id": "pan-1", "kind": "knob", "label": "Pan L–R",
        "parameter": "pan", "module_id": None, "x": 50, "y": 50,
        "value": 25, "width": 112, "height": 122,
        "component_variant": "pan",
    }])

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["parameter"] == "pan"
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_preserves_panel_features_for_native_export():
    controls = [
        {
            "id": "midi-panel", "kind": "panel_button", "label": "MIDI",
            "parameter": "visual", "x": 12, "y": 12, "value": 0,
            "width": 148, "height": 64, "panel_type": "midi_map",
            "panel_x": 48, "panel_y": 50, "panel_width": 76, "panel_height": 64,
        },
        {
            "id": "tone-child", "kind": "knob", "label": "Tone",
            "parameter": "tone", "x": 25, "y": 40, "value": 50,
            "width": 112, "height": 122, "parent_panel_id": "midi-panel",
        },
    ]
    presets = [{
        "id": "preset-1", "name": "Bright", "category": "user",
        "control_values": {"tone-child": 82}, "group_values": {},
    }]
    midi_mappings = [{
        "id": "mapping-1", "source_type": "cc", "channel": 0,
        "source_number": 74, "target_control_id": "tone-child",
        "minimum": 0, "maximum": 100, "inverted": False,
    }]
    midi_sequences = [{
        "id": "sequence-1", "name": "Phrase", "ppq": 480,
        "duration_ticks": 480, "events": [], "tempos": [{"tick": 0, "bpm": 120}],
    }]

    spec = vst_maker_build_spec(project_document(
        interface_controls=controls,
        presets=presets,
        midi_mappings=midi_mappings,
        midi_sequences=midi_sequences,
    ))

    assert spec["interface"]["controls"][0]["panel_type"] == "midi_map"
    assert spec["interface"]["controls"][0]["panel_width"] == 76
    assert spec["interface"]["controls"][1]["parent_panel_id"] == "midi-panel"
    assert spec["presets"] == presets
    assert spec["midi_mappings"] == []
    assert spec["midi_sequences"] == midi_sequences


def test_effect_build_spec_emits_legacy_compatible_dsp_rack_v2():
    spec = vst_maker_build_spec(project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="mixforge",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        engine_modules=[],
    ))

    assert spec["dsp_graph"]["version"] == 2
    assert spec["dsp_graph"]["mode"] == "ordered_rack"
    assert spec["dsp_graph"]["source"] == "legacy_compatibility"
    assert [module["type"] for module in spec["dsp_graph"]["modules"]] == [
        "input_trim",
        "soft_clip",
        "linked_compressor",
        "tone_shaper",
        "stereo_width",
        "cross_delay",
        "dry_wet",
        "output_trim",
    ]


def test_custom_dsp_rack_is_sorted_and_preserves_parameters():
    spec = vst_maker_build_spec(project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        engine_modules=[
            {"id": "output", "type": "output-trim", "name": "Output", "order": 20, "mix": 1, "parameters": {"gain_db": -1.5}},
            {"id": "clip", "type": "soft_clip", "name": "Clip", "order": 10, "mix": 0.75, "parameters": {"drive": 0.6}},
        ],
    ))

    assert [module["id"] for module in spec["dsp_graph"]["modules"]] == ["clip", "output"]
    assert spec["dsp_graph"]["modules"][0]["mix"] == 0.75
    assert spec["dsp_graph"]["modules"][0]["parameters"] == {"drive": 0.6}
    assert spec["compatibility"]["warnings"] == []


def test_sampler_outputs_and_scoped_dsp_are_preserved_in_build_contract():
    spec = vst_maker_build_spec(project_document(
        sampler_groups=[
            {"id": "kick", "name": "Kick", "output_bus": "separate"},
            {"id": "snare", "name": "Snare", "output_bus": "master"},
        ],
        engine_modules=[
            {"id": "kick-eq", "type": "tone_shaper", "name": "Kick EQ", "order": 2, "sampler_group_id": "kick", "parameters": {"tone": 0.7}},
            {"id": "master-out", "type": "output_trim", "name": "Master", "order": 1, "parameters": {"output": 0.5}},
        ],
        interface_controls=[{
            "id": "kick-output", "kind": "output_selector", "label": "Kick Output",
            "parameter": "group_output", "sampler_group_id": "kick",
            "x": 50, "y": 50, "value": 0, "width": 190, "height": 76,
            "control_color": "#1A2233", "text_color": "#DDEEFF", "output_font_size": 17,
        }],
    ))

    assert spec["sampler_groups"][0]["output_bus"] == "separate"
    assert spec["sampler_groups"][1]["output_bus"] == "master"
    assert spec["dsp_graph"]["modules"][1]["samplerGroupId"] == "kick"
    assert spec["dsp_graph"]["modules"][0]["samplerGroupId"] is None
    assert spec["interface"]["controls"][0]["sampler_group_id"] == "kick"
    assert spec["interface"]["controls"][0]["value"] == 100
    assert spec["interface"]["controls"][0]["control_color"] == "#1A2233"
    assert spec["interface"]["controls"][0]["text_color"] == "#DDEEFF"
    assert spec["interface"]["controls"][0]["output_font_size"] == 17


def test_sampler_bound_mixer_controls_follow_authoritative_group_values():
    controls = [
        {
            "id": "mixer", "kind": "panel_button", "label": "Mixer", "parameter": "visual",
            "panel_type": "mixer", "mixer_show_default_controls": False,
            "x": 50, "y": 50, "value": 0, "width": 148, "height": 64,
        },
        {
            "id": "snare-volume", "kind": "fader", "label": "Snare Volume", "parameter": "volume",
            "sampler_group_id": "snare", "parent_panel_id": "mixer",
            "x": 25, "y": 45, "value": 1, "width": 72, "height": 180,
        },
        {
            "id": "snare-pan", "kind": "knob", "label": "Snare Pan", "parameter": "pan",
            "sampler_group_id": "snare", "parent_panel_id": "mixer",
            "x": 50, "y": 45, "value": 1, "width": 96, "height": 96,
        },
        {
            "id": "snare-mute", "kind": "mute", "label": "Snare Mute", "parameter": "mute",
            "sampler_group_id": "snare", "parent_panel_id": "mixer",
            "x": 70, "y": 45, "value": 0, "width": 72, "height": 72,
        },
    ]
    payload = project_document(
        sampler_groups=[
            {"id": "kick", "name": "Kick", "volume": 91, "pan": -0.2, "mute": False, "solo": False},
            {"id": "snare", "name": "Snare", "volume": 64, "pan": 0.3, "mute": True, "solo": False},
        ],
        interface_controls=controls,
    )
    validated = VstMakerProjectInput(**{key: value for key, value in payload.items() if key != "id"})
    spec = vst_maker_build_spec(payload)

    assert validated.interface_controls[0].mixer_show_default_controls is False
    assert [control["value"] for control in spec["interface"]["controls"][1:]] == [64, 65, 100]
    assert all(control["sampler_group_id"] == "snare" for control in spec["interface"]["controls"][1:])


def test_sampler_binding_rejects_unrelated_or_module_controls():
    payload = project_document(
        sampler_groups=[{"id": "main", "name": "Main"}],
        interface_controls=[{
            "id": "tone", "kind": "knob", "label": "Tone", "parameter": "tone",
            "sampler_group_id": "main", "x": 50, "y": 50, "value": 50,
        }],
    )
    payload.pop("id")

    with pytest.raises(ValueError, match="Volume, Pan, Mute, atau Solo"):
        VstMakerProjectInput(**payload)


def test_audio_readers_and_note_controls_accept_sampler_binding_and_preserve_blank_labels():
    controls = [
        {"id": "pad", "kind": "pad", "label": "", "parameter": "visual", "sampler_group_id": "snare", "x": 20, "y": 20, "value": 0},
        {"id": "keys", "kind": "keyboard", "label": "", "parameter": "visual", "sampler_group_id": "snare", "x": 50, "y": 70, "value": 0, "width": 560, "height": 150},
        {"id": "meter", "kind": "gain_meter", "label": "", "parameter": "output_level", "sampler_group_id": "snare", "x": 70, "y": 20, "value": 0},
        {"id": "scope", "kind": "spectrum", "label": "", "parameter": "output_level", "sampler_group_id": "snare", "x": 50, "y": 40, "value": 0, "width": 320, "height": 160},
        {"id": "led", "kind": "indicator", "label": "", "parameter": "mute", "sampler_group_id": "snare", "x": 80, "y": 20, "value": 0, "width": 24, "height": 24},
    ]
    payload = project_document(sampler_groups=[{"id": "snare", "name": "Snare", "mute": True}], interface_controls=controls)
    validated = VstMakerProjectInput(**{key: value for key, value in payload.items() if key != "id"})
    spec = vst_maker_build_spec(payload)

    assert [control.label for control in validated.interface_controls] == [""] * len(controls)
    assert [control["sampler_group_id"] for control in spec["interface"]["controls"]] == ["snare"] * len(controls)
    assert [control["label"] for control in spec["interface"]["controls"]] == [""] * len(controls)


def test_build_spec_rejects_orphan_sampler_binding_even_without_schema_round_trip():
    payload = project_document(interface_controls=[{
        "id": "meter", "kind": "gain_meter", "label": "Meter", "parameter": "output_level",
        "sampler_group_id": "missing", "x": 50, "y": 50, "value": 0,
    }])

    with pytest.raises(ValueError, match="sampler yang tidak tersedia"):
        vst_maker_build_spec(payload)


def test_effect_project_rejects_sampler_output_selector():
    payload = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        interface_controls=[{
            "id": "output", "kind": "output_selector", "label": "Output",
            "parameter": "group_output", "sampler_group_id": "main",
            "x": 50, "y": 50, "value": 0, "width": 190, "height": 76,
        }],
    )
    payload.pop("id")

    with pytest.raises(ValueError, match="hanya tersedia untuk plugin instrumen"):
        VstMakerProjectInput(**payload)


def test_project_rejects_dsp_target_for_unknown_sampler():
    payload = project_document(engine_modules=[{
        "id": "orphan", "type": "tone_shaper", "name": "Orphan",
        "sampler_group_id": "missing", "parameters": {"tone": 0.5},
    }])
    payload.pop("id")

    with pytest.raises(ValueError, match="sampler yang tidak tersedia"):
        VstMakerProjectInput(**payload)


def test_project_accepts_one_tuning_module_per_master_and_sampler_target():
    payload = project_document(
        sampler_groups=[
            {"id": "main", "name": "Main"},
            {"id": "snare", "name": "Snare"},
        ],
        engine_modules=[
            {"id": "master-tune", "type": "tuning", "name": "Master Tune"},
            {"id": "main-tune", "type": "tuning", "name": "Main Tune", "sampler_group_id": "main"},
            {"id": "snare-tune", "type": "tuning", "name": "Snare Tune", "sampler_group_id": "snare"},
        ],
    )
    payload.pop("id")

    parsed = VstMakerProjectInput(**payload)

    assert [module.sampler_group_id for module in parsed.engine_modules] == [None, "main", "snare"]


def test_project_rejects_same_sampler_mute_solo_conflict_but_allows_multi_solo():
    conflict = project_document(sampler_groups=[{
        "id": "main", "name": "Main", "mute": True, "solo": True,
    }])
    conflict.pop("id")
    with pytest.raises(ValueError, match="Mute dan Solo sampler yang sama"):
        VstMakerProjectInput(**conflict)

    multiple = project_document(sampler_groups=[
        {"id": "kick", "name": "Kick", "solo": True},
        {"id": "snare", "name": "Snare", "solo": True},
    ])
    multiple.pop("id")
    parsed = VstMakerProjectInput(**multiple)
    assert [group.solo for group in parsed.sampler_groups] == [True, True]


def test_project_rejects_duplicate_tuning_target():
    payload = project_document(engine_modules=[
        {"id": "tune-a", "type": "tuning", "name": "Tune A"},
        {"id": "tune-b", "type": "tuning", "name": "Tune B"},
    ])
    payload.pop("id")

    with pytest.raises(ValueError, match="Setiap target hanya dapat memakai satu modul Tuning"):
        VstMakerProjectInput(**payload)


def test_legacy_build_document_warns_about_ignored_static_module_parameter():
    spec = vst_maker_build_spec(project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        engine_modules=[{
            "id": "clip", "type": "soft_clip", "name": "Clip",
            "parameters": {"drive": 0.5, "mystery": 0.25},
        }],
    ))
    warning = next(item for item in spec["compatibility"]["warnings"] if item["code"] == "unsupported_module_parameters")
    assert warning["items"] == ["clip.mystery"]


def test_supported_module_control_binding_has_native_automation():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        engine_modules=[{"id": "clip", "type": "soft_clip", "name": "Clip"}],
        interface_controls=[{
            "id": "drive", "kind": "knob", "label": "Drive", "parameter": "drive",
            "module_id": "clip", "x": 50, "y": 50, "value": 35, "width": 112, "height": 122,
        }],
    )

    spec = vst_maker_build_spec(project)

    warning_codes = {warning["code"] for warning in spec["compatibility"]["warnings"]}
    assert "module_automation_pending" not in warning_codes
    assert "unsupported_module_parameters" not in warning_codes


def test_detailed_compressor_controls_have_native_automation():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        engine_modules=[{"id": "comp", "type": "linked_compressor", "name": "Compressor"}],
        interface_controls=[{
            "id": parameter, "kind": "knob", "label": parameter.title(), "parameter": parameter,
            "module_id": "comp", "x": 50, "y": 50, "value": 35, "width": 112, "height": 122,
        } for parameter in ("threshold", "ratio", "attack", "release", "makeup")],
    )

    spec = vst_maker_build_spec(project)

    warning_codes = {warning["code"] for warning in spec["compatibility"]["warnings"]}
    assert "unsupported_module_parameters" not in warning_codes


def test_original_amp_chain_has_native_compatibility():
    modules = [
        {"id": "gate", "type": "noise_gate", "parameters": {"threshold": 0.4, "release": 0.5}},
        {"id": "drive", "type": "amp_overdrive", "parameters": {"drive": 0.6, "tone": 0.55, "level": 0.5}},
        {"id": "amp", "type": "amp_model", "parameters": {"gain": 0.55, "bass": 0.6, "mid": 0.45, "treble": 0.65, "presence": 0.4, "master": 0.75}},
        {"id": "cab", "type": "cabinet_ir", "parameters": {"cabinet": 0.5, "mic_position": 0.55, "resonance": 0.5, "level": 0.5}},
    ]
    spec = vst_maker_build_spec(project_document(
        plugin_kind="effect", instrument_type="Audio Effect", project_template="basicfx",
        samples=[], sample_mappings=[], sampler_groups=[], engine_modules=modules,
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
    ))

    warning_codes = {warning["code"] for warning in spec["compatibility"]["warnings"]}
    assert "unsupported_dsp_modules" not in warning_codes
    assert "unsupported_module_parameters" not in warning_codes


def test_custom_cabinet_ir_is_validated_and_emitted_with_uploaded_asset():
    impulse = VstMakerImpulseResponseInput(
        id="ir-1", module_id="cab", filename="My Cabinet.wav", size_bytes=4096,
        normalize=False, auto_trim=False, trim_start=0.1, trim_end=0.9,
        polarity_inverted=True, phase_ms=-0.75,
    )
    project = project_document(
        plugin_kind="effect", instrument_type="Audio Effect", project_template="basicfx",
        samples=[], sample_mappings=[], sampler_groups=[{"id": "main", "name": "Main"}],
        engine_modules=[{"id": "cab", "type": "cabinet_ir", "name": "Cabinet"}],
        impulse_responses=[impulse.model_dump()],
    )
    asset = {
        "id": "vst-ir:project-1:ir-1", "asset_kind": "impulse_response",
        "sample_id": "ir-1", "filename": "My Cabinet.wav", "size_bytes": 4096,
        "sha256": "abc123",
    }

    spec = vst_maker_build_spec(project, [asset])

    assert spec["impulse_responses"] == [{
        "id": "ir-1", "moduleId": "cab", "name": "cabinet_ir_000.wav",
        "originalName": "My Cabinet.wav", "bytes": 4096,
        "assetId": "vst-ir:project-1:ir-1", "sha256": "abc123",
        "normalize": False, "autoTrim": False, "trimStart": 0.1, "trimEnd": 0.9,
        "polarityInverted": True, "phaseMs": -0.75,
    }]
    assert _ready_build_spec(project, [asset], require_uploaded=True)["impulse_responses"]


def test_project_rejects_duplicate_or_dangling_cabinet_ir_assignments():
    base = project_document(
        plugin_kind="effect", instrument_type="Audio Effect", project_template="basicfx",
        samples=[], sample_mappings=[], sampler_groups=[{"id": "main", "name": "Main"}],
        engine_modules=[{"id": "cab", "type": "cabinet_ir", "name": "Cabinet"}],
    )
    base.pop("id")
    common = {"filename": "Cab.wav", "size_bytes": 4096}

    with pytest.raises(ValueError, match="Satu modul kabinet"):
        VstMakerProjectInput(**{
            **base,
            "impulse_responses": [
                {"id": "ir-a", "module_id": "cab", **common},
                {"id": "ir-b", "module_id": "cab", **common},
            ],
        })
    with pytest.raises(ValueError, match="cabinet_ir"):
        VstMakerProjectInput(**{
            **base,
            "impulse_responses": [{"id": "ir-a", "module_id": "missing", **common}],
        })


def test_unknown_module_control_parameter_reports_native_warning():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        engine_modules=[{"id": "clip", "type": "soft_clip", "name": "Clip"}],
        interface_controls=[{
            "id": "mystery", "kind": "knob", "label": "Mystery", "parameter": "threshold",
            "module_id": "clip", "x": 50, "y": 50, "value": 35, "width": 112, "height": 122,
        }],
    )

    spec = vst_maker_build_spec(project)

    warning = next(item for item in spec["compatibility"]["warnings"] if item["code"] == "unsupported_module_parameters")
    assert warning["items"] == ["clip.threshold"]


def test_dsp_module_input_validates_parameter_contract():
    module = VstMakerEngineModuleInput(
        id="compressor-a",
        type="linked_compressor",
        name="Compressor A",
        order=12,
        mix=0.5,
        parameters={"threshold_db": -18, "ratio": 4},
    )

    assert module.parameters == {"threshold_db": -18.0, "ratio": 4.0}
    with pytest.raises(ValueError):
        VstMakerEngineModuleInput(
            id="bad",
            type="soft_clip",
            name="Bad",
            parameters={"Not valid": 1},
        )


def test_mapping_contract_normalizes_multiple_choke_targets():
    mapping = project_document()["sample_mappings"][0]
    mapping["choke_target_pitches"] = [44, 46, 44]
    parsed = VstMakerSampleMappingInput(**mapping)

    assert parsed.choke_target_pitches == [44, 46]
    mapping["choke_target_pitches"] = [128]
    with pytest.raises(ValueError, match="MIDI 0–127"):
        VstMakerSampleMappingInput(**mapping)


def test_one_sample_reference_can_back_multiple_sampler_zones():
    first = project_document()["sample_mappings"][0]
    second = {
        **first,
        "id": "zone-2",
        "root_pitch": 72,
        "low_pitch": 72,
        "high_pitch": 72,
        "group_name": "Sampler 2",
    }
    payload = project_document(
        sampler_groups=[
            {"id": "sampler-main", "name": "Main"},
            {"id": "sampler-2", "name": "Sampler 2"},
        ],
        sample_mappings=[first, second],
    )
    payload.pop("id")

    parsed = VstMakerProjectInput(**payload)

    assert len(parsed.samples) == 1
    assert [mapping.sample_id for mapping in parsed.sample_mappings] == ["sample-1", "sample-1"]


def test_project_keeps_sample_storage_names_unique_case_insensitively():
    payload = project_document(samples=[
        {"id": "sample-1", "filename": "Kick.wav", "size_bytes": 1024},
        {"id": "sample-2", "filename": "KICK.WAV", "size_bytes": 1024},
    ])
    payload.pop("id")

    with pytest.raises(ValueError, match="Nama file sample harus unik"):
        VstMakerProjectInput(**payload)


def test_build_spec_preserves_custom_pad_surface_and_light_colors():
    project = project_document(interface_controls=[{
        "id": "pad-1", "kind": "pad", "label": "Kick", "parameter": "trigger",
        "module_id": None, "note_pitch": 36, "x": 20, "y": 40, "value": 0,
        "width": 108, "height": 120, "component_variant": "performance-dark",
        "pad_color": "#24242A", "pad_active_color": "#35D9FF",
    }])

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["pad_color"] == "#24242A"
    assert spec["interface"]["controls"][0]["pad_active_color"] == "#35D9FF"


def test_build_spec_preserves_static_visual_color_without_parameter_warning():
    project = project_document(interface_controls=[{
        "id": "scale-1", "kind": "visual", "label": "Scale Classic", "parameter": "visual",
        "module_id": None, "x": 50, "y": 50, "value": 0, "width": 160, "height": 160,
        "show_background": False, "component_style": "css", "component_variant": "scale-classic",
        "visual_color": "#D7B46A",
    }])

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["visual_color"] == "#D7B46A"
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_preserves_text_component_opacity_and_rotation_without_parameter_warning():
    project = project_document(interface_controls=[{
        "id": "headline", "kind": "text", "label": "MY INSTRUMENT", "parameter": "visual",
        "module_id": None, "x": 50, "y": 16, "value": 0, "width": 260, "height": 72,
        "opacity": 55, "rotation": 27.5, "show_background": False, "component_style": "css",
        "component_variant": "plain-text",
    }])

    spec = vst_maker_build_spec(project)

    assert spec["interface"]["controls"][0]["kind"] == "text"
    assert spec["interface"]["controls"][0]["opacity"] == 55
    assert spec["interface"]["controls"][0]["rotation"] == 27.5
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_accepts_keyboard_pitch_bend_and_modulation_components():
    controls = [
        {
            "id": "pitch-1", "kind": "fader", "label": "Pitch Bend", "parameter": "pitch_bend",
            "module_id": None, "x": 10, "y": 70, "value": 50, "width": 84, "height": 150,
            "component_style": "css", "component_variant": "pitch-bend-led", "control_color": "#22C55E",
        },
        {
            "id": "mod-1", "kind": "fader", "label": "Modulation", "parameter": "modulation",
            "module_id": None, "x": 18, "y": 70, "value": 0, "width": 84, "height": 150,
            "component_style": "css", "component_variant": "modulation-led", "control_color": "#38BDF8",
        },
    ]

    spec = vst_maker_build_spec(project_document(
        interface_controls=controls,
        pitch_bend_enabled=True,
        modulation_enabled=True,
    ))

    assert [control["parameter"] for control in spec["interface"]["controls"]] == ["pitch_bend", "modulation"]
    assert [control["control_color"] for control in spec["interface"]["controls"]] == ["#22C55E", "#38BDF8"]
    assert spec["instrument"]["pitchBendEnabled"] is True
    assert spec["instrument"]["modulationEnabled"] is True
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_preserves_keyboard_key_colors():
    keyboard = {
        "id": "keys-1", "kind": "keyboard", "label": "Keys", "parameter": "keyboard",
        "module_id": None, "x": 50, "y": 72, "value": 0, "width": 640, "height": 168,
        "key_count": 61, "key_colors": {"36": "#FF0088", "37": "#00AAFF"},
    }

    spec = vst_maker_build_spec(project_document(interface_controls=[keyboard]))

    assert spec["interface"]["controls"][0]["key_colors"] == {"36": "#FF0088", "37": "#00AAFF"}


def test_build_spec_preserves_realtime_waveform_bar_thickness_and_linked_led_contract():
    controls = [
        {
            "id": "power", "kind": "button", "label": "Power", "parameter": "bypass",
            "module_id": None, "x": 20, "y": 20, "value": 0, "width": 96, "height": 84,
        },
        {
            "id": "power-led", "kind": "indicator", "label": "Power LED", "parameter": "visual",
            "module_id": None, "x": 32, "y": 20, "value": 0, "width": 72, "height": 72,
            "component_variant": "round-indicator", "control_color": "#39FF88", "indicator_source_id": "power",
        },
        {
            "id": "waveform", "kind": "spectrum", "label": "Waveform", "parameter": "visual",
            "module_id": None, "x": 37.5, "y": 41.25, "value": 0, "width": 96, "height": 64,
            "component_variant": "realtime-waveform", "visual_color": "#A78BFA", "waveform_line_width": 4.2,
        },
        {
            "id": "bars", "kind": "spectrum", "label": "Bars", "parameter": "visual",
            "module_id": None, "x": 50, "y": 70, "value": 0, "width": 640, "height": 180,
            "component_variant": "bar-spectrum-visualizer", "visual_color": "#38BDF8", "bar_width_ratio": 0.73,
        },
    ]

    payload = project_document(interface_controls=controls)
    payload.pop("id")
    parsed = VstMakerProjectInput(**payload).model_dump()
    spec = vst_maker_build_spec(parsed)

    assert spec["interface"]["controls"][1]["indicator_source_id"] == "power"
    assert spec["interface"]["controls"][1]["control_color"] == "#39FF88"
    assert spec["interface"]["controls"][2]["component_variant"] == "realtime-waveform"
    assert spec["interface"]["controls"][2]["visual_color"] == "#A78BFA"
    assert spec["interface"]["controls"][2]["waveform_line_width"] == 4.2
    assert spec["interface"]["controls"][2]["x"] == 37.5
    assert spec["interface"]["controls"][2]["y"] == 41.25
    assert spec["interface"]["controls"][2]["width"] == 96
    assert spec["interface"]["controls"][2]["height"] == 64
    assert spec["interface"]["controls"][3]["component_variant"] == "bar-spectrum-visualizer"
    assert spec["interface"]["controls"][3]["bar_width_ratio"] == 0.73
    assert not any(warning["code"] == "unsupported_parameters" for warning in spec["compatibility"]["warnings"])


def test_build_spec_preserves_open_ring_thickness_without_widening_waveform_contract():
    controls = [
        {
            "id": "open-ring", "kind": "knob", "label": "Open Ring", "parameter": "tone",
            "module_id": None, "x": 30, "y": 30, "value": 65, "width": 128, "height": 128,
            "component_variant": "open-led-ring", "ring_thickness": 15.5,
            "ring_glow_intensity": 0, "waveform_line_width": 3.5, "control_color": "#39FF88",
        },
        {
            "id": "legacy-pan-ring", "kind": "knob", "label": "Legacy Pan Ring", "parameter": "pan",
            "module_id": None, "x": 70, "y": 30, "value": 50, "width": 128, "height": 128,
            "component_variant": "pan-open-led-ring", "waveform_line_width": 7.5,
            "control_color": "#C084FC",
        },
    ]
    payload = project_document(interface_controls=controls)
    payload.pop("id")

    parsed = VstMakerProjectInput(**payload).model_dump()
    spec = vst_maker_build_spec(parsed)

    assert spec["interface"]["controls"][0]["ring_thickness"] == 15.5
    assert spec["interface"]["controls"][0]["ring_glow_intensity"] == 0
    assert spec["interface"]["controls"][0]["waveform_line_width"] == 3.5
    assert spec["interface"]["controls"][0]["control_color"] == "#39FF88"
    assert spec["interface"]["controls"][1]["ring_thickness"] == 7.5
    assert spec["interface"]["controls"][1]["ring_glow_intensity"] == 65


def test_build_spec_allows_manual_expression_features_without_components():
    spec = vst_maker_build_spec(project_document(
        pitch_bend_enabled=True,
        modulation_enabled=True,
    ))

    assert spec["instrument"]["pitchBendEnabled"] is True
    assert spec["instrument"]["modulationEnabled"] is True


def test_build_spec_keeps_filmstrip_as_an_explicit_second_choice():
    spec = vst_maker_build_spec(project_document(component_style="filmstrip"))

    assert spec["interface"]["component_style"] == "filmstrip"
    assert spec["interface"]["filmstrip_skin"]["format"] == "hise-vertical-filmstrip"
    assert spec["interface"]["filmstrip_skin"]["elements"]["knob"]["frames"] == 64
    assert spec["interface"]["filmstrip_skin"]["elements"]["modern_spectrum_knob"]["frame_width"] == 1254
    assert spec["interface"]["filmstrip_skin"]["elements"]["button"]["state_order"] == [
        "off", "on", "offPressed", "onPressed", "offHover", "onHover",
    ]


def test_build_spec_removes_legacy_instrument_effects():
    spec = vst_maker_build_spec(project_document())
    assert spec["effects"] == {}
    assert spec["compatibility"]["supported_effects"] == []
    assert not any(warning["code"] == "unsupported_effects" for warning in spec["compatibility"]["warnings"])


def test_ready_build_spec_rejects_metadata_only_draft():
    with pytest.raises(HTTPException) as raised:
        _ready_build_spec(project_document(samples=[], sample_mappings=[]))

    assert raised.value.status_code == 409
    assert "Project belum memiliki sample" in raised.value.detail["issues"]
    assert "Project belum memiliki sample mapping" in raised.value.detail["issues"]


def test_ready_build_spec_accepts_wave_generator_without_samples():
    generator = {
        "id": "osc-1", "type": "wave_generator", "name": "Wave Generator",
        "order": 0, "bypassed": False, "mix": 1.0,
        "parameters": {"waveform": 0.5, "octave": 0.5, "semitone": 0.5, "fine": 0.5, "level": 0.65, "pulse_width": 0.5, "phase_reset": 1.0, "attack": 0.0, "decay": 0.2, "sustain": 0.8, "release": 0.18, "filter_cutoff": 0.75, "filter_resonance": 0.2, "filter_env_amount": 0.65, "filter_key_tracking": 0.5, "osc2_enabled": 1.0, "osc2_waveform": 0.25, "osc2_octave": 0.5, "osc2_detune": 0.54, "osc2_level": 0.35, "osc2_pulse_width": 0.5, "sub_level": 0.15, "noise_level": 0.05, "noise_color": 0.5, "unison_voices": 0.43, "unison_detune": 0.2, "stereo_spread": 0.7, "glide": 0.25, "glide_mode": 1.0, "vibrato_rate": 0.45, "vibrato_depth": 0.2, "vibrato_delay": 0.15},
    }
    generator["parameters"]["note_priority"] = 1.0
    tone = {
        "id": "tone-1", "type": "tone_shaper", "name": "Tone Shaper",
        "order": 1, "bypassed": False, "mix": 1.0, "parameters": {"tone": 0.72},
    }
    spec = _ready_build_spec(project_document(samples=[], sample_mappings=[], engine_modules=[generator, tone]))

    assert spec["dsp_graph"]["mode"] == "instrument_serial_rack"
    assert spec["dsp_graph"]["modules"][0]["type"] == "wave_generator"
    assert spec["dsp_graph"]["modules"][0]["parameters"]["glide"] == 0.25
    assert spec["dsp_graph"]["modules"][0]["parameters"]["osc2_enabled"] == 1.0
    assert spec["dsp_graph"]["modules"][0]["parameters"]["vibrato_depth"] == 0.2
    assert "note_priority" not in spec["dsp_graph"]["modules"][0]["parameters"]
    assert [module["type"] for module in spec["dsp_graph"]["modules"]] == ["wave_generator", "tone_shaper"]
    assert spec["dsp_graph"]["modules"][1]["parameters"]["tone"] == 0.72
    assert not any(warning["code"] in {"unsupported_dsp_modules", "unsupported_module_parameters"} for warning in spec["compatibility"]["warnings"])


def test_ready_build_spec_requires_uploaded_assets_for_server_build():
    with pytest.raises(HTTPException) as raised:
        _ready_build_spec(project_document(), [], require_uploaded=True)

    assert raised.value.status_code == 409
    assert "1 sample belum diunggah ke penyimpanan build" in raised.value.detail["issues"]


def test_build_spec_exposes_asset_identity_without_private_storage_key():
    asset = {
        "id": "vst-sample:project-1:sample-1",
        "sample_id": "sample-1",
        "filename": "Piano C3.wav",
        "size_bytes": 1024,
        "sha256": "a" * 64,
        "storage_key": "vst-maker/private/sample.wav",
    }
    spec = _ready_build_spec(project_document(), [asset], require_uploaded=True)

    assert spec["samples"][0]["assetId"] == asset["id"]
    assert spec["samples"][0]["sha256"] == "a" * 64
    assert "storage_key" not in spec["samples"][0]


def test_ready_build_spec_rejects_stale_asset_metadata():
    stale_asset = {
        "id": "vst-sample:project-1:sample-1",
        "sample_id": "sample-1",
        "filename": "Old Piano.wav",
        "size_bytes": 1024,
        "sha256": "b" * 64,
    }
    with pytest.raises(HTTPException) as raised:
        _ready_build_spec(project_document(), [stale_asset], require_uploaded=True)

    assert "1 sample belum diunggah ke penyimpanan build" in raised.value.detail["issues"]


def test_effect_build_spec_is_ready_without_sampler_assets():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="mixforge",
        ui_template="mixforge",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        interface_controls=[{
            "id": "drive-1", "kind": "knob", "label": "Drive",
            "parameter": "drive", "module_id": None, "x": 25, "y": 43,
            "value": 24, "width": 104, "height": 116,
        }],
    )

    spec = _ready_build_spec(project, [], require_uploaded=True)

    assert spec["plugin_kind"] == "effect"
    assert spec["samples"] == []
    assert spec["sampler_map"] == []
    assert spec["sampler_groups"] == []
    assert spec["compatibility"]["warnings"] == []


def test_prism_effect_build_spec_selects_native_eq_profile():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="prismeq",
        ui_template="arctic",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
    )

    spec = _ready_build_spec(project, [], require_uploaded=True)

    assert spec["project_template"] == "prismeq"
    assert spec["dsp_profile"] == "prism_eq"
    assert spec["visual_contract"] == {"version": 1, "mode": "shared_preview"}


def test_regent_strip_uses_shared_preview_worker_contract():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="regentstrip",
        ui_template="mixforge",
        component_style="css",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        effects={"reverb": False, "delay": False, "chorus": False, "saturation": False},
        interface_controls=[{
            "id": "preamp-1", "kind": "knob", "label": "Preamp",
            "parameter": "input", "module_id": None, "x": 10, "y": 25,
            "value": 54, "width": 112, "height": 130,
            "component_style": "css", "component_variant": "regent-cap",
        }],
    )

    spec = _ready_build_spec(project, [], require_uploaded=True)

    assert spec["project_template"] == "regentstrip"
    assert spec["dsp_profile"] == "standard"
    assert spec["visual_contract"] == {"version": 1, "mode": "shared_preview"}
    assert spec["interface"]["controls"][0]["component_variant"] == "regent-cap"


def test_standard_project_with_vectorscope_uses_shared_preview_contract():
    project = project_document(
        plugin_kind="effect",
        instrument_type="Audio Effect",
        project_template="basicfx",
        samples=[],
        sample_mappings=[],
        sampler_groups=[],
        interface_controls=[{
            "id": "scope-1", "kind": "spectrum", "label": "Stereo Vectorscope",
            "parameter": "output_level", "module_id": None, "x": 50, "y": 50,
            "value": 0, "width": 420, "height": 320,
            "component_style": "css", "component_variant": "stereo-vectorscope",
            "visual_color": "#F59E0B",
        }],
    )

    spec = _ready_build_spec(project, [], require_uploaded=True)

    assert spec["dsp_profile"] == "standard"
    assert spec["visual_contract"] == {"version": 1, "mode": "shared_preview"}
