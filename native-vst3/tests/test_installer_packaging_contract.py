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


def test_windows_builder_outputs_native_exe_with_registered_uninstaller():
    script = (ROOT / "build-windows.ps1").read_text(encoding="utf-8")
    cmake = (ROOT / "CMakeLists.txt").read_text(encoding="utf-8")
    packager = (ROOT / "tools/package_windows_installer.py").read_text(encoding="utf-8")
    installer = (ROOT / "packaging/windows/InstallerMain.cpp").read_text(encoding="utf-8")
    support = (ROOT / "packaging/windows/InstallerSupport.cpp").read_text(encoding="utf-8")
    uninstaller = (ROOT / "packaging/windows/UninstallerMain.cpp").read_text(encoding="utf-8")

    assert "TripleSideWindowsInstaller" in cmake
    assert "TripleSideWindowsUninstaller" in cmake
    assert "package_windows_installer.py" in script
    assert '"--verify"' in script
    assert "GetFileNameWithoutExtension($Bundle.Name)" in script
    assert "-windows-vst3-setup" in script
    assert "-windows-vst3-uninstall.exe" in script
    assert '"--portable-uninstaller-output"' in script
    assert "-windows-vst3-installer.zip" in script
    assert "FOOTER_MAGIC" in packager
    assert "MAX_MANIFEST_BYTES" in packager
    assert "_copy_and_hash" in packager
    assert "bundleStage" in installer
    assert "registerUninstaller" in installer
    assert "FOLDERID_ProgramFilesCommon" in support
    assert "KEY_WOW64_64KEY" in support
    assert "removeTreeNoFollow" in uninstaller
    assert "unregisterProduct" in uninstaller
    assert "readPortableUninstallMetadata" in uninstaller
    assert "/MANIFESTUAC:level='requireAdministrator' uiAccess='false'" in cmake
    assert "Inno" not in script
    assert "ISCC" not in script


def test_smoke_workflows_are_manual_and_do_not_touch_customer_queue():
    macos = (REPOSITORY / ".github/workflows/native-vst3-macos.yml").read_text(encoding="utf-8")
    windows = (REPOSITORY / ".github/workflows/native-vst3-windows.yml").read_text(encoding="utf-8")

    assert "workflow_dispatch:" in macos
    assert "workflow_dispatch:" in windows
    assert "runs-on: windows-2022" in windows
    assert "Exercise installer and uninstaller" in windows
    assert "Uninstaller left the exact VST3 bundle installed" in windows
    assert "Uninstaller left the Windows Apps registration installed" in windows
    assert "Uninstaller left its product directory installed" in windows
    assert "*.exe" in windows
    assert "innosetup" not in windows.lower()
    assert "ISCC" not in windows
    assert "/vst-worker/jobs/" not in macos
    assert "/vst-worker/jobs/" not in windows


def test_physical_windows_worker_uses_repository_native_packaging():
    worker = (REPOSITORY / "tools/run-windows-vst-worker.ps1").read_text(encoding="utf-8")

    assert "Inno" not in worker
    assert "ISCC" not in worker
    assert "BuildScript = Join-Path $NativeRoot \"build-windows.ps1\"" in worker
