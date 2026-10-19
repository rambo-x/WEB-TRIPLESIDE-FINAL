from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parent


def test_macos_builder_is_universal_cached_and_queue_independent():
    script = (ROOT / "build-macos.sh").read_text(encoding="utf-8")
    workflow = (REPOSITORY / ".github/workflows/native-vst3-macos.yml").read_text(encoding="utf-8")

    assert 'architectures="arm64;x86_64"' in script
    assert 'lipo "$module" -verify_arch "$architecture"' in script
    assert "codesign --verify --deep --strict" in script
    assert "ccache" in script
    assert "workflow_dispatch:" in workflow
    assert "actions/cache@v4" in workflow
    assert "--architectures 'arm64;x86_64'" in workflow
    assert "/vst-worker/jobs/" not in workflow


def test_macos_runtime_uses_cocoa_and_bundle_resources_without_juce():
    cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
    view = (ROOT / "Source/NativeViewMac.mm").read_text(encoding="utf-8")
    instrument = (ROOT / "Source/NativeInstrument.cpp").read_text(encoding="utf-8")

    assert "Source/NativeViewMac.mm" in cmake
    assert "smtg_enable_vst3_sdk()" in cmake
    assert '"-framework Cocoa"' in cmake
    assert "TARGET_BUNDLE_CONTENT_DIR" in cmake
    assert "kPlatformTypeNSView" in view
    assert "TripleSideNativeMacView : NSView" in view
    assert "queueEditorNote" in view
    assert "parameterForControl" in view
    assert "dladdr" in instrument
    assert "JUCE" not in cmake
    assert "JUCE" not in view


def test_macos_queue_has_offset_schedule_and_server_watchdog():
    workflow = (REPOSITORY / ".github/workflows/vst-macos-worker.yml").read_text(
        encoding="utf-8"
    )
    dispatcher = (REPOSITORY / "tools/dispatch-macos-vst-worker.sh").read_text(
        encoding="utf-8"
    )

    assert "cron: '2-57/5 * * * *'" in workflow
    assert "Check without claiming a job" in workflow
    assert '"target_platform": "macos"' in dispatcher
    assert "gh_bin workflow run vst-macos-worker.yml" in dispatcher
    assert 'status == "queued"' in dispatcher
