#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace tripleside::dsp {

struct ProcessSpec {
    double sampleRate = 44100.0;
    std::int32_t maximumBlockSize = 0;
};

// Real-time-safe linear ramp. It owns no heap storage and can be updated from
// the audio thread without allocating or taking a lock.
class SmoothedValue {
public:
    void prepare(double sampleRate, double rampMilliseconds) noexcept;
    void reset(float value) noexcept;
    void setTarget(float value) noexcept;
    [[nodiscard]] float next() noexcept;
    [[nodiscard]] float current() const noexcept { return current_; }
    [[nodiscard]] float target() const noexcept { return target_; }

private:
    void updateStep() noexcept;

    float current_ = 0.0f;
    float target_ = 0.0f;
    float step_ = 0.0f;
    std::int32_t rampSamples_ = 1;
    std::int32_t remainingSamples_ = 0;
};

enum class GainLaw {
    // 0..1 maps directly to silence..unity. Used by instrument Volume.
    Linear,
    // Compatibility law for the existing Input control: mute at zero,
    // otherwise -12..+12 dB with unity at 50%.
    InputTrim,
    // Compatibility law for the existing Output control: mute at zero,
    // otherwise -12..+4 dB with unity at 75%.
    OutputTrim,
};

class StereoGain {
public:
    explicit StereoGain(GainLaw law, double smoothingMilliseconds = 10.0) noexcept;

    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

    [[nodiscard]] float currentGain() const noexcept { return gain_.current(); }
    [[nodiscard]] float targetGain() const noexcept { return gain_.target(); }
    [[nodiscard]] static float gainForNormalized(GainLaw law, float normalized) noexcept;

private:
    GainLaw law_;
    double smoothingMilliseconds_;
    ProcessSpec spec_{};
    SmoothedValue gain_{};
};

class NonlinearOversampler4x {
public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;

    template <typename Function>
    float process(float input, Function&& nonlinear) noexcept {
        float output = 0.0f;
        for (std::size_t phase = 1; phase <= kFactor; ++phase) {
            const float fraction = static_cast<float>(phase) / static_cast<float>(kFactor);
            float sample = previous_ + (input - previous_) * fraction;
            for (std::size_t section = 0; section < coefficients_.size(); ++section)
                sample = processBiquad(sample, coefficients_[section], preFilter_[section]);
            sample = nonlinear(sample);
            for (std::size_t section = 0; section < coefficients_.size(); ++section)
                sample = processBiquad(sample, coefficients_[section], postFilter_[section]);
            output = sample;
        }
        previous_ = input;
        return output;
    }

private:
    struct State { float z1 = 0.0f; float z2 = 0.0f; };
    struct Coefficients { float b0 = 1.0f; float b1 = 0.0f; float b2 = 0.0f; float a1 = 0.0f; float a2 = 0.0f; };
    static constexpr std::size_t kFactor = 4;
    static Coefficients makeLowPass(double sampleRate, float cutoff, float q) noexcept;
    static float processBiquad(float input, const Coefficients& coefficients, State& state) noexcept;
    float previous_ = 0.0f;
    std::array<Coefficients, 2> coefficients_{};
    std::array<State, 2> preFilter_{};
    std::array<State, 2> postFilter_{};
};

class SoftClip {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setCharacter(float normalized) noexcept;
    void setOutput(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    NonlinearOversampler4x leftOversampler_{};
    NonlinearOversampler4x rightOversampler_{};
    SmoothedValue amount_{};
    SmoothedValue character_{};
    SmoothedValue output_{};
};

class LinkedCompressor {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setThreshold(float normalized) noexcept;
    void setRatio(float normalized) noexcept;
    void setAttack(float normalized) noexcept;
    void setRelease(float normalized) noexcept;
    void setMakeup(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;
    [[nodiscard]] float gainReduction() const noexcept { return gainReduction_; }

private:
    double sampleRate_ = 44100.0;
    float envelope_ = 0.0f;
    float gainReduction_ = 1.0f;
    SmoothedValue amount_{};
    SmoothedValue threshold_{};
    SmoothedValue ratio_{};
    SmoothedValue attack_{};
    SmoothedValue release_{};
    SmoothedValue makeup_{};
    bool thresholdOverridden_ = false;
    bool ratioOverridden_ = false;
    bool attackOverridden_ = false;
    bool releaseOverridden_ = false;
};

class ToneShaper {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setLow(float normalized) noexcept;
    void setMid(float normalized) noexcept;
    void setHigh(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    double sampleRate_ = 44100.0;
    float lowLeft_ = 0.0f;
    float lowRight_ = 0.0f;
    float highLowLeft_ = 0.0f;
    float highLowRight_ = 0.0f;
    SmoothedValue amount_{};
    SmoothedValue lowGain_{};
    SmoothedValue midGain_{};
    SmoothedValue highGain_{};
    bool threeBandEnabled_ = false;
};

class StereoWidth {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setMonoBass(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    SmoothedValue amount_{};
    SmoothedValue monoBass_{};
    double sampleRate_ = 44100.0;
    float sideLow_ = 0.0f;
};

class NoiseGate {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setRelease(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    double sampleRate_ = 44100.0;
    float envelope_ = 0.0f;
    float gateGain_ = 0.0f;
    float detectorLowLeft_ = 0.0f;
    float detectorLowRight_ = 0.0f;
    std::int32_t holdSamplesRemaining_ = 0;
    bool open_ = false;
    SmoothedValue threshold_{};
    SmoothedValue release_{};
};

class AmpOverdrive {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setTone(float normalized) noexcept;
    void setLevel(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    NonlinearOversampler4x leftOversampler_{};
    NonlinearOversampler4x rightOversampler_{};
    double sampleRate_ = 44100.0;
    float toneLeft_ = 0.0f;
    float toneRight_ = 0.0f;
    SmoothedValue drive_{};
    SmoothedValue tone_{};
    SmoothedValue level_{};
};

class AmpModel {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setBass(float normalized) noexcept;
    void setMid(float normalized) noexcept;
    void setTreble(float normalized) noexcept;
    void setPresence(float normalized) noexcept;
    void setMaster(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    NonlinearOversampler4x leftOversampler_{};
    NonlinearOversampler4x rightOversampler_{};
    double sampleRate_ = 44100.0;
    float dcLeft_ = 0.0f;
    float dcRight_ = 0.0f;
    float lowLeft_ = 0.0f;
    float lowRight_ = 0.0f;
    float highLowLeft_ = 0.0f;
    float highLowRight_ = 0.0f;
    float sagEnvelope_ = 0.0f;
    SmoothedValue gain_{};
    SmoothedValue bass_{};
    SmoothedValue mid_{};
    SmoothedValue treble_{};
    SmoothedValue presence_{};
    SmoothedValue master_{};
};

class DualHighGainAmp {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setMode(float normalized) noexcept;
    void setTight(float normalized) noexcept;
    void setBass(float normalized) noexcept;
    void setMid(float normalized) noexcept;
    void setTreble(float normalized) noexcept;
    void setPresence(float normalized) noexcept;
    void setDepth(float normalized) noexcept;
    void setSag(float normalized) noexcept;
    void setMaster(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    struct BiquadState {
        float z1 = 0.0f;
        float z2 = 0.0f;
    };
    struct BiquadCoefficients {
        float b0 = 1.0f;
        float b1 = 0.0f;
        float b2 = 0.0f;
        float a1 = 0.0f;
        float a2 = 0.0f;
    };

    [[nodiscard]] static BiquadCoefficients makeLowPass(double sampleRate, float cutoff, float q) noexcept;
    [[nodiscard]] static float processBiquad(float input, const BiquadCoefficients& coefficients,
        BiquadState& state) noexcept;
    float processPreamp(float input, bool rectified, float gain, float tight,
        std::array<float, 4>& highPass, std::array<float, 4>& lowPass) noexcept;

    static constexpr std::size_t kOversamplingFactor = 4;
    double sampleRate_ = 44100.0;
    float previousLeft_ = 0.0f;
    float previousRight_ = 0.0f;
    std::array<BiquadCoefficients, 2> oversamplingLowPass_{};
    std::array<BiquadState, 2> preFilterLeft_{};
    std::array<BiquadState, 2> preFilterRight_{};
    std::array<BiquadState, 2> postFilterLeft_{};
    std::array<BiquadState, 2> postFilterRight_{};
    std::array<float, 4> highPassLeft_{};
    std::array<float, 4> highPassRight_{};
    std::array<float, 4> lowPassLeft_{};
    std::array<float, 4> lowPassRight_{};
    float toneLowLeft_ = 0.0f;
    float toneLowRight_ = 0.0f;
    float toneHighLowLeft_ = 0.0f;
    float toneHighLowRight_ = 0.0f;
    float presenceLowLeft_ = 0.0f;
    float presenceLowRight_ = 0.0f;
    float depthLowLeft_ = 0.0f;
    float depthLowRight_ = 0.0f;
    float speakerLowLeft_ = 0.0f;
    float speakerLowRight_ = 0.0f;
    float speakerBodyLeft_ = 0.0f;
    float speakerBodyRight_ = 0.0f;
    float transformerFluxLeft_ = 0.0f;
    float transformerFluxRight_ = 0.0f;
    float sagEnvelope_ = 0.0f;
    SmoothedValue mode_{};
    SmoothedValue gain_{};
    SmoothedValue tight_{};
    SmoothedValue bass_{};
    SmoothedValue mid_{};
    SmoothedValue treble_{};
    SmoothedValue presence_{};
    SmoothedValue depth_{};
    SmoothedValue sag_{};
    SmoothedValue master_{};
};

class SilkBloomAmp {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setMode(float normalized) noexcept;
    void setPickup(float normalized) noexcept;
    void setTouch(float normalized) noexcept;
    void setBass(float normalized) noexcept;
    void setMid(float normalized) noexcept;
    void setTreble(float normalized) noexcept;
    void setPresence(float normalized) noexcept;
    void setSag(float normalized) noexcept;
    void setMaster(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;
private:
    NonlinearOversampler4x leftOversampler_{};
    NonlinearOversampler4x rightOversampler_{};
    double sampleRate_ = 44100.0;
    float dcLeft_ = 0.0f, dcRight_ = 0.0f;
    float pickupLowLeft_ = 0.0f, pickupLowRight_ = 0.0f;
    float lowLeft_ = 0.0f, lowRight_ = 0.0f, highLowLeft_ = 0.0f, highLowRight_ = 0.0f;
    float sagEnvelope_ = 0.0f;
    SmoothedValue mode_{}, pickup_{}, gain_{}, touch_{}, bass_{}, mid_{}, treble_{}, presence_{}, sag_{}, master_{};
};

class CabinetIr {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setMicPosition(float normalized) noexcept;
    void setMicBlend(float normalized) noexcept;
    void setDistance(float normalized) noexcept;
    void setLowCut(float normalized) noexcept;
    void setHighCut(float normalized) noexcept;
    void setResonance(float normalized) noexcept;
    void setLevel(float normalized) noexcept;
    void setCustomImpulse(const std::vector<std::size_t>& delays, const std::vector<float>& coefficients) noexcept;
    void clearCustomImpulse() noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    static constexpr std::size_t kIrLength = 512;
    static constexpr std::size_t kTapCount = 224;
    static constexpr std::size_t kIrCount = 8;
    static constexpr std::size_t kReflectionHistory = 1024;
    static constexpr std::size_t kCustomIrLength = 2048;
    static constexpr std::size_t kCustomTapCount = 368;
    void rebuildMorphedIr(float cabinet, float position, float micBlend) noexcept;
    std::array<std::array<float, kTapCount>, kIrCount> irBank_{};
    std::array<float, kTapCount> morphedIr_{};
    std::array<std::size_t, kTapCount> tapDelays_{};
    std::array<float, kCustomIrLength> leftHistory_{};
    std::array<float, kCustomIrLength> rightHistory_{};
    std::array<float, kCustomTapCount> customIr_{};
    std::array<std::size_t, kCustomTapCount> customTapDelays_{};
    std::size_t customTapCount_ = 0;
    std::array<float, kReflectionHistory> reflectionHistoryLeft_{};
    std::array<float, kReflectionHistory> reflectionHistoryRight_{};
    std::size_t cursor_ = 0;
    std::size_t reflectionCursor_ = 0;
    std::size_t morphCountdown_ = 0;
    double sampleRate_ = 44100.0;
    std::array<float, 4> lowPassLeft_{};
    std::array<float, 4> lowPassRight_{};
    std::array<float, 2> highPassLeft_{};
    std::array<float, 2> highPassRight_{};
    float resonanceLeft_ = 0.0f;
    float resonanceRight_ = 0.0f;
    SmoothedValue cabinet_{};
    SmoothedValue micPosition_{};
    SmoothedValue micBlend_{};
    SmoothedValue distance_{};
    SmoothedValue lowCut_{};
    SmoothedValue highCut_{};
    SmoothedValue resonance_{};
    SmoothedValue level_{};
};

class CrossDelay {
public:
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setTime(float normalized) noexcept;
    void setFeedback(float normalized) noexcept;
    void setCrossfeed(float normalized) noexcept;
    void setFilter(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t cursor_ = 0;
    double sampleRate_ = 44100.0;
    float filteredLeft_ = 0.0f;
    float filteredRight_ = 0.0f;
    SmoothedValue amount_{};
    SmoothedValue time_{};
    SmoothedValue feedback_{};
    SmoothedValue crossfeed_{};
    SmoothedValue filter_{};
    bool timeOverridden_ = false;
    bool feedbackOverridden_ = false;
};

class ModulationDelay {
public:
    enum class Mode { Chorus, Flanger, Vibrato };
    explicit ModulationDelay(Mode mode) noexcept : mode_(mode) {}
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setRate(float normalized) noexcept;
    void setDepth(float normalized) noexcept;
    void setDelay(float normalized) noexcept;
    void setFeedback(float normalized) noexcept;
    void setStereo(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    [[nodiscard]] float readDelay(const std::vector<float>& buffer, float samples) const noexcept;
    Mode mode_;
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t cursor_ = 0;
    double sampleRate_ = 44100.0;
    float phase_ = 0.0f;
    float lastLeft_ = 0.0f;
    float lastRight_ = 0.0f;
    SmoothedValue mix_{};
    SmoothedValue rate_{};
    SmoothedValue depth_{};
    SmoothedValue delay_{};
    SmoothedValue feedback_{};
    SmoothedValue stereo_{};
};

class StereoTremolo {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setRate(float normalized) noexcept;
    void setDepth(float normalized) noexcept;
    void setShape(float normalized) noexcept;
    void setStereo(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    double sampleRate_ = 44100.0;
    float phase_ = 0.0f;
    SmoothedValue mix_{};
    SmoothedValue rate_{};
    SmoothedValue depth_{};
    SmoothedValue shape_{};
    SmoothedValue stereo_{};
};

class DigitalDelay {
public:
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setTime(float normalized) noexcept;
    void setFeedback(float normalized) noexcept;
    void setTone(float normalized) noexcept;
    void setCharacter(float normalized) noexcept;
    void setStereo(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t cursor_ = 0;
    double sampleRate_ = 44100.0;
    float filteredLeft_ = 0.0f;
    float filteredRight_ = 0.0f;
    SmoothedValue mix_{};
    SmoothedValue time_{};
    SmoothedValue feedback_{};
    SmoothedValue tone_{};
    SmoothedValue character_{};
    SmoothedValue stereo_{};
};

class SpatialReverb {
public:
    explicit SpatialReverb(bool shimmer) noexcept : shimmerMode_(shimmer) {}
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setMode(float normalized) noexcept;
    void setSize(float normalized) noexcept;
    void setDecay(float normalized) noexcept;
    void setDamping(float normalized) noexcept;
    void setPreDelay(float normalized) noexcept;
    void setModulation(float normalized) noexcept;
    void setShimmer(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    [[nodiscard]] static float readInterpolated(const std::vector<float>& buffer, std::size_t cursor, float delay) noexcept;
    [[nodiscard]] float pitchShift(const std::vector<float>& buffer, float phase, float ratio, float phaseOffset) const noexcept;
    bool shimmerMode_ = false;
    double sampleRate_ = 44100.0;
    std::array<std::vector<float>, 4> tank_{};
    std::array<std::size_t, 4> tankCursor_{};
    std::vector<float> preDelayLeft_{};
    std::vector<float> preDelayRight_{};
    std::size_t preDelayCursor_ = 0;
    std::vector<float> pitchLeft_{};
    std::vector<float> pitchRight_{};
    std::size_t pitchCursor_ = 0;
    float pitchPhaseA_ = 0.0f;
    float pitchPhaseB_ = 0.0f;
    float modulationPhase_ = 0.0f;
    std::array<float, 4> dampingState_{};
    std::array<float, 8> dispersionState_{};
    std::array<float, 4> choirState_{};
    SmoothedValue mix_{};
    SmoothedValue mode_{};
    SmoothedValue size_{};
    SmoothedValue decay_{};
    SmoothedValue damping_{};
    SmoothedValue preDelay_{};
    SmoothedValue modulation_{};
    SmoothedValue shimmer_{};
};

class TempoDelay {
public:
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void setTempoBpm(float bpm) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t cursor_ = 0;
    double sampleRate_ = 44100.0;
    float tempoBpm_ = 120.0f;
    SmoothedValue amount_{};
};

class StereoChorus {
public:
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    float readDelay(const std::vector<float>& buffer, float delaySamples) const noexcept;
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t cursor_ = 0;
    double sampleRate_ = 44100.0;
    float phase_ = 0.0f;
    SmoothedValue amount_{};
};

class StereoReverb {
public:
    void prepare(const ProcessSpec& spec);
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void processFrame(float& left, float& right) noexcept;

private:
    std::vector<float> leftDelay_{};
    std::vector<float> rightDelay_{};
    std::size_t leftCursor_ = 0;
    std::size_t rightCursor_ = 0;
    float dampedLeft_ = 0.0f;
    float dampedRight_ = 0.0f;
    SmoothedValue amount_{};
};

class DryWet {
public:
    void prepare(const ProcessSpec& spec) noexcept;
    void reset(float normalized) noexcept;
    void setNormalized(float normalized) noexcept;
    void processFrame(float dryLeft, float dryRight, float& wetLeft, float& wetRight) noexcept;

private:
    SmoothedValue mix_{};
};

enum class RackModuleType {
    Unknown,
    InputTrim,
    SoftClip,
    LinkedCompressor,
    ToneShaper,
    StereoWidth,
    NoiseGate,
    AmpOverdrive,
    AmpModel,
    DualHighGain,
    SilkBloom,
    CabinetIr,
    CrossDelay,
    Chorus,
    Flanger,
    Tremolo,
    Vibrato,
    DigitalDelay,
    Reverb,
    Shimmer,
    DryWet,
    OutputTrim,
};

struct RackModuleConfig {
    RackModuleType type = RackModuleType::Unknown;
    bool bypassed = false;
    float mix = 1.0f;
    float normalized = 0.0f;
    bool followsLegacyControl = true;
};

class EffectRack {
public:
    void configure(const ProcessSpec& spec, const std::vector<RackModuleConfig>& modules);
    void reset() noexcept;
    void processFrame(float& left, float& right) noexcept;

    void setInput(float normalized) noexcept;
    void setDrive(float normalized) noexcept;
    void setCompress(float normalized) noexcept;
    void setTone(float normalized) noexcept;
    void setWidth(float normalized) noexcept;
    void setSpace(float normalized) noexcept;
    void setDryWet(float normalized) noexcept;
    void setOutput(float normalized) noexcept;
    void setModuleNormalized(std::size_t index, float normalized) noexcept;
    void setModuleParameter(std::size_t index, const char* key, float normalized) noexcept;
    void setModuleMix(std::size_t index, float mix) noexcept;
    void setModuleBypassed(std::size_t index, bool bypassed) noexcept;
    void setCustomImpulse(std::size_t index, const std::vector<std::size_t>& delays, const std::vector<float>& coefficients) noexcept;

    [[nodiscard]] std::size_t size() const noexcept { return nodes_.size(); }
    [[nodiscard]] float gainReduction(std::size_t moduleIndex = static_cast<std::size_t>(-1)) const noexcept;

private:
    struct Node {
        explicit Node(const RackModuleConfig& source) noexcept;

        RackModuleConfig config{};
        SmoothedValue mix{};
        SmoothedValue bypass{};
        StereoGain inputTrim{GainLaw::InputTrim};
        SoftClip softClip{};
        LinkedCompressor compressor{};
        ToneShaper tone{};
        StereoWidth width{};
        NoiseGate noiseGate{};
        AmpOverdrive overdrive{};
        AmpModel ampModel{};
        DualHighGainAmp dualHighGain{};
        SilkBloomAmp silkBloom{};
        CabinetIr cabinetIr{};
        CrossDelay delay{};
        ModulationDelay chorus{ModulationDelay::Mode::Chorus};
        ModulationDelay flanger{ModulationDelay::Mode::Flanger};
        StereoTremolo tremolo{};
        ModulationDelay vibrato{ModulationDelay::Mode::Vibrato};
        DigitalDelay digitalDelay{};
        SpatialReverb reverb{false};
        SpatialReverb shimmer{true};
        DryWet dryWet{};
        StereoGain outputTrim{GainLaw::OutputTrim};
        float effectiveGainReduction = 1.0f;
    };

    void setLegacyValue(RackModuleType type, float normalized) noexcept;
    static void prepareNode(Node& node, const ProcessSpec& spec);
    static void resetNode(Node& node) noexcept;

    std::vector<Node> nodes_{};
};

} // namespace tripleside::dsp
