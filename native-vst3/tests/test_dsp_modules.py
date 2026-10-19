import subprocess
from pathlib import Path


NATIVE_ROOT = Path(__file__).parents[1]


def test_gain_modules_keep_legacy_laws_and_smooth_changes(tmp_path):
    harness = tmp_path / "dsp_modules_test.cpp"
    executable = tmp_path / "dsp_modules_test"
    harness.write_text(
        r'''
#include "DspModules.h"
#include <cassert>
#include <cmath>

using tripleside::dsp::GainLaw;
using tripleside::dsp::CrossDelay;
using tripleside::dsp::DryWet;
using tripleside::dsp::EffectRack;
using tripleside::dsp::LinkedCompressor;
using tripleside::dsp::ProcessSpec;
using tripleside::dsp::RackModuleConfig;
using tripleside::dsp::RackModuleType;
using tripleside::dsp::StereoChorus;
using tripleside::dsp::StereoReverb;
using tripleside::dsp::TempoDelay;
using tripleside::dsp::SoftClip;
using tripleside::dsp::StereoGain;
using tripleside::dsp::StereoWidth;
using tripleside::dsp::ToneShaper;
using tripleside::dsp::NoiseGate;
using tripleside::dsp::AmpOverdrive;
using tripleside::dsp::AmpModel;
using tripleside::dsp::DualHighGainAmp;
using tripleside::dsp::CabinetIr;

bool close(float left, float right, float tolerance = 1.0e-5f) {
    return std::abs(left - right) <= tolerance;
}

int main() {
    assert(close(StereoGain::gainForNormalized(GainLaw::Linear, 1.0f), 1.0f));
    assert(close(StereoGain::gainForNormalized(GainLaw::Linear, 0.5f), 0.5f));
    assert(close(StereoGain::gainForNormalized(GainLaw::InputTrim, 0.5f), 1.0f));
    assert(close(StereoGain::gainForNormalized(GainLaw::OutputTrim, 0.75f), 1.0f));
    assert(close(StereoGain::gainForNormalized(GainLaw::InputTrim, 0.0f), 0.0f));
    assert(close(StereoGain::gainForNormalized(GainLaw::OutputTrim, 0.0f), 0.0f));

    StereoGain gain(GainLaw::Linear, 10.0);
    gain.prepare(ProcessSpec{1000.0, 64});
    gain.reset(1.0f);
    gain.setNormalized(0.0f);
    float previous = 1.0f;
    for (int sample = 0; sample < 10; ++sample) {
        float left = 1.0f;
        float right = 1.0f;
        gain.processFrame(left, right);
        assert(left <= previous);
        assert(close(left, right));
        previous = left;
    }
    assert(close(previous, 0.0f));

    SoftClip clip;
    clip.prepare(ProcessSpec{48000.0, 64});
    clip.reset(1.0f);
    float clippedLeft = 0.5f;
    float clippedRight = -0.5f;
    for (int sample = 0; sample < 128; ++sample) {
        clippedLeft = 0.5f;
        clippedRight = -0.5f;
        clip.processFrame(clippedLeft, clippedRight);
    }
    assert(clippedLeft > 0.5f);
    assert(close(clippedLeft, -clippedRight));

    LinkedCompressor compressor;
    compressor.prepare(ProcessSpec{48000.0, 64});
    compressor.reset(1.0f);
    float compressedLeft = 1.0f;
    float compressedRight = 1.0f;
    for (int sample = 0; sample < 4800; ++sample) {
        compressedLeft = compressedRight = 1.0f;
        compressor.processFrame(compressedLeft, compressedRight);
    }
    assert(compressor.gainReduction() < 1.0f);
    assert(compressedLeft < 1.0f);

    ToneShaper tone;
    tone.prepare(ProcessSpec{48000.0, 64});
    tone.reset(0.5f);
    float toneLeft = 0.25f;
    float toneRight = -0.25f;
    tone.processFrame(toneLeft, toneRight);
    assert(std::isfinite(toneLeft));
    assert(std::isfinite(toneRight));

    StereoWidth width;
    width.prepare(ProcessSpec{48000.0, 64});
    width.reset(0.0f);
    float monoLeft = 1.0f;
    float monoRight = 0.0f;
    width.processFrame(monoLeft, monoRight);
    assert(close(monoLeft, 0.5f));
    assert(close(monoRight, 0.5f));

    NoiseGate gate;
    gate.prepare(ProcessSpec{48000.0, 64});
    gate.reset(0.4f);
    float ampLeft = 0.2f;
    float ampRight = -0.2f;
    for (int sample = 0; sample < 512; ++sample) {
        ampLeft = 0.2f;
        ampRight = -0.2f;
        gate.processFrame(ampLeft, ampRight);
    }
    assert(ampLeft > 0.1f);

    AmpOverdrive overdrive;
    overdrive.prepare(ProcessSpec{48000.0, 64});
    overdrive.reset(0.7f);
    overdrive.setTone(0.6f);
    overdrive.setLevel(0.5f);
    ampLeft = 0.25f;
    ampRight = -0.25f;
    for (int sample = 0; sample < 128; ++sample) {
        ampLeft = 0.25f;
        ampRight = -0.25f;
        overdrive.processFrame(ampLeft, ampRight);
    }
    assert(std::isfinite(ampLeft));
    assert(std::abs(ampLeft) > 0.25f);

    AmpModel amp;
    amp.prepare(ProcessSpec{48000.0, 64});
    amp.reset(0.55f);
    amp.setBass(0.6f);
    amp.setMid(0.45f);
    amp.setTreble(0.65f);
    amp.setPresence(0.4f);
    amp.setMaster(0.75f);
    ampLeft = 0.2f;
    ampRight = -0.2f;
    amp.processFrame(ampLeft, ampRight);
    assert(std::isfinite(ampLeft));
    assert(std::isfinite(ampRight));
    assert(ampLeft != 0.2f);

    DualHighGainAmp highGain;
    highGain.prepare(ProcessSpec{48000.0, 64});
    highGain.reset(0.82f);
    highGain.setMode(0.0f);
    highGain.setTight(0.72f);
    highGain.setBass(0.58f);
    highGain.setMid(0.36f);
    highGain.setTreble(0.64f);
    highGain.setPresence(0.62f);
    highGain.setDepth(0.68f);
    highGain.setSag(0.2f);
    highGain.setMaster(0.62f);
    ampLeft = 0.08f;
    ampRight = -0.08f;
    for (int sample = 0; sample < 2048; ++sample) {
        ampLeft = std::sin(static_cast<float>(sample) * 0.061f) * 0.08f;
        ampRight = ampLeft;
        highGain.processFrame(ampLeft, ampRight);
        assert(std::isfinite(ampLeft));
        assert(std::isfinite(ampRight));
    }
    assert(std::abs(ampLeft) > 0.001f);

    // A nominal guitar DI must not jump toward full scale merely because the
    // nonlinear amp stage is engaged. Both models include a -12 dB internal
    // reference calibration while their user-facing Master remains relative.
    AmpModel calibratedAmp;
    calibratedAmp.prepare(ProcessSpec{48000.0, 64});
    calibratedAmp.reset(0.55f);
    calibratedAmp.setBass(0.6f);
    calibratedAmp.setMid(0.45f);
    calibratedAmp.setTreble(0.65f);
    calibratedAmp.setPresence(0.4f);
    calibratedAmp.setMaster(0.75f);
    DualHighGainAmp calibratedHighGain;
    calibratedHighGain.prepare(ProcessSpec{48000.0, 64});
    calibratedHighGain.reset(0.82f);
    calibratedHighGain.setMode(0.0f);
    calibratedHighGain.setTight(0.72f);
    calibratedHighGain.setBass(0.58f);
    calibratedHighGain.setMid(0.36f);
    calibratedHighGain.setTreble(0.64f);
    calibratedHighGain.setPresence(0.62f);
    calibratedHighGain.setDepth(0.68f);
    calibratedHighGain.setSag(0.2f);
    calibratedHighGain.setMaster(0.62f);
    double inputEnergy = 0.0;
    double ampEnergy = 0.0;
    double highGainEnergy = 0.0;
    for (int sample = 0; sample < 48000; ++sample) {
        const float input = 0.12f * (
            0.72f * std::sin(2.0f * 3.14159265358979323846f * 82.4f * static_cast<float>(sample) / 48000.0f)
            + 0.22f * std::sin(2.0f * 3.14159265358979323846f * 164.8f * static_cast<float>(sample) / 48000.0f)
            + 0.12f * std::sin(2.0f * 3.14159265358979323846f * 247.2f * static_cast<float>(sample) / 48000.0f));
        float ampOutput = input;
        float ampOutputRight = input;
        float highGainOutput = input;
        float highGainOutputRight = input;
        calibratedAmp.processFrame(ampOutput, ampOutputRight);
        calibratedHighGain.processFrame(highGainOutput, highGainOutputRight);
        if (sample >= 12000) {
            inputEnergy += static_cast<double>(input) * input;
            ampEnergy += static_cast<double>(ampOutput) * ampOutput;
            highGainEnergy += static_cast<double>(highGainOutput) * highGainOutput;
        }
    }
    assert(std::sqrt(ampEnergy / inputEnergy) < 3.0);
    assert(std::sqrt(highGainEnergy / inputEnergy) < 3.0);

    CabinetIr cabinet;
    cabinet.prepare(ProcessSpec{48000.0, 64});
    cabinet.reset(0.5f);
    cabinet.setMicPosition(0.5f);
    cabinet.setMicBlend(0.25f);
    cabinet.setDistance(0.1f);
    cabinet.setLowCut(0.2f);
    cabinet.setHighCut(0.48f);
    cabinet.setResonance(0.5f);
    cabinet.setLevel(0.5f);
    ampLeft = 1.0f;
    ampRight = 0.0f;
    cabinet.processFrame(ampLeft, ampRight);
    assert(ampLeft > 0.0f);
    assert(ampLeft < 1.0f);
    float cabinetTailEnergy = 0.0f;
    for (int sample = 1; sample < 512; ++sample) {
        ampLeft = ampRight = 0.0f;
        cabinet.processFrame(ampLeft, ampRight);
        if (sample >= 64) cabinetTailEnergy += ampLeft * ampLeft;
        assert(std::isfinite(ampLeft));
        assert(std::isfinite(ampRight));
    }
    assert(cabinetTailEnergy > 1.0e-8f);

    CabinetIr customCabinet;
    customCabinet.prepare(ProcessSpec{48000.0, 64});
    customCabinet.reset(0.5f);
    customCabinet.setCustomImpulse(std::vector<std::size_t>{2}, std::vector<float>{1.0f});
    float customOutput[4]{};
    for (int sample = 0; sample < 4; ++sample) {
        float customLeft = sample == 0 ? 1.0f : 0.0f;
        float customRight = 0.0f;
        customCabinet.processFrame(customLeft, customRight);
        customOutput[sample] = customLeft;
    }
    assert(close(customOutput[0], 0.0f));
    assert(close(customOutput[1], 0.0f));
    assert(std::abs(customOutput[2]) > 0.01f);

    CrossDelay delay;
    delay.prepare(ProcessSpec{1000.0, 64});
    delay.reset(1.0f);
    float delayLeft = 1.0f;
    float delayRight = 0.0f;
    delay.processFrame(delayLeft, delayRight);
    for (int sample = 1; sample < 190; ++sample) {
        delayLeft = delayRight = 0.0f;
        delay.processFrame(delayLeft, delayRight);
    }
    delayLeft = delayRight = 0.0f;
    delay.processFrame(delayLeft, delayRight);
    assert(close(delayLeft, 0.32f));

    DryWet dryWet;
    dryWet.prepare(ProcessSpec{48000.0, 64});
    dryWet.reset(0.0f);
    float wetLeft = 0.0f;
    float wetRight = 1.0f;
    dryWet.processFrame(1.0f, 0.0f, wetLeft, wetRight);
    assert(close(wetLeft, 1.0f));
    assert(close(wetRight, 0.0f));

    EffectRack rack;
    rack.configure(ProcessSpec{48000.0, 64}, {
        RackModuleConfig{RackModuleType::InputTrim, false, 1.0f, 0.5f, true},
        RackModuleConfig{RackModuleType::StereoWidth, false, 1.0f, 0.0f, false},
        RackModuleConfig{RackModuleType::OutputTrim, false, 1.0f, 0.75f, true},
    });
    assert(rack.size() == 3);
    float rackLeft = 1.0f;
    float rackRight = 0.0f;
    rack.processFrame(rackLeft, rackRight);
    assert(close(rackLeft, 0.5f));
    assert(close(rackRight, 0.5f));
    rack.setWidth(1.0f);
    for (int sample = 0; sample < 480; ++sample) {
        rackLeft = 1.0f;
        rackRight = 0.0f;
        rack.processFrame(rackLeft, rackRight);
    }
    assert(rackLeft > 1.0f);
    assert(rackRight < 0.0f);

    EffectRack mixedRack;
    mixedRack.configure(ProcessSpec{48000.0, 64}, {
        RackModuleConfig{RackModuleType::StereoWidth, false, 0.5f, 0.0f, false},
    });
    rackLeft = 1.0f;
    rackRight = 0.0f;
    mixedRack.processFrame(rackLeft, rackRight);
    assert(close(rackLeft, 0.75f));
    assert(close(rackRight, 0.25f));

    EffectRack bypassedRack;
    bypassedRack.configure(ProcessSpec{48000.0, 64}, {
        RackModuleConfig{RackModuleType::StereoWidth, true, 1.0f, 0.0f, false},
    });
    rackLeft = 1.0f;
    rackRight = 0.0f;
    bypassedRack.processFrame(rackLeft, rackRight);
    assert(close(rackLeft, 1.0f));
    assert(close(rackRight, 0.0f));
    bypassedRack.setModuleBypassed(0, false);
    bypassedRack.setModuleNormalized(0, 0.0f);
    bypassedRack.setModuleMix(0, 0.5f);
    for (int sample = 0; sample < 480; ++sample) {
        rackLeft = 1.0f;
        rackRight = 0.0f;
        bypassedRack.processFrame(rackLeft, rackRight);
    }
    assert(close(rackLeft, 0.75f));
    assert(close(rackRight, 0.25f));

    EffectRack detailedRack;
    detailedRack.configure(ProcessSpec{48000.0, 64}, {
        RackModuleConfig{RackModuleType::LinkedCompressor, false, 1.0f, 0.0f, false},
        RackModuleConfig{RackModuleType::ToneShaper, false, 1.0f, 0.5f, false},
    });
    detailedRack.setModuleParameter(0, "threshold", 0.25f);
    detailedRack.setModuleParameter(0, "ratio", 0.8f);
    detailedRack.setModuleParameter(0, "attack", 0.1f);
    detailedRack.setModuleParameter(0, "release", 0.5f);
    detailedRack.setModuleParameter(0, "makeup", 0.1f);
    detailedRack.setModuleParameter(1, "low", 0.6f);
    detailedRack.setModuleParameter(1, "mid", 0.4f);
    detailedRack.setModuleParameter(1, "high", 0.7f);
    rackLeft = rackRight = 0.8f;
    for (int sample = 0; sample < 2048; ++sample) {
        rackLeft = rackRight = 0.8f;
        detailedRack.processFrame(rackLeft, rackRight);
    }
    assert(std::isfinite(rackLeft));
    assert(rackLeft != 0.8f);
    assert(detailedRack.gainReduction(0) > 0.0f);
    assert(close(detailedRack.gainReduction(1), 0.0f));

    TempoDelay tempoDelay;
    tempoDelay.prepare(ProcessSpec{1000.0, 64});
    tempoDelay.reset(0.0f);
    tempoDelay.setTempoBpm(120.0f);
    float effectLeft = 1.0f;
    float effectRight = 0.0f;
    tempoDelay.processFrame(effectLeft, effectRight);
    for (int sample = 1; sample < 250; ++sample) {
        effectLeft = effectRight = 0.0f;
        tempoDelay.processFrame(effectLeft, effectRight);
    }
    effectLeft = effectRight = 0.0f;
    tempoDelay.processFrame(effectLeft, effectRight);
    assert(close(effectLeft, 0.06f));

    StereoChorus chorus;
    chorus.prepare(ProcessSpec{1000.0, 64});
    chorus.reset(0.0f);
    effectLeft = 1.0f;
    effectRight = 0.0f;
    chorus.processFrame(effectLeft, effectRight);
    for (int sample = 1; sample <= 28; ++sample) {
        effectLeft = effectRight = 0.0f;
        chorus.processFrame(effectLeft, effectRight);
    }
    assert(std::isfinite(effectLeft));
    assert(std::isfinite(effectRight));

    StereoReverb reverb;
    reverb.prepare(ProcessSpec{1000.0, 64});
    reverb.reset(0.0f);
    effectLeft = 1.0f;
    effectRight = 0.0f;
    reverb.processFrame(effectLeft, effectRight);
    for (int sample = 1; sample < 79; ++sample) {
        effectLeft = effectRight = 0.0f;
        reverb.processFrame(effectLeft, effectRight);
    }
    effectLeft = effectRight = 0.0f;
    reverb.processFrame(effectLeft, effectRight);
    assert(effectLeft > 0.07f);

    const RackModuleType creativeTypes[] = {
        RackModuleType::Chorus, RackModuleType::Flanger, RackModuleType::Tremolo,
        RackModuleType::Vibrato, RackModuleType::DigitalDelay, RackModuleType::Reverb, RackModuleType::Shimmer,
    };
    for (const auto type : creativeTypes) {
        EffectRack creative;
        creative.configure(ProcessSpec{1000.0, 64}, {RackModuleConfig{type, false, 1.0f, 0.65f, false}});
        creative.setModuleParameter(0, "rate", 0.4f);
        creative.setModuleParameter(0, "depth", 0.65f);
        creative.setModuleParameter(0, "time", 0.2f);
        creative.setModuleParameter(0, "decay", 0.6f);
        creative.setModuleParameter(0, "pre_delay", 0.0f);
        creative.setModuleParameter(0, "shimmer", 0.6f);
        double energy = 0.0;
        for (int sample = 0; sample < 1200; ++sample) {
            float creativeLeft = sample == 0 ? 1.0f : std::sin(static_cast<float>(sample) * 0.11f) * 0.1f;
            float creativeRight = sample == 0 ? 0.5f : creativeLeft * -0.7f;
            creative.processFrame(creativeLeft, creativeRight);
            assert(std::isfinite(creativeLeft));
            assert(std::isfinite(creativeRight));
            energy += static_cast<double>(creativeLeft) * creativeLeft + static_cast<double>(creativeRight) * creativeRight;
        }
        assert(energy > 1.0e-5);
    }
    return 0;
}
''',
        encoding="utf-8",
    )

    subprocess.run(
        [
            "g++",
            "-std=c++20",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(NATIVE_ROOT / "Source"),
            str(harness),
            str(NATIVE_ROOT / "Source" / "DspModules.cpp"),
            "-o",
            str(executable),
        ],
        check=True,
    )
    subprocess.run([str(executable)], check=True)


def test_native_runtime_routes_gain_stages_through_modules():
    source = (NATIVE_ROOT / "Source" / "NativeInstrument.cpp").read_text(encoding="utf-8")
    header = (NATIVE_ROOT / "Source" / "NativeInstrument.h").read_text(encoding="utf-8")
    cmake = (NATIVE_ROOT / "CMakeLists.txt").read_text(encoding="utf-8")

    assert "instrumentMasterGain.processFrame(sl,sr)" in source
    assert "effectInputTrim.processFrame(inputDryL,inputDryR)" in source
    assert "effectOutputTrim.processFrame(l,r)" in source
    assert "effectRack.processFrame(l,r)" in source
    assert "project::kDspModules" in source
    assert "rackModuleValue(module,type,fallback,follows)" in source
    assert "parameterForControl(size_t index)" in source
    assert "applyModuleControl(static_cast<size_t>(id-kModuleControlBaseId),v)" in source
    assert "applyModulePresetValue(static_cast<size_t>(control.moduleIndex),control.parameter,value)" in source
    assert 'effectRack.setModuleParameter(moduleIndex,parameter,!std::strcmp(parameter,"gain_db")?rawValue:value)' in source
    assert "effectRack.setModuleParameter(static_cast<size_t>(parameter.moduleIndex),parameter.key,clamp01(parameter.value))" in source
    assert "instrumentDelay.setTempoBpm" in source
    assert "project::kSaturationEnabled" in source
    assert "project::kChorusEnabled" in source
    assert "project::kDelayEnabled" in source
    assert "project::kReverbEnabled" in source
    assert "dsp::StereoGain instrumentMasterGain" in header
    assert "dsp::EffectRack effectRack" in header
    assert "kModuleControlBaseId=10000" in header
    assert "Source/DspModules.cpp" in cmake
