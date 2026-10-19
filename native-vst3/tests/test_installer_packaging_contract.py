from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = ROOT.parent


def test_macos_builder_outputs_pkg_and_scoped_uninstaller_app():
    script = (ROOT / "build-macos.sh").read_text(encoding="utf-8")
    uninstaller = (ROOT / "packaging/macos/uninstall.applescript").read_text(encoding="utf-8")

    assert "pkgbuild" in script
    assert 'pkg-root/Library/Audio/Plug-Ins/VST3' in script
    assert 'Uninstall ${bundle_name}.app' in script
    assert "codesign --verify --deep --strict \"$uninstaller\"" in script
    assert "pluginPath does not start with vstRoot" in uninstaller
    assert 'packageId does not start with "com.triplesidestudio.vst3."' in uninstaller
    assert "preset" in uninstaller.lower()
    assert "rm -rf -- " in uninstaller
    assert "rm -rf /Library/Audio/Plug-Ins/VST3" not in uninstaller


def test_windows_builder_outputs_inno_exe_with_registered_uninstaller():
    script = (ROOT / "build-windows.ps1").read_text(encoding="utf-8")

    assert "Resolve-InnoSetupCompiler" in script
    assert "Uninstallable=yes" in script
    assert "UninstallDisplayName=" in script
    assert "UninstallFilesDir=" in script
    assert "{commoncf64}\\VST3\\" in script
    assert "-windows-vst3-setup" in script
    assert "-windows-vst3-installer.zip" in script
    assert "[UninstallDelete]" not in script


def test_smoke_workflows_are_manual_and_do_not_touch_customer_queue():
    macos = (REPOSITORY / ".github/workflows/native-vst3-macos.yml").read_text(encoding="utf-8")
    windows = (REPOSITORY / ".github/workflows/native-vst3-windows.yml").read_text(encoding="utf-8")

    assert "workflow_dispatch:" in macos
    assert "workflow_dispatch:" in windows
    assert "Inno Setup 6" in windows
    assert "*.exe" in windows
    assert "/vst-worker/jobs/" not in macos
    assert "/vst-worker/jobs/" not in windows


def test_physical_windows_worker_passes_inno_compiler_explicitly():
    worker = (REPOSITORY / "tools/run-windows-vst-worker.ps1").read_text(encoding="utf-8")

    assert "Inno Setup 6\\ISCC.exe" in worker
    assert "InnoSetupCompiler = $InnoSetupCompiler" in worker
