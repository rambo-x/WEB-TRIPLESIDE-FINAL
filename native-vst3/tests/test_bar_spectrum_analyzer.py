import subprocess
from pathlib import Path


def test_bar_spectrum_silence_attack_release_and_lr_max(tmp_path):
    source_dir = Path(__file__).parents[1] / "Source"
    harness = tmp_path / "bar_spectrum_harness.cpp"
    binary = tmp_path / "bar_spectrum_harness"
    harness.write_text(r'''
#include "BarSpectrumAnalyzer.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>

int main() {
    using tripleside::native::BarSpectrumAnalyzer;
    static_assert(BarSpectrumAnalyzer::fftSize == 2048);
    static_assert(BarSpectrumAnalyzer::bandCount == 48);
    std::array<float, BarSpectrumAnalyzer::fftSize> silence{}, tone{};
    constexpr float sampleRate = 48000.f;
    for (std::size_t index = 0; index < tone.size(); ++index)
        tone[index] = .7f * std::sin(2.f * 3.14159265358979323846f * 1000.f * index / sampleRate);

    BarSpectrumAnalyzer analyzer;
    const auto silent = analyzer.process(silence.data(), silence.data(), silence.size(), sampleRate, .032f);
    assert(std::all_of(silent.begin(), silent.end(), [](float level) { return level == 0.f; }));

    const auto firstAttack = analyzer.process(silence.data(), tone.data(), tone.size(), sampleRate, .032f);
    const float attackOne = *std::max_element(firstAttack.begin(), firstAttack.end());
    assert(attackOne > .05f);
    const auto secondAttack = analyzer.process(silence.data(), tone.data(), tone.size(), sampleRate, .032f);
    const float attackTwo = *std::max_element(secondAttack.begin(), secondAttack.end());
    assert(attackTwo > attackOne);

    float previous = attackTwo;
    for (int frame = 0; frame < 140; ++frame) {
        const auto released = analyzer.process(silence.data(), silence.data(), silence.size(), sampleRate, .032f);
        const float current = *std::max_element(released.begin(), released.end());
        assert(current <= previous + 1e-6f);
        previous = current;
    }
    assert(previous == 0.f);
    return 0;
}
''', encoding="utf-8")
    subprocess.run([
        "g++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
        "-I", str(source_dir), str(harness), "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
