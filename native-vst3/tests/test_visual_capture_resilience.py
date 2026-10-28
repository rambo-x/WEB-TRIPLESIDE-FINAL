import importlib.util
import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


MODULE_PATH = Path(__file__).parents[1] / "tools" / "render_visual_assets.py"
SPEC = importlib.util.spec_from_file_location("render_visual_assets", MODULE_PATH)
RENDERER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(RENDERER)

VERIFIER_MODULE_PATH = Path(__file__).parents[1] / "tools" / "verify_visual_assets.py"
VERIFIER_SPEC = importlib.util.spec_from_file_location("verify_visual_assets", VERIFIER_MODULE_PATH)
VERIFIER = importlib.util.module_from_spec(VERIFIER_SPEC)
assert VERIFIER_SPEC.loader is not None
VERIFIER_SPEC.loader.exec_module(VERIFIER)


def test_only_transient_playwright_failures_are_retryable():
    assert RENDERER.is_transient_capture_error(PlaywrightTimeoutError("page.goto timed out"))
    assert RENDERER.is_transient_capture_error(
        PlaywrightError("Target page, context or browser has been closed")
    )
    assert RENDERER.is_transient_capture_error(PlaywrightError("net::ERR_CONNECTION_RESET"))
    assert not RENDERER.is_transient_capture_error(
        PlaywrightError("BrowserType.launch: Executable doesn't exist")
    )
    assert not RENDERER.is_transient_capture_error(ValueError("Canvas geometry differs"))


def test_capture_cleanup_preserves_normalized_background(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    removed = (
        "visual_manifest.json",
        "visual_reference.png",
        "visual_reference_active.png",
        "visual_backdrop.png",
        "visual_control_0.png",
        "visual_keys_2.png",
        "visual_panel_reference_0.png",
        "visual_panel_backdrop_0.png",
        "visual_panel_recomposed_0.png",
        "visual_panel_difference_0.png",
        "visual_panel_comparison_0.json",
        "visual_recomposed.png",
        "visual_difference_active.png",
        "visual_comparison.json",
    )
    for name in removed:
        (assets / name).write_bytes(b"stale")
    background = assets / "ui_background.png"
    background.write_bytes(b"keep")

    RENDERER.clear_visual_capture_outputs(assets)

    assert all(not (assets / name).exists() for name in removed)
    assert background.read_bytes() == b"keep"


def test_context_delta_recomposes_backdrop_dependent_pixels_exactly():
    backdrop = Image.new("RGBA", (4, 3), (10, 20, 30, 255))
    context = backdrop.copy()
    context.putpixel((1, 1), (40, 50, 60, 255))
    context.putpixel((2, 1), (11, 20, 30, 255))

    delta = RENDERER.bake_context_delta(context, backdrop)
    recomposed = backdrop.copy()
    recomposed.alpha_composite(delta)

    assert recomposed.tobytes() == context.tobytes()
    assert delta.getpixel((0, 0))[3] == 0
    assert delta.getpixel((1, 1))[3] == 255


def test_closed_and_open_panel_composition_are_verified_separately(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    spec = {
        "interface": {
            "controls": [
                {"id": "main", "kind": "image", "value": 0},
                {"id": "child", "kind": "image", "value": 0, "parent_panel_id": "panel"},
            ]
        }
    }
    (tmp_path / "project.json").write_text(json.dumps(spec), encoding="utf-8")
    manifest = {
        "controls": [
            {"file": "main.png", "rect": {"x": 0, "y": 0, "width": 1, "height": 1}, "frames": 1, "columns": 1},
            {"file": "child.png", "rect": {"x": 2, "y": 2, "width": 1, "height": 1}, "frames": 1, "columns": 1},
        ],
        "keys": [],
        "panels": [{"id": "panel", "reference": "panel-reference.png", "backdrop": "panel-backdrop.png"}],
    }
    (assets / "visual_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    backdrop = Image.new("RGBA", (4, 4), (10, 20, 30, 255))
    main = Image.new("RGBA", (1, 1), (200, 10, 10, 255))
    child = Image.new("RGBA", (1, 1), (10, 200, 10, 255))
    main.save(assets / "main.png")
    child.save(assets / "child.png")
    backdrop.save(assets / "visual_backdrop.png")
    closed_reference = backdrop.copy()
    closed_reference.alpha_composite(main, (0, 0))
    closed_reference.save(assets / "visual_reference.png")
    panel_backdrop = closed_reference.copy()
    panel_backdrop.save(assets / "panel-backdrop.png")
    panel_reference = panel_backdrop.copy()
    panel_reference.alpha_composite(child, (2, 2))
    panel_reference.save(assets / "panel-reference.png")

    closed_report = VERIFIER.verify(tmp_path / "project.json")
    panel_reports = VERIFIER.verify_panels(tmp_path / "project.json")

    assert closed_report["percent_within_8"] == 100
    assert panel_reports[0]["percent_within_8"] == 100


def test_live_analyzers_keep_the_shared_preview_contract():
    assert "spectrum" in RENDERER.SUPPORTED_CONTROL_KINDS


def test_fader_capture_records_the_live_inline_meter_track_geometry():
    source = MODULE_PATH.read_text(encoding="utf-8")

    assert "kind == 'fader' and control.get('fader_meter_enabled', True)" in source
    assert "'.maker-fader-inline-meter .maker-gain-meter__channels > i'" in source
    assert "meter_channels = [meter_hit]" in source


def test_output_selector_capture_has_exactly_master_and_target_frames():
    spec = {
        "sampler_groups": [
            {"id": "kick", "output_bus": "separate"},
            {"id": "snare", "output_bus": "master"},
            {"id": "hat", "output_bus": "separate"},
        ]
    }

    assert "output_selector" in RENDERER.SUPPORTED_CONTROL_KINDS
    assert RENDERER.control_frame_count("output_selector", spec) == 2
    assert RENDERER.control_frame_count("knob", spec) == 101


def test_combined_solo_mute_uses_native_runtime_state_over_one_idle_frame():
    assert "solo_mute" in RENDERER.SUPPORTED_CONTROL_KINDS
    assert RENDERER.control_frame_count("solo_mute", {}) == 1


def test_linked_indicator_verification_uses_source_state_and_capture_override():
    controls = [
        {"id": "power", "kind": "button", "parameter": "bypass", "value": 0},
        {"id": "led", "kind": "indicator", "value": 0, "indicator_source_id": "power"},
    ]

    assert VERIFIER.control_frame_value(controls[1], controls, {}) == 100
    assert VERIFIER.control_frame_value(controls[1], controls, {"id": "led", "value": 0}) == 0
    assert VERIFIER.control_frame_value(controls[1], controls, {"id": "led", "value": 100}) == 100


def test_live_pattern_controls_and_linked_indicators_start_in_transient_off_state():
    controls = [
        {
            "id": "pattern-button",
            "kind": "button",
            "value": 100,
            "midi_sequence_id": "pattern-1",
        },
        {
            "id": "pattern-led",
            "kind": "indicator",
            "value": 0,
            "indicator_source_id": "pattern-button",
        },
    ]

    assert VERIFIER.control_frame_value(controls[0], controls, {}) == 0
    assert VERIFIER.control_frame_value(controls[1], controls, {}) == 0
    active = {"id": "pattern-button", "value": 100}
    assert VERIFIER.control_frame_value(controls[0], controls, active) == 100
    assert VERIFIER.control_frame_value(controls[1], controls, active) == 100


def test_windows_build_retries_visual_capture_once_only():
    script = (Path(__file__).parents[1] / "build-windows.ps1").read_text(encoding="utf-8")
    assert '$ErrorActionPreference = "Continue"' in script
    assert '$VisualAttempt -le 2' in script
    assert '$VisualResult.ExitCode -eq 75 -and $VisualAttempt -eq 1' in script
    assert 'stdout/stderr lengkap' in script


def test_worker_uses_shared_browser_instead_of_system_profile_cache():
    script = (Path(__file__).parents[2] / "tools" / "run-windows-vst-worker.ps1").read_text(
        encoding="utf-8"
    )
    assert '$PlaywrightBrowsersPath = "C:\\TripleSideWorker\\ms-playwright"' in script
    assert 'function Resolve-VisualBrowser' in script
    assert '$BuildParameters.VisualBrowser = Resolve-VisualBrowser' in script


def test_worker_reports_compiler_heartbeat_progress():
    script = (Path(__file__).parents[2] / "tools" / "run-windows-vst-worker.ps1").read_text(
        encoding="utf-8"
    )
    assert "Start-Job -ScriptBlock" in script
    assert "Wait-Job -Job $CompilerJob -Timeout 15" in script
    assert '$HeartbeatProgress = [Math]::Min(88, $HeartbeatProgress + 2)' in script
    assert 'Set-BuildStatus $Job "building" $HeartbeatProgress' in script
