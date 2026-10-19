import importlib.util
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


MODULE_PATH = Path(__file__).parents[1] / "tools" / "render_visual_assets.py"
SPEC = importlib.util.spec_from_file_location("render_visual_assets", MODULE_PATH)
RENDERER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(RENDERER)


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


def test_live_analyzers_keep_the_shared_preview_contract():
    assert "spectrum" in RENDERER.SUPPORTED_CONTROL_KINDS


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
