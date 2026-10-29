import math
import struct
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[2]
NATIVE_ROOT = ROOT / "native-vst3"


def render_outputs(tmp_path, custom_ir=False, creative=False, advanced=False, legend=False, reverb_mode=None):
    input_path = tmp_path / "input.f32"
    native_path = tmp_path / "native.f32"
    browser_path = tmp_path / "browser.f32"
    executable = tmp_path / "dsp_parity"
    samples = [
        math.sin(index * 2 * math.pi * 110 / 48000) * 0.12
        + math.sin(index * 2 * math.pi * 221.43 / 48000) * 0.035
        for index in range(16384)
    ]
    input_path.write_bytes(struct.pack(f"<{len(samples)}f", *samples))
    subprocess.run([
        "g++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
        "-I", str(NATIVE_ROOT / "Source"), str(NATIVE_ROOT / "tests" / "dsp_parity_harness.cpp"),
        str(NATIVE_ROOT / "Source" / "DspModules.cpp"), "-o", str(executable),
    ], check=True)
    native_command = [str(executable), str(input_path), str(native_path)]
    browser_command = [
        "node", str(ROOT / "frontend" / "scripts" / "render_vst_dsp_parity_fixture.cjs"),
        str(input_path), str(browser_path),
    ]
    if custom_ir:
        native_command.append("--custom-ir")
        browser_command.append("--custom-ir")
    if creative:
        native_command.append("--creative")
        browser_command.append("--creative")
    if advanced:
        native_command.append("--advanced")
        browser_command.append("--advanced")
    if legend:
        native_command.append("--legend")
        browser_command.append("--legend")
    if reverb_mode is not None:
        fixture = f"--reverb-{reverb_mode}"
        native_command.append(fixture)
        browser_command.append(fixture)
    subprocess.run(native_command, check=True)
    subprocess.run(browser_command, check=True)
    native = struct.unpack(f"<{native_path.stat().st_size // 4}f", native_path.read_bytes())
    browser = struct.unpack(f"<{browser_path.stat().st_size // 4}f", browser_path.read_bytes())
    native = native[2048:]
    browser = browser[2048:]
    dot = sum(left * right for left, right in zip(native, browser))
    native_energy = sum(value * value for value in native)
    browser_energy = sum(value * value for value in browser)
    correlation = dot / math.sqrt(native_energy * browser_energy)
    normalized_error = math.sqrt(sum((left - right) ** 2 for left, right in zip(native, browser)) / native_energy)
    return correlation, normalized_error


def test_obsidian_browser_and_native_outputs_track_each_other(tmp_path):
    correlation, normalized_error = render_outputs(tmp_path)
    assert correlation > 0.999
    assert normalized_error < 0.025


def test_custom_cabinet_ir_browser_and_native_outputs_track_each_other(tmp_path):
    correlation, normalized_error = render_outputs(tmp_path, custom_ir=True)
    assert correlation > 0.999
    assert normalized_error < 0.025


def test_new_creative_effects_track_between_browser_and_native(tmp_path):
    correlation, normalized_error = render_outputs(tmp_path, creative=True)
    assert correlation > 0.995
    assert normalized_error < 0.08


def test_parametric_eq_and_multiband_track_between_browser_and_native(tmp_path):
    correlation, normalized_error = render_outputs(tmp_path, advanced=True)
    assert correlation > 0.9999
    assert normalized_error < 0.005


def test_classic_legend_wrappers_track_browser_proxy_chain(tmp_path):
    correlation, normalized_error = render_outputs(tmp_path, legend=True)
    assert correlation > 0.999
    assert normalized_error < 0.03


@pytest.mark.parametrize("mode", ["room", "spring", "plate", "hall"])
def test_each_smooth_reverb_mode_tracks_browser_directly(tmp_path, mode):
    correlation, normalized_error = render_outputs(tmp_path, reverb_mode=mode)
    assert correlation > 0.999
    assert normalized_error < 0.03
