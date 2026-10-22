from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parent


def test_macos_builder_is_universal_cached_and_queue_independent():
    script = (ROOT / "build-macos.sh").read_text(encoding="utf-8")
    workflow = (REPOSITORY / ".github/workflows/native-vst3-macos.yml").read_text(encoding="utf-8")

    assert 'architectures="arm64;x86_64"' in script
    assert 'lipo "$module" -verify_arch "$architecture"' in script
    assert "codesign --verify --deep --strict" in script
    assert 'nm -gU "$module"' in script
    assert "GetPluginFactory tidak ditemukan" in script
    assert 'cmp -s "$generated_asset" "$bundled_asset"' in script
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


def test_macos_panels_follow_preview_and_are_fully_interactive():
    view = (ROOT / "Source/NativeViewMac.mm").read_text(encoding="utf-8")

    assert 'equals(kind, "panel_button")' in view
    assert '@"PRESET BROWSER"' in view
    assert '@"GROOVE BROWSER"' in view
    assert '@"GROOVE LIBRARY"' in view
    assert "Simpan kondisi" in view
    assert '[self applyFactoryPreset:absolute]' in view
    assert 'groupParameterId(static_cast<int>(group), 1)' in view
    assert '[self startMidiSequence:source]' in view
    assert '_midiTimer' not in view
    assert '[weakSelf updateMidiPlayback]' in view
    assert '_instrument->startGroove' in view
    assert 'beginDraggingSessionWithItems:@[item]' in view
    assert '_panelDragMode = 2' in view
    assert '_grooveScrollOffset' in view
    assert 'pointingHandCursor' in view
    assert 'Tambahkan groove MIDI' not in view
    assert 'registerForDraggedTypes:@[NSPasteboardTypeFileURL]' not in view
    assert '_hiddenMidiSequences.insert(source)' not in view
    assert '[self loadUserPresets]' in view
    assert '[self persistUserPresets]' in view
    assert 'NSApplicationSupportDirectory' in view
    assert '@"OVR"' not in view
    assert '_presetNameInput' in view
    assert '_presetScrollOffset' in view
    assert '_selectedPresetRow' in view
    assert "_instrument->setLivePatternSequence" in view
    assert "_instrument->livePatternSequenceIndex() == control.midiSequenceIndex" in view
    assert '_hoveredPresetRow' in view
    assert 'NSTrackingMouseMoved' in view
    assert 'thumbHeight' in view
    assert 'bezierPathWithOvalInRect' in view
    assert '!equals(project::kControls[static_cast<std::size_t>(index)].kind, "fader")' in view


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


def test_macos_worker_reports_elapsed_compiler_time():
    worker = (REPOSITORY / "tools/run-macos-vst-worker.sh").read_text(encoding="utf-8")

    assert 'compilation_started_at="$(date +%s)"' in worker
    assert "elapsed_seconds=" in worker
    assert 'elapsed_text="$((elapsed_seconds / 60)) menit' in worker
    assert 'Compiler macOS aktif · berjalan $elapsed_text' in worker


def test_macos_worker_matches_windows_input_and_visual_contract_guards():
    worker = (REPOSITORY / "tools/run-macos-vst-worker.sh").read_text(encoding="utf-8")

    assert 'spec_sha256="$(jq -r' in worker
    assert "Runtime native Steinberg hanya menerima sample WAV" in worker
    assert "--proto '=https' --proto-redir '=https'" in worker
    assert "background_size" in worker
    assert 'dsp_profile="$(jq -r' in worker
    assert 'visual_mode="native_live"' in worker
    assert 'visual_mode="shared_preview"' in worker
    assert "resources + GetPluginFactory + pkgbuild" in worker
