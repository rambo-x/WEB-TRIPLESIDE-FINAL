import struct
import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[2]
NATIVE_ROOT = ROOT / "native-vst3"


def extensible_pcm24_wave():
    samples = (-0x400000, 0x200000, 0x100000, -0x080000)
    audio = b"".join(value.to_bytes(3, "little", signed=True) for value in samples)
    subtype_pcm = bytes.fromhex("0100000000001000800000aa00389b71")
    fmt = struct.pack("<HHIIHHHHI", 0xFFFE, 2, 48000, 48000 * 6, 6, 24, 22, 24, 3)
    fmt += subtype_pcm
    body = b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(audio)) + audio
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WAVE" + body


def test_decodes_wave_format_extensible_pcm24(tmp_path):
    wave_path = tmp_path / "extensible.wav"
    wave_path.write_bytes(extensible_pcm24_wave())
    harness = tmp_path / "wav_harness.cpp"
    harness.write_text(r'''
#include "WavFile.h"
#include <cmath>
#include <string>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    tripleside::native::WavFile wave;
    std::string error;
    if (!tripleside::native::WavFile::load(argv[1], wave, error)) return 3;
    if (wave.sampleRate != 48000 || wave.channels != 2 || wave.frameCount() != 2) return 4;
    if (std::abs(wave.sample(0, 0) + 0.5f) > 1.0e-6f) return 5;
    if (std::abs(wave.sample(0, 1) - 0.25f) > 1.0e-6f) return 6;
    return 0;
}
''', encoding="utf-8")
    executable = tmp_path / "wav_harness"
    subprocess.run([
        "g++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
        "-I", str(NATIVE_ROOT / "Source"), str(harness),
        str(NATIVE_ROOT / "Source" / "WavFile.cpp"), "-o", str(executable),
    ], check=True)
    subprocess.run([str(executable), str(wave_path)], check=True)
