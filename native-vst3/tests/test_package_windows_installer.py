import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/package_windows_installer.py"
SPEC = importlib.util.spec_from_file_location("package_windows_installer", MODULE_PATH)
assert SPEC and SPEC.loader
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)


def package_arguments(tmp_path: Path):
    stub = tmp_path / "setup-stub.exe"
    uninstaller = tmp_path / "uninstaller.exe"
    bundle = tmp_path / "Demo_Product.vst3"
    output = tmp_path / "Demo_Product-windows-vst3-setup.exe"
    stub.write_bytes(b"MZ" + b"stub" * 32)
    uninstaller.write_bytes(b"MZ" + b"uninstaller" * 32)
    (bundle / "Contents" / "x86_64-win").mkdir(parents=True)
    (bundle / "Contents" / "x86_64-win" / "Demo_Product.vst3").write_bytes(b"plugin module")
    return packager.parse_args(
        [
            "--stub", str(stub),
            "--uninstaller", str(uninstaller),
            "--bundle", str(bundle),
            "--output", str(output),
            "--product-name", "Demo_Product",
            "--product-version", "1.2.3",
            "--publisher", "TripleSide Studio",
            "--installer-id", "com.triplesidestudio.vst3.demo-product",
            "--verify",
        ]
    )


def test_streaming_packager_appends_and_verifies_native_payload(tmp_path):
    arguments = package_arguments(tmp_path)
    output = packager.build_package(arguments)

    assert output.read_bytes().startswith(b"MZstub")
    assert output.stat().st_size > arguments.stub.stat().st_size + arguments.uninstaller.stat().st_size
    packager.verify_package(output)


def test_package_verifier_rejects_manifest_tampering(tmp_path):
    arguments = package_arguments(tmp_path)
    output = packager.build_package(arguments)
    data = bytearray(output.read_bytes())
    data[-packager.FOOTER.size - 1] ^= 0x01
    output.write_bytes(data)

    with pytest.raises(ValueError, match="checksum"):
        packager.verify_package(output)


def test_packager_rejects_case_insensitive_duplicate_paths(tmp_path):
    arguments = package_arguments(tmp_path)
    duplicate_root = arguments.bundle / "Contents"
    (duplicate_root / "Readme.txt").write_text("one", encoding="utf-8")
    (duplicate_root / "README.TXT").write_text("two", encoding="utf-8")

    with pytest.raises(ValueError, match="Case-insensitive duplicate"):
        packager.build_package(arguments)


def test_packager_rejects_symlinks(tmp_path):
    arguments = package_arguments(tmp_path)
    source = arguments.bundle / "Contents" / "source.bin"
    source.write_bytes(b"source")
    link = arguments.bundle / "Contents" / "linked.bin"
    try:
        link.symlink_to(source)
    except OSError:
        pytest.skip("Symlinks are unavailable on this filesystem")

    with pytest.raises(ValueError, match="Symlinks are not allowed"):
        packager.build_package(arguments)
