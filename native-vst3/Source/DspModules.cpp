#include "DspModules.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace tripleside::dsp {

namespace {

// The nonlinear preamp/power stages deliberately compress a guitar DI toward
// full scale. This reference trim preserves their dynamics while keeping the
// nominal engaged level close to bypass, with headroom for cabinet resonance.
constexpr float kAmpReferenceGain = 0.2511886432f; // -12 dB

} // namespace

void SmoothedValue::prepare(double sampleRate, double rampMilliseconds) noexcept {
    const auto safeRate = std::max(1.0, sampleRate);
    const auto safeMilliseconds = std::max(0.0, rampMilliseconds);
    rampSamples_ = std::max<std::int32_t>(
        1,
        static_cast<std::int32_t>(std::lround(safeRate * safeMilliseconds / 1000.0)));
    updateStep();
}

void SmoothedValue::reset(float value) noexcept {
    current_ = value;
    target_ = value;
    step_ = 0.0f;
    remainingSamples_ = 0;
}

void SmoothedValue::setTarget(float value) noexcept {
    if (value == target_) return;
    target_ = value;
    remainingSamples_ = rampSamples_;
    updateStep();
}

float SmoothedValue::next() noexcept {
    if (remainingSamples_ <= 0) return current_;
    current_ += step_;
    --remainingSamples_;
    if (remainingSamples_ == 0) current_ = target_;
    return current_;
}

void SmoothedValue::updateStep() noexcept {
    if (remainingSamples_ <= 0) {
        step_ = 0.0f;
        return;
    }
    step_ = (target_ - current_) / static_cast<float>(remainingSamples_);
}

StereoGain::StereoGain(GainLaw law, double smoothingMilliseconds) noexcept
    : law_(law), smoothingMilliseconds_(smoothingMilliseconds) {}

void StereoGain::prepare(const ProcessSpec& spec) noexcept {
    spec_ = spec;
    gain_.prepare(spec_.sampleRate, smoothingMilliseconds_);
}

void StereoGain::reset(float normalized) noexcept {
    gain_.reset(gainForNormalized(law_, normalized));
}

void StereoGain::setNormalized(float normalized) noexcept {
    gain_.setTarget(gainForNormalized(law_, normalized));
}

void StereoGain::processFrame(float& left, float& right) noexcept {
    const float gain = gain_.next();
    left *= gain;
    right *= gain;
}

float StereoGain::gainForNormalized(GainLaw law, float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    if (law == GainLaw::Linear) return value;
    if (value <= 0.0f) return 0.0f;
    const float decibels = law == GainLaw::InputTrim
        ? value * 24.0f - 12.0f
        : value * 16.0f - 12.0f;
    return std::pow(10.0f, decibels / 20.0f);
}

NonlinearOversampler4x::Coefficients NonlinearOversampler4x::makeLowPass(
    double sampleRate, float cutoff, float q) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float omega = 2.0f * pi * cutoff / static_cast<float>(sampleRate);
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.0f * q);
    const float inverseA0 = 1.0f / (1.0f + alpha);
    return {
        (1.0f - cosine) * 0.5f * inverseA0,
        (1.0f - cosine) * inverseA0,
        (1.0f - cosine) * 0.5f * inverseA0,
        -2.0f * cosine * inverseA0,
        (1.0f - alpha) * inverseA0,
    };
}

float NonlinearOversampler4x::processBiquad(float input, const Coefficients& coefficients, State& state) noexcept {
    const float output = coefficients.b0 * input + state.z1;
    state.z1 = coefficients.b1 * input - coefficients.a1 * output + state.z2;
    state.z2 = coefficients.b2 * input - coefficients.a2 * output;
    return output;
}

void NonlinearOversampler4x::prepare(double sampleRate) noexcept {
    const double safeRate = std::max(1.0, sampleRate);
    const double oversampledRate = safeRate * static_cast<double>(kFactor);
    const float cutoff = std::min(19000.0f, static_cast<float>(safeRate) * 0.43f);
    coefficients_[0] = makeLowPass(oversampledRate, cutoff, 0.5411961f);
    coefficients_[1] = makeLowPass(oversampledRate, cutoff, 1.3065630f);
}

void NonlinearOversampler4x::reset() noexcept {
    previous_ = 0.0f;
    preFilter_ = {};
    postFilter_ = {};
}

void SoftClip::prepare(const ProcessSpec& spec) noexcept {
    leftOversampler_.prepare(spec.sampleRate);
    rightOversampler_.prepare(spec.sampleRate);
    amount_.prepare(spec.sampleRate, 10.0);
    character_.prepare(spec.sampleRate, 10.0);
    output_.prepare(spec.sampleRate, 10.0);
}

void SoftClip::reset(float normalized) noexcept {
    leftOversampler_.reset();
    rightOversampler_.reset();
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
    character_.reset(0.5f);
    output_.reset(1.0f);
}

void SoftClip::setCharacter(float normalized) noexcept {
    character_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void SoftClip::setOutput(float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    output_.setTarget(std::pow(10.0f, ((value - 0.5f) * 24.0f) / 20.0f));
}

void SoftClip::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void SoftClip::processFrame(float& left, float& right) noexcept {
    const float amount = amount_.next();
    const float character = character_.next();
    const float outputGain = output_.next();
    if (amount <= 0.0001f) {
        left *= outputGain;
        right *= outputGain;
        return;
    }
    const float drive = 1.0f + amount * 14.0f;
    const float normalization = std::tanh(drive);
    const float bias = (character - 0.5f) * 0.6f;
    const float biasOffset = std::tanh(bias * drive);
    left = leftOversampler_.process(left, [=](float sample) noexcept {
        return (std::tanh((sample + bias) * drive) - biasOffset) / normalization;
    }) * outputGain;
    right = rightOversampler_.process(right, [=](float sample) noexcept {
        return (std::tanh((sample + bias) * drive) - biasOffset) / normalization;
    }) * outputGain;
}

void LinkedCompressor::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    amount_.prepare(sampleRate_, 15.0);
    threshold_.prepare(sampleRate_, 15.0);
    ratio_.prepare(sampleRate_, 15.0);
    attack_.prepare(sampleRate_, 15.0);
    release_.prepare(sampleRate_, 15.0);
    makeup_.prepare(sampleRate_, 15.0);
}

void LinkedCompressor::reset(float normalized) noexcept {
    envelope_ = 0.0f;
    gainReduction_ = 1.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
    threshold_.reset(0.7f);
    ratio_.reset(0.13f);
    attack_.reset(0.63f);
    release_.reset(0.46f);
    makeup_.reset(0.0f);
    thresholdOverridden_ = ratioOverridden_ = attackOverridden_ = releaseOverridden_ = false;
}

void LinkedCompressor::setThreshold(float normalized) noexcept { thresholdOverridden_ = true; threshold_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void LinkedCompressor::setRatio(float normalized) noexcept { ratioOverridden_ = true; ratio_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void LinkedCompressor::setAttack(float normalized) noexcept { attackOverridden_ = true; attack_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void LinkedCompressor::setRelease(float normalized) noexcept { releaseOverridden_ = true; release_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void LinkedCompressor::setMakeup(float normalized) noexcept { makeup_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }

void LinkedCompressor::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void LinkedCompressor::processFrame(float& left, float& right) noexcept {
    const float amount = amount_.next();
    const float thresholdControl = threshold_.next();
    const float ratioControl = ratio_.next();
    const float attackControl = attack_.next();
    const float releaseControl = release_.next();
    const float makeupControl = makeup_.next();
    const float detector = std::max(std::abs(left), std::abs(right));
    const float attackSeconds = attackOverridden_ ? 0.0001f * std::pow(1000.0f, attackControl) : 0.008f;
    const float releaseSeconds = releaseOverridden_ ? 0.02f * std::pow(50.0f, releaseControl) : 0.12f;
    const float attackCoefficient = std::exp(-1.0f / (attackSeconds * static_cast<float>(sampleRate_)));
    const float releaseCoefficient = std::exp(-1.0f / (releaseSeconds * static_cast<float>(sampleRate_)));
    envelope_ = detector > envelope_
        ? attackCoefficient * envelope_ + (1.0f - attackCoefficient) * detector
        : releaseCoefficient * envelope_ + (1.0f - releaseCoefficient) * detector;
    const float thresholdDb = thresholdOverridden_ ? -48.0f + thresholdControl * 48.0f : -6.0f - 24.0f * amount;
    const float threshold = std::pow(10.0f, thresholdDb / 20.0f);
    const float ratio = ratioOverridden_ ? 1.0f + 19.0f * ratioControl : 1.0f + 7.0f * amount;
    gainReduction_ = envelope_ > threshold
        ? std::pow(threshold / envelope_, 1.0f - 1.0f / ratio)
        : 1.0f;
    const float makeupGain = std::pow(10.0f, makeupControl * 24.0f / 20.0f);
    left *= gainReduction_ * makeupGain;
    right *= gainReduction_ * makeupGain;
}

void ToneShaper::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    amount_.prepare(sampleRate_, 15.0);
    lowGain_.prepare(sampleRate_, 15.0);
    midGain_.prepare(sampleRate_, 15.0);
    highGain_.prepare(sampleRate_, 15.0);
}

void DeEsser::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    amount_.prepare(sampleRate_, 15.0); frequency_.prepare(sampleRate_, 20.0);
    threshold_.prepare(sampleRate_, 15.0); range_.prepare(sampleRate_, 15.0);
    attack_.prepare(sampleRate_, 15.0); release_.prepare(sampleRate_, 15.0);
}

void DeEsser::reset(float normalized) noexcept {
    detectorLowLeft_ = detectorLowRight_ = bandLeft_ = bandRight_ = envelope_ = 0.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f)); frequency_.reset(0.5f);
    threshold_.reset(0.58f); range_.reset(0.5f); attack_.reset(0.35f); release_.reset(0.45f);
}

void DeEsser::setNormalized(float value) noexcept { amount_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void DeEsser::setFrequency(float value) noexcept { frequency_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void DeEsser::setThreshold(float value) noexcept { threshold_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void DeEsser::setRange(float value) noexcept { range_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void DeEsser::setAttack(float value) noexcept { attack_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void DeEsser::setRelease(float value) noexcept { release_.setTarget(std::clamp(value, 0.0f, 1.0f)); }

void DeEsser::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float rate = static_cast<float>(sampleRate_);
    const float amount = amount_.next();
    const float center = 3000.0f * std::pow(4.0f, frequency_.next());
    const float threshold = std::pow(10.0f, (-48.0f + threshold_.next() * 48.0f) / 20.0f);
    const float maximumReduction = range_.next() * 18.0f * amount;
    const float attackSeconds = 0.0001f * std::pow(200.0f, attack_.next());
    const float releaseSeconds = 0.02f * std::pow(15.0f, release_.next());
    const float lowerAlpha = 1.0f - std::exp(-2.0f * pi * std::min(center / 1.6f, rate * 0.42f) / rate);
    const float upperAlpha = 1.0f - std::exp(-2.0f * pi * std::min(center * 1.6f, rate * 0.45f) / rate);
    detectorLowLeft_ += lowerAlpha * (left - detectorLowLeft_);
    detectorLowRight_ += lowerAlpha * (right - detectorLowRight_);
    bandLeft_ += upperAlpha * ((left - detectorLowLeft_) - bandLeft_);
    bandRight_ += upperAlpha * ((right - detectorLowRight_) - bandRight_);
    const float detector = std::max(std::abs(bandLeft_), std::abs(bandRight_));
    const float coefficient = std::exp(-1.0f / ((detector > envelope_ ? attackSeconds : releaseSeconds) * rate));
    envelope_ = coefficient * envelope_ + (1.0f - coefficient) * detector;
    const float overDb = envelope_ > threshold ? 20.0f * std::log10(envelope_ / threshold) : 0.0f;
    const float gain = std::pow(10.0f, -std::min(maximumReduction, overDb * amount) / 20.0f);
    left -= bandLeft_ * (1.0f - gain);
    right -= bandRight_ * (1.0f - gain);
}

void ToneShaper::reset(float normalized) noexcept {
    lowLeft_ = 0.0f;
    lowRight_ = 0.0f;
    highLowLeft_ = highLowRight_ = 0.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
    lowGain_.reset(0.5f);
    midGain_.reset(0.5f);
    highGain_.reset(0.5f);
    threeBandEnabled_ = false;
}

void ToneShaper::setLow(float normalized) noexcept { threeBandEnabled_ = true; lowGain_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void ToneShaper::setMid(float normalized) noexcept { threeBandEnabled_ = true; midGain_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void ToneShaper::setHigh(float normalized) noexcept { threeBandEnabled_ = true; highGain_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }

void ToneShaper::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void ToneShaper::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float amount = amount_.next();
    const float lowControl = lowGain_.next();
    const float midControl = midGain_.next();
    const float highControl = highGain_.next();
    if (threeBandEnabled_) {
        const float lowAlpha = 1.0f - std::exp(-2.0f * pi * 250.0f / static_cast<float>(sampleRate_));
        const float highAlpha = 1.0f - std::exp(-2.0f * pi * 3000.0f / static_cast<float>(sampleRate_));
        lowLeft_ += lowAlpha * (left - lowLeft_);
        lowRight_ += lowAlpha * (right - lowRight_);
        highLowLeft_ += highAlpha * (left - highLowLeft_);
        highLowRight_ += highAlpha * (right - highLowRight_);
        const float lowScale = std::pow(10.0f, (lowControl - 0.5f) * 24.0f / 20.0f);
        const float midScale = std::pow(10.0f, (midControl - 0.5f) * 24.0f / 20.0f);
        const float highScale = std::pow(10.0f, (highControl - 0.5f) * 24.0f / 20.0f);
        left = lowLeft_ * lowScale + (highLowLeft_ - lowLeft_) * midScale + (left - highLowLeft_) * highScale;
        right = lowRight_ * lowScale + (highLowRight_ - lowRight_) * midScale + (right - highLowRight_) * highScale;
        return;
    }
    const float frequency = 300.0f * std::pow(60.0f, amount);
    const float alpha = 1.0f - std::exp(
        -2.0f * pi * frequency / static_cast<float>(sampleRate_));
    lowLeft_ += alpha * (left - lowLeft_);
    lowRight_ += alpha * (right - lowRight_);
    if (amount < 0.5f) {
        const float dark = (0.5f - amount) * 2.0f;
        left += (lowLeft_ - left) * dark;
        right += (lowRight_ - right) * dark;
    } else {
        const float bright = (amount - 0.5f) * 0.7f;
        left += (left - lowLeft_) * bright;
        right += (right - lowRight_) * bright;
    }
}

void StereoWidth::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    amount_.prepare(spec.sampleRate, 10.0);
    monoBass_.prepare(spec.sampleRate, 10.0);
}

void StereoWidth::reset(float normalized) noexcept {
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
    monoBass_.reset(0.0f);
    sideLow_ = 0.0f;
}

void StereoWidth::setMonoBass(float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    if (value <= 0.0f) { monoBass_.setTarget(0.0f); return; }
    constexpr float pi = 3.14159265358979323846f;
    const float cutoff = 40.0f * std::pow(10.0f, value);
    monoBass_.setTarget(1.0f - std::exp(-2.0f * pi * cutoff / static_cast<float>(sampleRate_)));
}

void StereoWidth::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void StereoWidth::processFrame(float& left, float& right) noexcept {
    const float width = amount_.next() * 2.0f;
    const float monoBassAlpha = monoBass_.next();
    const float middle = (left + right) * 0.5f;
    float side = (left - right) * 0.5f;
    if (monoBassAlpha > 0.0001f) {
        sideLow_ += monoBassAlpha * (side - sideLow_);
        side -= sideLow_;
    }
    side *= width;
    left = middle + side;
    right = middle - side;
}

void NoiseGate::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    threshold_.prepare(sampleRate_, 10.0);
    release_.prepare(sampleRate_, 10.0);
}

void NoiseGate::reset(float normalized) noexcept {
    envelope_ = 0.0f;
    gateGain_ = 0.0f;
    detectorLowLeft_ = detectorLowRight_ = 0.0f;
    holdSamplesRemaining_ = 0;
    open_ = false;
    threshold_.reset(std::clamp(normalized, 0.0f, 1.0f));
    release_.reset(0.5f);
}

void NoiseGate::setNormalized(float normalized) noexcept { threshold_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void NoiseGate::setRelease(float normalized) noexcept { release_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }

void NoiseGate::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float detectorHighPassAlpha = 1.0f - std::exp(-2.0f * pi * 55.0f / static_cast<float>(sampleRate_));
    detectorLowLeft_ += detectorHighPassAlpha * (left - detectorLowLeft_);
    detectorLowRight_ += detectorHighPassAlpha * (right - detectorLowRight_);
    const float detector = std::max(std::abs(left - detectorLowLeft_), std::abs(right - detectorLowRight_));
    const float envelopeAttack = std::exp(-1.0f / (0.00035f * static_cast<float>(sampleRate_)));
    const float envelopeRelease = std::exp(-1.0f / (0.065f * static_cast<float>(sampleRate_)));
    const float envelopeCoefficient = detector > envelope_ ? envelopeAttack : envelopeRelease;
    envelope_ = envelopeCoefficient * envelope_ + (1.0f - envelopeCoefficient) * detector;
    const float threshold = std::pow(10.0f, (-80.0f + threshold_.next() * 60.0f) / 20.0f);
    if (envelope_ >= threshold) {
        open_ = true;
        holdSamplesRemaining_ = std::max<std::int32_t>(1, static_cast<std::int32_t>(sampleRate_ * 0.008));
    } else if (open_) {
        if (holdSamplesRemaining_ > 0) --holdSamplesRemaining_;
        else if (envelope_ < threshold * 0.62f) open_ = false;
    }
    const float releaseSeconds = 0.005f * std::pow(100.0f, release_.next());
    const float gainCoefficient = open_
        ? std::exp(-1.0f / (0.0006f * static_cast<float>(sampleRate_)))
        : std::exp(-1.0f / (releaseSeconds * static_cast<float>(sampleRate_)));
    const float target = open_ ? 1.0f : 0.0f;
    gateGain_ = gainCoefficient * gateGain_ + (1.0f - gainCoefficient) * target;
    left *= gateGain_;
    right *= gateGain_;
}

void AmpOverdrive::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    leftOversampler_.prepare(sampleRate_); rightOversampler_.prepare(sampleRate_);
    drive_.prepare(sampleRate_, 10.0);
    tone_.prepare(sampleRate_, 10.0);
    level_.prepare(sampleRate_, 10.0);
}

void AmpOverdrive::reset(float normalized) noexcept {
    leftOversampler_.reset(); rightOversampler_.reset();
    toneLeft_ = toneRight_ = 0.0f;
    drive_.reset(std::clamp(normalized, 0.0f, 1.0f));
    tone_.reset(0.5f);
    level_.reset(1.0f);
}

void AmpOverdrive::setNormalized(float normalized) noexcept { drive_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpOverdrive::setTone(float normalized) noexcept { tone_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpOverdrive::setLevel(float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    level_.setTarget(std::pow(10.0f, ((value - 0.5f) * 24.0f) / 20.0f));
}

void AmpOverdrive::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float drive = drive_.next();
    const float tone = tone_.next();
    const float level = level_.next();
    const float inputGain = 1.0f + drive * 24.0f;
    const float normalization = std::tanh(inputGain);
    left = leftOversampler_.process(left, [=](float sample) noexcept { return std::tanh(sample * inputGain) / normalization; });
    right = rightOversampler_.process(right, [=](float sample) noexcept { return std::tanh(sample * inputGain) / normalization; });
    const float cutoff = 700.0f * std::pow(16.0f, tone);
    const float alpha = 1.0f - std::exp(-2.0f * pi * cutoff / static_cast<float>(sampleRate_));
    toneLeft_ += alpha * (left - toneLeft_);
    toneRight_ += alpha * (right - toneRight_);
    const float brightness = 0.15f + tone * 0.85f;
    left = (toneLeft_ + (left - toneLeft_) * brightness) * level;
    right = (toneRight_ + (right - toneRight_) * brightness) * level;
}

void AmpModel::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    leftOversampler_.prepare(sampleRate_); rightOversampler_.prepare(sampleRate_);
    gain_.prepare(sampleRate_, 20.0); bass_.prepare(sampleRate_, 20.0); mid_.prepare(sampleRate_, 20.0);
    treble_.prepare(sampleRate_, 20.0); presence_.prepare(sampleRate_, 20.0); master_.prepare(sampleRate_, 20.0);
}

void AmpModel::reset(float normalized) noexcept {
    leftOversampler_.reset(); rightOversampler_.reset();
    dcLeft_ = dcRight_ = lowLeft_ = lowRight_ = highLowLeft_ = highLowRight_ = sagEnvelope_ = 0.0f;
    gain_.reset(std::clamp(normalized, 0.0f, 1.0f));
    bass_.reset(0.5f); mid_.reset(0.5f); treble_.reset(0.5f); presence_.reset(0.35f); master_.reset(1.0f);
}

void AmpModel::setNormalized(float normalized) noexcept { gain_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpModel::setBass(float normalized) noexcept { bass_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpModel::setMid(float normalized) noexcept { mid_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpModel::setTreble(float normalized) noexcept { treble_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpModel::setPresence(float normalized) noexcept { presence_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void AmpModel::setMaster(float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    master_.setTarget(std::pow(10.0f, (-18.0f + value * 24.0f) / 20.0f));
}

void AmpModel::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float gain = gain_.next(); const float bass = bass_.next(); const float mid = mid_.next();
    const float treble = treble_.next(); const float presence = presence_.next(); const float master = master_.next();
    const float dcAlpha = 1.0f - std::exp(-2.0f * pi * 25.0f / static_cast<float>(sampleRate_));
    dcLeft_ += dcAlpha * (left - dcLeft_); dcRight_ += dcAlpha * (right - dcRight_);
    left -= dcLeft_; right -= dcRight_;
    const float drive = 1.0f + gain * 35.0f;
    const float bias = 0.04f + gain * 0.08f;
    const float biasOffset = std::tanh(bias * drive);
    const float normalization = std::tanh(drive);
    left = leftOversampler_.process(left, [=](float sample) noexcept {
        const float preamp = (std::tanh((sample + bias) * drive) - biasOffset) / normalization;
        return std::tanh(preamp * (1.4f + gain));
    });
    right = rightOversampler_.process(right, [=](float sample) noexcept {
        const float preamp = (std::tanh((sample + bias) * drive) - biasOffset) / normalization;
        return std::tanh(preamp * (1.4f + gain));
    });
    const float detector = std::max(std::abs(left), std::abs(right));
    const float sagAlpha = 1.0f - std::exp(-1.0f / (0.08f * static_cast<float>(sampleRate_)));
    sagEnvelope_ += sagAlpha * (detector - sagEnvelope_);
    const float sagGain = 1.0f / (1.0f + sagEnvelope_ * gain * 0.45f);
    left *= sagGain;
    right *= sagGain;
    const float lowAlpha = 1.0f - std::exp(-2.0f * pi * 220.0f / static_cast<float>(sampleRate_));
    const float highAlpha = 1.0f - std::exp(-2.0f * pi * 2600.0f / static_cast<float>(sampleRate_));
    lowLeft_ += lowAlpha * (left - lowLeft_); lowRight_ += lowAlpha * (right - lowRight_);
    highLowLeft_ += highAlpha * (left - highLowLeft_); highLowRight_ += highAlpha * (right - highLowRight_);
    const float lowScale = std::pow(10.0f, (bass - 0.5f) * 24.0f / 20.0f);
    const float midScale = std::pow(10.0f, (mid - 0.5f) * 24.0f / 20.0f);
    const float highScale = std::pow(10.0f, (treble - 0.5f) * 24.0f / 20.0f);
    left = lowLeft_ * lowScale + (highLowLeft_ - lowLeft_) * midScale + (left - highLowLeft_) * highScale;
    right = lowRight_ * lowScale + (highLowRight_ - lowRight_) * midScale + (right - highLowRight_) * highScale;
    left = (left + (left - highLowLeft_) * presence * 0.45f) * master * kAmpReferenceGain;
    right = (right + (right - highLowRight_) * presence * 0.45f) * master * kAmpReferenceGain;
}

DualHighGainAmp::BiquadCoefficients DualHighGainAmp::makeLowPass(
    double sampleRate, float cutoff, float q) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float omega = 2.0f * pi * cutoff / static_cast<float>(sampleRate);
    const float cosine = std::cos(omega);
    const float alpha = std::sin(omega) / (2.0f * q);
    const float inverseA0 = 1.0f / (1.0f + alpha);
    return {
        (1.0f - cosine) * 0.5f * inverseA0,
        (1.0f - cosine) * inverseA0,
        (1.0f - cosine) * 0.5f * inverseA0,
        -2.0f * cosine * inverseA0,
        (1.0f - alpha) * inverseA0,
    };
}

float DualHighGainAmp::processBiquad(float input, const BiquadCoefficients& coefficients,
    BiquadState& state) noexcept {
    const float output = coefficients.b0 * input + state.z1;
    state.z1 = coefficients.b1 * input - coefficients.a1 * output + state.z2;
    state.z2 = coefficients.b2 * input - coefficients.a2 * output;
    return output;
}

void DualHighGainAmp::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    const double oversampledRate = sampleRate_ * static_cast<double>(kOversamplingFactor);
    const float cutoff = std::min(19000.0f, static_cast<float>(sampleRate_) * 0.43f);
    oversamplingLowPass_[0] = makeLowPass(oversampledRate, cutoff, 0.5411961f);
    oversamplingLowPass_[1] = makeLowPass(oversampledRate, cutoff, 1.3065630f);
    mode_.prepare(sampleRate_, 5.0); gain_.prepare(sampleRate_, 20.0); tight_.prepare(sampleRate_, 20.0);
    bass_.prepare(sampleRate_, 20.0); mid_.prepare(sampleRate_, 20.0); treble_.prepare(sampleRate_, 20.0);
    presence_.prepare(sampleRate_, 20.0); depth_.prepare(sampleRate_, 20.0); sag_.prepare(sampleRate_, 20.0);
    master_.prepare(sampleRate_, 20.0);
}

void DualHighGainAmp::reset(float normalized) noexcept {
    previousLeft_ = previousRight_ = 0.0f;
    preFilterLeft_ = {}; preFilterRight_ = {}; postFilterLeft_ = {}; postFilterRight_ = {};
    highPassLeft_.fill(0.0f); highPassRight_.fill(0.0f); lowPassLeft_.fill(0.0f); lowPassRight_.fill(0.0f);
    toneLowLeft_ = toneLowRight_ = toneHighLowLeft_ = toneHighLowRight_ = 0.0f;
    presenceLowLeft_ = presenceLowRight_ = depthLowLeft_ = depthLowRight_ = 0.0f;
    speakerLowLeft_ = speakerLowRight_ = speakerBodyLeft_ = speakerBodyRight_ = 0.0f;
    transformerFluxLeft_ = transformerFluxRight_ = sagEnvelope_ = 0.0f;
    mode_.reset(0.0f); gain_.reset(std::clamp(normalized, 0.0f, 1.0f)); tight_.reset(0.65f);
    bass_.reset(0.5f); mid_.reset(0.5f); treble_.reset(0.5f); presence_.reset(0.5f);
    depth_.reset(0.5f); sag_.reset(0.25f); master_.reset(0.65f);
}

void DualHighGainAmp::setNormalized(float normalized) noexcept { gain_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setMode(float normalized) noexcept { mode_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setTight(float normalized) noexcept { tight_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setBass(float normalized) noexcept { bass_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setMid(float normalized) noexcept { mid_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setTreble(float normalized) noexcept { treble_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setPresence(float normalized) noexcept { presence_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setDepth(float normalized) noexcept { depth_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setSag(float normalized) noexcept { sag_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void DualHighGainAmp::setMaster(float normalized) noexcept { master_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }

float DualHighGainAmp::processPreamp(float input, bool rectified, float gain, float tight,
    std::array<float, 4>& highPass, std::array<float, 4>& lowPass) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    static constexpr std::array<float, 4> rectifiedDrive{1.0f, 0.82f, 1.15f, 0.70f};
    static constexpr std::array<float, 4> cascadingDrive{0.85f, 1.05f, 0.90f, 0.82f};
    const float oversampledRate = static_cast<float>(sampleRate_) * static_cast<float>(kOversamplingFactor);
    const float highPassCutoff = (rectified ? 78.0f : 55.0f) + tight * (rectified ? 165.0f : 115.0f);
    const float lowPassCutoff = (rectified ? 12500.0f : 9800.0f) - gain * (rectified ? 1800.0f : 1200.0f);
    const float baseDrive = rectified ? 1.8f + gain * 8.5f : 1.55f + gain * 7.4f;
    const auto& driveShape = rectified ? rectifiedDrive : cascadingDrive;
    float value = input;
    for (std::size_t stage = 0; stage < driveShape.size(); ++stage) {
        const float hpAlpha = 1.0f - std::exp(-2.0f * pi * highPassCutoff * (1.0f + static_cast<float>(stage) * 0.12f) / oversampledRate);
        highPass[stage] += hpAlpha * (value - highPass[stage]);
        value -= highPass[stage];
        const float drive = baseDrive * driveShape[stage];
        const float bias = (rectified ? 0.025f : 0.018f) * ((stage & 1U) ? -1.0f : 1.0f) * (0.5f + gain);
        value = (std::tanh((value + bias) * drive) - std::tanh(bias * drive)) / std::max(0.2f, std::tanh(drive));
        value *= rectified ? 0.73f : 0.76f;
        const float lpAlpha = 1.0f - std::exp(-2.0f * pi * lowPassCutoff / oversampledRate);
        lowPass[stage] += lpAlpha * (value - lowPass[stage]);
        value = lowPass[stage];
    }
    return value;
}

void DualHighGainAmp::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const bool rectified = mode_.next() < 0.5f;
    const float gain = gain_.next(); const float tight = tight_.next(); const float bass = bass_.next();
    const float mid = mid_.next(); const float treble = treble_.next(); const float presence = presence_.next();
    const float depth = depth_.next(); const float sag = sag_.next(); const float master = master_.next();
    const float sagGain = 1.0f / (1.0f + sagEnvelope_ * sag * (rectified ? 0.55f : 0.9f));
    const float inputLeft = left; const float inputRight = right;
    for (std::size_t phase = 1; phase <= kOversamplingFactor; ++phase) {
        const float fraction = static_cast<float>(phase) / static_cast<float>(kOversamplingFactor);
        float oversampledLeft = previousLeft_ + (inputLeft - previousLeft_) * fraction;
        float oversampledRight = previousRight_ + (inputRight - previousRight_) * fraction;
        for (std::size_t section = 0; section < oversamplingLowPass_.size(); ++section) {
            oversampledLeft = processBiquad(oversampledLeft, oversamplingLowPass_[section], preFilterLeft_[section]);
            oversampledRight = processBiquad(oversampledRight, oversamplingLowPass_[section], preFilterRight_[section]);
        }
        oversampledLeft = processPreamp(oversampledLeft, rectified, gain, tight, highPassLeft_, lowPassLeft_);
        oversampledRight = processPreamp(oversampledRight, rectified, gain, tight, highPassRight_, lowPassRight_);
        oversampledLeft = std::tanh(oversampledLeft * (rectified ? 1.22f : 1.38f) * sagGain);
        oversampledRight = std::tanh(oversampledRight * (rectified ? 1.22f : 1.38f) * sagGain);
        for (std::size_t section = 0; section < oversamplingLowPass_.size(); ++section) {
            oversampledLeft = processBiquad(oversampledLeft, oversamplingLowPass_[section], postFilterLeft_[section]);
            oversampledRight = processBiquad(oversampledRight, oversamplingLowPass_[section], postFilterRight_[section]);
        }
        left = oversampledLeft;
        right = oversampledRight;
    }
    previousLeft_ = inputLeft; previousRight_ = inputRight;
    const float detector = std::max(std::abs(left), std::abs(right));
    const float sagAlpha = 1.0f - std::exp(-1.0f / ((rectified ? 0.045f : 0.085f) * static_cast<float>(sampleRate_)));
    sagEnvelope_ += sagAlpha * (detector - sagEnvelope_);

    const float lowAlpha = 1.0f - std::exp(-2.0f * pi * (rectified ? 190.0f : 230.0f) / static_cast<float>(sampleRate_));
    const float highAlpha = 1.0f - std::exp(-2.0f * pi * (rectified ? 2850.0f : 2550.0f) / static_cast<float>(sampleRate_));
    toneLowLeft_ += lowAlpha * (left - toneLowLeft_); toneLowRight_ += lowAlpha * (right - toneLowRight_);
    toneHighLowLeft_ += highAlpha * (left - toneHighLowLeft_); toneHighLowRight_ += highAlpha * (right - toneHighLowRight_);
    const float lowScale = std::pow(10.0f, (bass - 0.5f) * 20.0f / 20.0f);
    const float midOffset = rectified ? -2.0f : 1.5f;
    const float midScale = std::pow(10.0f, ((mid - 0.5f) * 20.0f + midOffset) / 20.0f);
    const float highScale = std::pow(10.0f, (treble - 0.5f) * 20.0f / 20.0f);
    left = toneLowLeft_ * lowScale + (toneHighLowLeft_ - toneLowLeft_) * midScale + (left - toneHighLowLeft_) * highScale;
    right = toneLowRight_ * lowScale + (toneHighLowRight_ - toneLowRight_) * midScale + (right - toneHighLowRight_) * highScale;

    // A level-dependent loudspeaker load makes the power stage react to the
    // cabinet resonance instead of behaving like a static post-distortion EQ.
    const float speakerLowAlpha = 1.0f - std::exp(-2.0f * pi * (rectified ? 92.0f : 105.0f) / static_cast<float>(sampleRate_));
    const float speakerBodyAlpha = 1.0f - std::exp(-2.0f * pi * (rectified ? 185.0f : 210.0f) / static_cast<float>(sampleRate_));
    speakerLowLeft_ += speakerLowAlpha * (left - speakerLowLeft_); speakerLowRight_ += speakerLowAlpha * (right - speakerLowRight_);
    speakerBodyLeft_ += speakerBodyAlpha * (left - speakerBodyLeft_); speakerBodyRight_ += speakerBodyAlpha * (right - speakerBodyRight_);
    const float loadDamping = 1.0f / (1.0f + detector * (rectified ? 0.55f : 0.42f));
    left += (speakerLowLeft_ - speakerBodyLeft_) * (0.16f + depth * 0.24f) * loadDamping;
    right += (speakerLowRight_ - speakerBodyRight_) * (0.16f + depth * 0.24f) * loadDamping;

    const float depthAlpha = 1.0f - std::exp(-2.0f * pi * 115.0f / static_cast<float>(sampleRate_));
    depthLowLeft_ += depthAlpha * (left - depthLowLeft_); depthLowRight_ += depthAlpha * (right - depthLowRight_);
    left += depthLowLeft_ * depth * (rectified ? 0.8f : 0.62f); right += depthLowRight_ * depth * (rectified ? 0.8f : 0.62f);
    const float presenceAlpha = 1.0f - std::exp(-2.0f * pi * 3400.0f / static_cast<float>(sampleRate_));
    presenceLowLeft_ += presenceAlpha * (left - presenceLowLeft_); presenceLowRight_ += presenceAlpha * (right - presenceLowRight_);
    left += (left - presenceLowLeft_) * presence * (rectified ? 0.7f : 0.48f);
    right += (right - presenceLowRight_) * presence * (rectified ? 0.7f : 0.48f);
    const float fluxAlpha = 1.0f - std::exp(-2.0f * pi * 34.0f / static_cast<float>(sampleRate_));
    transformerFluxLeft_ += fluxAlpha * (left - transformerFluxLeft_);
    transformerFluxRight_ += fluxAlpha * (right - transformerFluxRight_);
    const float transformerDrive = 1.04f + master * 0.32f;
    const float transformerNormalization = std::tanh(transformerDrive);
    left = std::tanh((left + transformerFluxLeft_ * sag * 0.075f) * transformerDrive) / transformerNormalization;
    right = std::tanh((right + transformerFluxRight_ * sag * 0.075f) * transformerDrive) / transformerNormalization;
    const float masterGain = std::pow(10.0f, (-18.0f + master * 24.0f) / 20.0f)
        * kAmpReferenceGain;
    left *= masterGain; right *= masterGain;
}

void SilkBloomAmp::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    leftOversampler_.prepare(sampleRate_); rightOversampler_.prepare(sampleRate_);
    mode_.prepare(sampleRate_, 8.0); pickup_.prepare(sampleRate_, 8.0); gain_.prepare(sampleRate_, 20.0); touch_.prepare(sampleRate_, 20.0);
    bass_.prepare(sampleRate_, 20.0); mid_.prepare(sampleRate_, 20.0); treble_.prepare(sampleRate_, 20.0);
    presence_.prepare(sampleRate_, 20.0); sag_.prepare(sampleRate_, 20.0); master_.prepare(sampleRate_, 20.0);
}

void SilkBloomAmp::reset(float normalized) noexcept {
    leftOversampler_.reset(); rightOversampler_.reset();
    dcLeft_ = dcRight_ = pickupLowLeft_ = pickupLowRight_ = lowLeft_ = lowRight_ = highLowLeft_ = highLowRight_ = sagEnvelope_ = 0.0f;
    mode_.reset(0.5f); pickup_.reset(0.5f); gain_.reset(std::clamp(normalized, 0.0f, 1.0f)); touch_.reset(0.72f);
    bass_.reset(0.48f); mid_.reset(0.58f); treble_.reset(0.54f); presence_.reset(0.38f); sag_.reset(0.42f); master_.reset(0.7f);
}

void SilkBloomAmp::setNormalized(float value) noexcept { gain_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setMode(float value) noexcept { mode_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setPickup(float value) noexcept { pickup_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setTouch(float value) noexcept { touch_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setBass(float value) noexcept { bass_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setMid(float value) noexcept { mid_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setTreble(float value) noexcept { treble_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setPresence(float value) noexcept { presence_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setSag(float value) noexcept { sag_.setTarget(std::clamp(value,0.0f,1.0f)); }
void SilkBloomAmp::setMaster(float value) noexcept { master_.setTarget(std::clamp(value,0.0f,1.0f)); }

void SilkBloomAmp::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float modeValue=mode_.next(); const int mode=modeValue<1.0f/3.0f?0:(modeValue<2.0f/3.0f?1:2);
    const float pickup=pickup_.next()*2.0f-1.0f, gain=gain_.next(), touch=touch_.next();
    const float bass=bass_.next(), mid=mid_.next(), treble=treble_.next(), presence=presence_.next(), sag=sag_.next(), master=master_.next();
    const float dcAlpha=1.0f-std::exp(-2.0f*pi*25.0f/static_cast<float>(sampleRate_));
    dcLeft_+=dcAlpha*(left-dcLeft_); dcRight_+=dcAlpha*(right-dcRight_); left-=dcLeft_; right-=dcRight_;
    const float pickupAlpha=1.0f-std::exp(-2.0f*pi*1450.0f/static_cast<float>(sampleRate_));
    pickupLowLeft_+=pickupAlpha*(left-pickupLowLeft_); pickupLowRight_+=pickupAlpha*(right-pickupLowRight_);
    left=left*(1.0f-pickup*0.1f)+pickupLowLeft_*pickup*0.16f; right=right*(1.0f-pickup*0.1f)+pickupLowRight_*pickup*0.16f;
    static constexpr std::array<float,3> modeDrive{0.72f,1.35f,2.2f}, outputDrive{1.05f,1.3f,1.65f}, bloomAmount{0.25f,0.48f,0.72f}, midOffset{0.5f,1.4f,2.2f};
    const float baseDrive=(1.25f+gain*15.0f)*modeDrive[mode]; const float detectorIn=std::max(std::abs(left),std::abs(right));
    const float drive=baseDrive*(1.0f+detectorIn*touch*(mode==0?1.1f:0.55f)); const float bias=(mode==0?0.018f:(mode==1?0.032f:0.046f))+pickup*0.006f;
    const float offset=std::tanh(bias*drive), norm=std::max(0.2f,std::tanh(drive));
    left=leftOversampler_.process(left,[=](float x) noexcept { const float first=(std::tanh((x+bias)*drive)-offset)/norm; return std::tanh(first*outputDrive[mode]); });
    right=rightOversampler_.process(right,[=](float x) noexcept { const float first=(std::tanh((x+bias)*drive)-offset)/norm; return std::tanh(first*outputDrive[mode]); });
    const float detector=std::max(std::abs(left),std::abs(right)); const float sagAlpha=1.0f-std::exp(-1.0f/((0.045f+sag*0.12f)*static_cast<float>(sampleRate_)));
    sagEnvelope_+=sagAlpha*(detector-sagEnvelope_); const float bloom=1.0f/(1.0f+sagEnvelope_*sag*bloomAmount[mode]); left*=bloom; right*=bloom;
    const float lowAlpha=1.0f-std::exp(-2.0f*pi*210.0f/static_cast<float>(sampleRate_)), highAlpha=1.0f-std::exp(-2.0f*pi*2850.0f/static_cast<float>(sampleRate_));
    lowLeft_+=lowAlpha*(left-lowLeft_); lowRight_+=lowAlpha*(right-lowRight_); highLowLeft_+=highAlpha*(left-highLowLeft_); highLowRight_+=highAlpha*(right-highLowRight_);
    const float lowScale=std::pow(10.0f,(bass-0.5f)*18.0f/20.0f), midScale=std::pow(10.0f,((mid-0.5f)*18.0f+midOffset[mode])/20.0f), highScale=std::pow(10.0f,(treble-0.5f)*16.0f/20.0f);
    left=lowLeft_*lowScale+(highLowLeft_-lowLeft_)*midScale+(left-highLowLeft_)*highScale; right=lowRight_*lowScale+(highLowRight_-lowRight_)*midScale+(right-highLowRight_)*highScale;
    const float masterGain=std::pow(10.0f,(-18.0f+master*24.0f)/20.0f)*kAmpReferenceGain;
    left=(left+(left-highLowLeft_)*presence*0.32f)*masterGain; right=(right+(right-highLowRight_)*presence*0.32f)*masterGain;
}

void CabinetIr::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    constexpr float pi = 3.14159265358979323846f;
    static constexpr std::array<float, 12> modeFrequencies{
        410.0f, 690.0f, 930.0f, 1280.0f, 1710.0f, 2180.0f,
        2780.0f, 3370.0f, 4050.0f, 4870.0f, 5840.0f, 6920.0f};
    static constexpr std::array<float, 12> modeWeights{
        1.00f, -0.76f, 0.63f, -0.54f, 0.46f, -0.39f,
        0.33f, -0.28f, 0.23f, -0.18f, 0.14f, -0.10f};

    // Eight deterministic, original close-mic responses: vintage/modern,
    // dynamic/ribbon and cap/edge. They are synthesized from cabinet modes
    // and a seeded diffuse tail, not copied from a commercial or third-party IR.
    for (std::size_t bank = 0; bank < kIrCount; ++bank) {
        const bool modern = bank >= 4;
        const bool ribbon = (bank % 4) >= 2;
        const bool edge = (bank % 2) != 0;
        std::array<float, kIrLength> fullImpulse{};
        for (std::size_t tap = 0; tap < kIrLength; ++tap) {
            const float time = static_cast<float>(tap) / static_cast<float>(sampleRate_);
            const float sample = static_cast<float>(tap);
            float modal = 0.0f;
            for (std::size_t mode = 0; mode < modeFrequencies.size(); ++mode) {
                float frequency = modeFrequencies[mode] * (modern ? 1.075f : 0.94f);
                frequency *= edge ? (0.985f + 0.002f * static_cast<float>(mode)) : 1.0f;
                const float phase = 0.19f * static_cast<float>(mode + 1)
                    + (ribbon ? 0.31f : 0.0f) + (edge ? 0.17f : 0.0f);
                const float decay = (modern ? 76.0f : 104.0f) + static_cast<float>(mode) * 7.0f;
                float weight = modeWeights[mode] / (1.0f + 0.075f * static_cast<float>(mode));
                if (ribbon && mode >= 7) weight *= 0.48f;
                if (edge && mode >= 6) weight *= 0.67f;
                modal += weight * std::sin(2.0f * pi * frequency * time + phase) * std::exp(-sample / decay);
            }
            std::uint32_t noiseBits = static_cast<std::uint32_t>((tap + 1) * 1664525u)
                + static_cast<std::uint32_t>((bank + 3) * 1013904223u);
            noiseBits ^= noiseBits >> 13;
            noiseBits *= 1274126177u;
            noiseBits ^= noiseBits >> 16;
            const float noise = static_cast<float>(noiseBits & 0xffffu) / 32767.5f - 1.0f;
            const float diffuse = noise * std::exp(-sample / (modern ? 68.0f : 88.0f));
            const float early = std::exp(-sample / (edge ? 12.0f : 9.0f))
                * std::cos(2.0f * pi * (modern ? 3650.0f : 2920.0f) * time + (ribbon ? 0.28f : 0.0f));
            const float direct = tap == 0
                ? (modern ? 0.38f : 0.33f) * (ribbon ? 0.82f : 1.0f) * (edge ? 0.91f : 1.0f)
                : 0.0f;
            fullImpulse[tap] = direct + early * (ribbon ? 0.032f : 0.046f)
                + modal * (modern ? 0.0135f : 0.0120f) + diffuse * (ribbon ? 0.0055f : 0.0075f);
        }
        float maximumMagnitude = 0.0f;
        for (std::size_t bin = 0; bin <= 128; ++bin) {
            float real = 0.0f; float imaginary = 0.0f;
            const float omega = pi * static_cast<float>(bin) / 128.0f;
            for (std::size_t tap = 0; tap < kIrLength; ++tap) {
                real += fullImpulse[tap] * std::cos(omega * static_cast<float>(tap));
                imaginary -= fullImpulse[tap] * std::sin(omega * static_cast<float>(tap));
            }
            maximumMagnitude = std::max(maximumMagnitude, std::sqrt(real * real + imaginary * imaginary));
        }
        const float targetMagnitude = ribbon ? 0.92f : 1.0f;
        const float scale = targetMagnitude / std::max(0.0001f, maximumMagnitude);
        for (auto& coefficient : fullImpulse) coefficient *= scale;
        for (std::size_t slot = 0; slot < kTapCount; ++slot) {
            if (slot < 128) {
                tapDelays_[slot] = slot;
                irBank_[bank][slot] = fullImpulse[slot];
            } else {
                const std::size_t start = 128 + (slot - 128) * 4;
                tapDelays_[slot] = start + 1;
                irBank_[bank][slot] = fullImpulse[start] + fullImpulse[start + 1]
                    + fullImpulse[start + 2] + fullImpulse[start + 3];
            }
        }
    }
    cabinet_.prepare(sampleRate_, 25.0); micPosition_.prepare(sampleRate_, 25.0);
    micBlend_.prepare(sampleRate_, 25.0); distance_.prepare(sampleRate_, 25.0);
    lowCut_.prepare(sampleRate_, 25.0); highCut_.prepare(sampleRate_, 25.0);
    resonance_.prepare(sampleRate_, 25.0); level_.prepare(sampleRate_, 20.0);
}

void CabinetIr::reset(float normalized) noexcept {
    leftHistory_.fill(0.0f); rightHistory_.fill(0.0f); cursor_ = 0;
    reflectionHistoryLeft_.fill(0.0f); reflectionHistoryRight_.fill(0.0f); reflectionCursor_ = 0;
    lowPassLeft_.fill(0.0f); lowPassRight_.fill(0.0f);
    highPassLeft_.fill(0.0f); highPassRight_.fill(0.0f);
    resonanceLeft_ = resonanceRight_ = 0.0f; morphCountdown_ = 0;
    cabinet_.reset(std::clamp(normalized, 0.0f, 1.0f)); micPosition_.reset(0.58f);
    micBlend_.reset(0.22f); distance_.reset(0.08f); lowCut_.reset(0.18f); highCut_.reset(0.48f);
    resonance_.reset(0.5f); level_.reset(1.0f);
    rebuildMorphedIr(cabinet_.current(), micPosition_.current(), micBlend_.current());
}

void CabinetIr::setNormalized(float normalized) noexcept { cabinet_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setMicPosition(float normalized) noexcept { micPosition_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setMicBlend(float normalized) noexcept { micBlend_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setDistance(float normalized) noexcept { distance_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setLowCut(float normalized) noexcept { lowCut_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setHighCut(float normalized) noexcept { highCut_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setResonance(float normalized) noexcept { resonance_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CabinetIr::setLevel(float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    level_.setTarget(std::pow(10.0f, ((value - 0.5f) * 24.0f) / 20.0f));
}

void CabinetIr::setCustomImpulse(const std::vector<std::size_t>& delays, const std::vector<float>& coefficients) noexcept {
    customTapCount_ = std::min({delays.size(), coefficients.size(), kCustomTapCount});
    for (std::size_t index = 0; index < customTapCount_; ++index) {
        customTapDelays_[index] = std::min(delays[index], kCustomIrLength - 1);
        customIr_[index] = coefficients[index];
    }
    leftHistory_.fill(0.0f); rightHistory_.fill(0.0f); cursor_ = 0;
}

void CabinetIr::clearCustomImpulse() noexcept {
    customTapCount_ = 0;
    leftHistory_.fill(0.0f); rightHistory_.fill(0.0f); cursor_ = 0;
}

void CabinetIr::rebuildMorphedIr(float cabinet, float position, float micBlend) noexcept {
    for (std::size_t tap = 0; tap < kTapCount; ++tap) {
        const float vintageDynamic = irBank_[0][tap] + (irBank_[1][tap] - irBank_[0][tap]) * position;
        const float modernDynamic = irBank_[4][tap] + (irBank_[5][tap] - irBank_[4][tap]) * position;
        const float dynamic = vintageDynamic + (modernDynamic - vintageDynamic) * cabinet;
        const float vintageRibbon = irBank_[2][tap] + (irBank_[3][tap] - irBank_[2][tap]) * position;
        const float modernRibbon = irBank_[6][tap] + (irBank_[7][tap] - irBank_[6][tap]) * position;
        const float ribbon = vintageRibbon + (modernRibbon - vintageRibbon) * cabinet;
        morphedIr_[tap] = dynamic + (ribbon - dynamic) * micBlend;
    }
}

void CabinetIr::processFrame(float& left, float& right) noexcept {
    leftHistory_[cursor_] = left; rightHistory_[cursor_] = right;
    const float cabinet = cabinet_.next(); const float mic = micPosition_.next();
    const float micBlend = micBlend_.next(); const float distance = distance_.next();
    const float lowCut = lowCut_.next(); const float highCut = highCut_.next();
    if (customTapCount_ == 0 && morphCountdown_ == 0) {
        rebuildMorphedIr(cabinet, mic, micBlend);
        morphCountdown_ = 31;
    } else if (customTapCount_ == 0) {
        --morphCountdown_;
    }
    float convolvedLeft = 0.0f; float convolvedRight = 0.0f;
    const std::size_t tapCount = customTapCount_ == 0 ? kTapCount : customTapCount_;
    const std::size_t historyLength = customTapCount_ == 0 ? kIrLength : kCustomIrLength;
    for (std::size_t tap = 0; tap < tapCount; ++tap) {
        const std::size_t delayed = customTapCount_ == 0 ? tapDelays_[tap] : customTapDelays_[tap];
        const std::size_t historyIndex = cursor_ >= delayed
            ? cursor_ - delayed : cursor_ + historyLength - delayed;
        const float coefficient = customTapCount_ == 0 ? morphedIr_[tap] : customIr_[tap];
        convolvedLeft += leftHistory_[historyIndex] * coefficient;
        convolvedRight += rightHistory_[historyIndex] * coefficient;
    }
    cursor_ = (cursor_ + 1) % historyLength;
    if (customTapCount_ == 0) {
        reflectionHistoryLeft_[reflectionCursor_] = convolvedLeft;
        reflectionHistoryRight_[reflectionCursor_] = convolvedRight;
        const auto reflectionDelay = std::clamp<std::size_t>(
            static_cast<std::size_t>(sampleRate_ * (0.00025 + static_cast<double>(distance) * 0.00175)), 1, kReflectionHistory / 3);
        const auto firstReflectionIndex = (reflectionCursor_ + kReflectionHistory - reflectionDelay) % kReflectionHistory;
        const auto secondReflectionIndex = (reflectionCursor_ + kReflectionHistory - reflectionDelay * 2) % kReflectionHistory;
        convolvedLeft += reflectionHistoryLeft_[firstReflectionIndex] * distance * 0.16f
            - reflectionHistoryLeft_[secondReflectionIndex] * distance * 0.065f;
        convolvedRight += reflectionHistoryRight_[firstReflectionIndex] * distance * 0.16f
            - reflectionHistoryRight_[secondReflectionIndex] * distance * 0.065f;
        reflectionCursor_ = (reflectionCursor_ + 1) % kReflectionHistory;
    }
    constexpr float pi = 3.14159265358979323846f;
    const float resonance = resonance_.next(); const float level = level_.next();
    const float lowCutHz = 45.0f * std::pow(3.1f, lowCut);
    const float highCutHz = std::clamp(
        4200.0f * std::pow(2.0f, highCut * 1.25f) * (0.76f + mic * 0.48f)
            * (1.0f - micBlend * 0.12f) * (1.0f - distance * 0.16f),
        2800.0f, static_cast<float>(sampleRate_) * 0.42f);
    const float highPassAlpha = 1.0f - std::exp(-2.0f * pi * lowCutHz / static_cast<float>(sampleRate_));
    const float lowPassAlpha = 1.0f - std::exp(-2.0f * pi * highCutHz / static_cast<float>(sampleRate_));
    for (std::size_t stage = 0; stage < highPassLeft_.size(); ++stage) {
        highPassLeft_[stage] += highPassAlpha * (convolvedLeft - highPassLeft_[stage]);
        highPassRight_[stage] += highPassAlpha * (convolvedRight - highPassRight_[stage]);
        convolvedLeft -= highPassLeft_[stage]; convolvedRight -= highPassRight_[stage];
    }
    for (std::size_t stage = 0; stage < lowPassLeft_.size(); ++stage) {
        lowPassLeft_[stage] += lowPassAlpha * (convolvedLeft - lowPassLeft_[stage]);
        lowPassRight_[stage] += lowPassAlpha * (convolvedRight - lowPassRight_[stage]);
        convolvedLeft = lowPassLeft_[stage]; convolvedRight = lowPassRight_[stage];
    }
    const float resonanceHz = 88.0f + cabinet * 30.0f;
    const float resonanceAlpha = 1.0f - std::exp(-2.0f * pi * resonanceHz / static_cast<float>(sampleRate_));
    resonanceLeft_ += resonanceAlpha * (convolvedLeft - resonanceLeft_); resonanceRight_ += resonanceAlpha * (convolvedRight - resonanceRight_);
    const float resonanceGain = (resonance - 0.5f) * 0.62f;
    left = (convolvedLeft + resonanceLeft_ * resonanceGain) * level;
    right = (convolvedRight + resonanceRight_ * resonanceGain) * level;
}

void CrossDelay::prepare(const ProcessSpec& spec) {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    const auto delayLength = std::max<std::size_t>(
        2,
        static_cast<std::size_t>(sampleRate_ * 1.01));
    leftDelay_.assign(delayLength, 0.0f);
    rightDelay_.assign(delayLength, 0.0f);
    cursor_ = 0;
    amount_.prepare(spec.sampleRate, 20.0);
    time_.prepare(spec.sampleRate, 20.0);
    feedback_.prepare(spec.sampleRate, 20.0);
    crossfeed_.prepare(spec.sampleRate, 20.0);
    filter_.prepare(spec.sampleRate, 20.0);
}

void CrossDelay::reset(float normalized) noexcept {
    std::fill(leftDelay_.begin(), leftDelay_.end(), 0.0f);
    std::fill(rightDelay_.begin(), rightDelay_.end(), 0.0f);
    cursor_ = 0;
    filteredLeft_ = filteredRight_ = 0.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
    time_.reset(0.19f);
    feedback_.reset(0.29f);
    crossfeed_.reset(1.0f);
    filter_.reset(1.0f);
    timeOverridden_ = feedbackOverridden_ = false;
}

void CrossDelay::setTime(float normalized) noexcept { const float value=std::clamp(normalized,0.0f,1.0f);timeOverridden_=true;time_.setTarget(0.02f*std::pow(50.0f,value)); }
void CrossDelay::setFeedback(float normalized) noexcept { const float value=std::clamp(normalized,0.0f,1.0f);feedbackOverridden_=true;feedback_.setTarget(0.05f+value*0.8f); }
void CrossDelay::setCrossfeed(float normalized) noexcept { crossfeed_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }
void CrossDelay::setFilter(float normalized) noexcept { filter_.setTarget(std::clamp(normalized, 0.0f, 1.0f)); }

void CrossDelay::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void CrossDelay::processFrame(float& left, float& right) noexcept {
    const float amount = amount_.next();
    if (leftDelay_.empty() || amount <= 0.0001f) return;
    const float delaySeconds = time_.next();
    const float feedback = feedback_.next();
    const float crossfeed = crossfeed_.next();
    const float filterControl = filter_.next();
    const auto delaySamples = std::clamp<std::size_t>(static_cast<std::size_t>(std::lround(sampleRate_ * delaySeconds)), 1, leftDelay_.size() - 1);
    const auto readCursor = (cursor_ + leftDelay_.size() - delaySamples) % leftDelay_.size();
    const float delayedLeft = leftDelay_[readCursor];
    const float delayedRight = rightDelay_[readCursor];
    const float filterAlpha = 0.02f + filterControl * 0.98f;
    filteredLeft_ += filterAlpha * (delayedLeft - filteredLeft_);
    filteredRight_ += filterAlpha * (delayedRight - filteredRight_);
    const float effectiveFeedback = feedbackOverridden_ ? feedback : 0.18f + amount * 0.5f;
    const float returnLeft = filteredLeft_ * (1.0f - crossfeed) + filteredRight_ * crossfeed;
    const float returnRight = filteredRight_ * (1.0f - crossfeed) + filteredLeft_ * crossfeed;
    leftDelay_[cursor_] = left + returnLeft * effectiveFeedback;
    rightDelay_[cursor_] = right + returnRight * effectiveFeedback;
    cursor_ = (cursor_ + 1) % leftDelay_.size();
    left += filteredLeft_ * amount * 0.32f;
    right += filteredRight_ * amount * 0.32f;
}

void ModulationDelay::prepare(const ProcessSpec& spec) {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    const auto length = std::max<std::size_t>(4, static_cast<std::size_t>(sampleRate_ * 0.06));
    leftDelay_.assign(length, 0.0f); rightDelay_.assign(length, 0.0f);
    mix_.prepare(sampleRate_, 15.0); rate_.prepare(sampleRate_, 20.0); depth_.prepare(sampleRate_, 20.0);
    delay_.prepare(sampleRate_, 20.0); feedback_.prepare(sampleRate_, 20.0); stereo_.prepare(sampleRate_, 20.0);
}

void ModulationDelay::reset(float normalized) noexcept {
    std::fill(leftDelay_.begin(), leftDelay_.end(), 0.0f); std::fill(rightDelay_.begin(), rightDelay_.end(), 0.0f);
    cursor_ = 0; phase_ = 0.0f; lastLeft_ = lastRight_ = 0.0f;
    mix_.reset(std::clamp(normalized, 0.0f, 1.0f)); rate_.reset(mode_ == Mode::Flanger ? 0.32f : 0.4f);
    depth_.reset(mode_ == Mode::Vibrato ? 0.45f : 0.6f); delay_.reset(mode_ == Mode::Flanger ? 0.38f : 0.48f);
    feedback_.reset(mode_ == Mode::Flanger ? 0.68f : 0.35f); stereo_.reset(mode_ == Mode::Chorus ? 0.75f : 0.5f);
}

void ModulationDelay::setNormalized(float value) noexcept { mix_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void ModulationDelay::setRate(float value) noexcept { rate_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void ModulationDelay::setDepth(float value) noexcept { depth_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void ModulationDelay::setDelay(float value) noexcept { delay_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void ModulationDelay::setFeedback(float value) noexcept { feedback_.setTarget(std::clamp(value, 0.0f, 1.0f)); }
void ModulationDelay::setStereo(float value) noexcept { stereo_.setTarget(std::clamp(value, 0.0f, 1.0f)); }

float ModulationDelay::readDelay(const std::vector<float>& buffer, float samples) const noexcept {
    if (buffer.empty()) return 0.0f;
    float position = static_cast<float>(cursor_) - samples;
    while (position < 0.0f) position += static_cast<float>(buffer.size());
    const auto first = static_cast<std::size_t>(position) % buffer.size();
    const auto second = (first + 1) % buffer.size();
    const float fraction = position - std::floor(position);
    return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

void ModulationDelay::processFrame(float& left, float& right) noexcept {
    if (leftDelay_.empty()) return;
    constexpr float pi = 3.14159265358979323846f;
    const float mix = mix_.next(); const float rate = 0.05f * std::pow(100.0f, rate_.next());
    const float depth = depth_.next(); const float delay = delay_.next(); const float feedbackControl = feedback_.next();
    const float stereoPhase = stereo_.next() * pi;
    float baseMilliseconds = 8.0f + delay * 20.0f; float sweepMilliseconds = depth * 10.0f;
    float feedback = feedbackControl * 0.55f;
    if (mode_ == Mode::Flanger) {
        baseMilliseconds = 0.25f + delay * 7.75f; sweepMilliseconds = 0.1f + depth * 4.9f;
        feedback = (feedbackControl - 0.5f) * 1.5f;
    } else if (mode_ == Mode::Vibrato) {
        baseMilliseconds = 7.0f; sweepMilliseconds = 0.2f + depth * 6.0f; feedback = 0.0f;
    }
    const float delayLeft = std::max(1.0f, static_cast<float>(sampleRate_) * 0.001f
        * (baseMilliseconds + sweepMilliseconds * (0.5f + 0.5f * std::sin(phase_))));
    const float delayRight = std::max(1.0f, static_cast<float>(sampleRate_) * 0.001f
        * (baseMilliseconds + sweepMilliseconds * (0.5f + 0.5f * std::sin(phase_ + stereoPhase))));
    const float wetLeft = readDelay(leftDelay_, delayLeft); const float wetRight = readDelay(rightDelay_, delayRight);
    leftDelay_[cursor_] = left + lastLeft_ * feedback; rightDelay_[cursor_] = right + lastRight_ * feedback;
    lastLeft_ = wetLeft; lastRight_ = wetRight; cursor_ = (cursor_ + 1) % leftDelay_.size();
    phase_ += 2.0f * pi * rate / static_cast<float>(sampleRate_); if (phase_ >= 2.0f * pi) phase_ -= 2.0f * pi;
    const float dryGain = mode_ == Mode::Vibrato ? 1.0f - mix : 1.0f - mix * 0.5f;
    left = left * dryGain + wetLeft * mix; right = right * dryGain + wetRight * mix;
}

void StereoTremolo::prepare(const ProcessSpec& spec) noexcept {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    mix_.prepare(sampleRate_, 15.0); rate_.prepare(sampleRate_, 20.0); depth_.prepare(sampleRate_, 20.0);
    shape_.prepare(sampleRate_, 20.0); stereo_.prepare(sampleRate_, 20.0);
}
void StereoTremolo::reset(float normalized) noexcept { phase_ = 0.0f; mix_.reset(std::clamp(normalized,0.0f,1.0f)); rate_.reset(0.48f); depth_.reset(0.7f); shape_.reset(0.35f); stereo_.reset(0.5f); }
void StereoTremolo::setNormalized(float value) noexcept { mix_.setTarget(std::clamp(value,0.0f,1.0f)); }
void StereoTremolo::setRate(float value) noexcept { rate_.setTarget(std::clamp(value,0.0f,1.0f)); }
void StereoTremolo::setDepth(float value) noexcept { depth_.setTarget(std::clamp(value,0.0f,1.0f)); }
void StereoTremolo::setShape(float value) noexcept { shape_.setTarget(std::clamp(value,0.0f,1.0f)); }
void StereoTremolo::setStereo(float value) noexcept { stereo_.setTarget(std::clamp(value,0.0f,1.0f)); }
void StereoTremolo::processFrame(float& left, float& right) noexcept {
    constexpr float pi = 3.14159265358979323846f;
    const float mix=mix_.next(), rate=0.2f*std::pow(60.0f,rate_.next()), depth=depth_.next(), shape=shape_.next();
    const auto lfo=[shape](float phase) noexcept { const float sine=0.5f+0.5f*std::sin(phase); const float position=std::fmod(phase/(2.0f*pi)+0.25f,1.0f); const float triangle=1.0f-std::abs(2.0f*position-1.0f); const float square=std::sin(phase)>=0.0f?1.0f:0.0f; return shape<0.5f?sine+(triangle-sine)*shape*2.0f:triangle+(square-triangle)*(shape-0.5f)*2.0f; };
    const float phaseRight=phase_+stereo_.next()*pi; const float gainLeft=1.0f-depth*(1.0f-lfo(phase_)); const float gainRight=1.0f-depth*(1.0f-lfo(phaseRight));
    left*=1.0f+((gainLeft)-1.0f)*mix; right*=1.0f+((gainRight)-1.0f)*mix;
    phase_+=2.0f*pi*rate/static_cast<float>(sampleRate_); if(phase_>=2.0f*pi)phase_-=2.0f*pi;
}

void DigitalDelay::prepare(const ProcessSpec& spec) {
    sampleRate_=std::max(1.0,spec.sampleRate); const auto length=std::max<std::size_t>(4,static_cast<std::size_t>(sampleRate_*0.82));
    leftDelay_.assign(length,0.0f);rightDelay_.assign(length,0.0f);cursor_=0;
    mix_.prepare(sampleRate_,15);time_.prepare(sampleRate_,25);feedback_.prepare(sampleRate_,20);tone_.prepare(sampleRate_,20);character_.prepare(sampleRate_,20);stereo_.prepare(sampleRate_,20);
}
void DigitalDelay::reset(float value) noexcept { std::fill(leftDelay_.begin(),leftDelay_.end(),0.0f);std::fill(rightDelay_.begin(),rightDelay_.end(),0.0f);cursor_=0;filteredLeft_=filteredRight_=0;mix_.reset(std::clamp(value,0.0f,1.0f));time_.reset(0.62f);feedback_.reset(0.38f);tone_.reset(0.58f);character_.reset(0.72f);stereo_.reset(0.35f); }
void DigitalDelay::setNormalized(float v) noexcept {mix_.setTarget(std::clamp(v,0.0f,1.0f));} void DigitalDelay::setTime(float v) noexcept {time_.setTarget(std::clamp(v,0.0f,1.0f));}
void DigitalDelay::setFeedback(float v) noexcept {feedback_.setTarget(std::clamp(v,0.0f,1.0f));} void DigitalDelay::setTone(float v) noexcept {tone_.setTarget(std::clamp(v,0.0f,1.0f));}
void DigitalDelay::setCharacter(float v) noexcept {character_.setTarget(std::clamp(v,0.0f,1.0f));} void DigitalDelay::setStereo(float v) noexcept {stereo_.setTarget(std::clamp(v,0.0f,1.0f));}
void DigitalDelay::processFrame(float& left,float& right) noexcept {
    if (leftDelay_.empty()) return;
    constexpr float pi=3.14159265358979323846f;
    const float mix=mix_.next(),seconds=0.01f*std::pow(80.0f,time_.next()),feedback=feedback_.next()*0.92f,tone=tone_.next(),character=character_.next(),stereo=stereo_.next();
    const auto samples=std::clamp<std::size_t>(static_cast<std::size_t>(std::lround(sampleRate_*seconds)),1,leftDelay_.size()-1);const auto read=(cursor_+leftDelay_.size()-samples)%leftDelay_.size();
    const float delayedLeft=leftDelay_[read],delayedRight=rightDelay_[read];const float cutoff=std::min(static_cast<float>(sampleRate_)*0.42f,1800.0f*std::pow(8.0f,tone)*(1.0f-character*0.34f));
    const float alpha=1.0f-std::exp(-2.0f*pi*cutoff/static_cast<float>(sampleRate_));filteredLeft_+=alpha*(delayedLeft-filteredLeft_);filteredRight_+=alpha*(delayedRight-filteredRight_);
    const float drive=1.0f+character*0.65f,norm=std::tanh(drive),levels=32768.0f*std::pow(0.0625f,character);
    const auto encode=[=](float sample) noexcept {const float compressed=std::tanh(sample*drive)/norm;return std::round(compressed*levels)/levels;};
    const float returnLeft=filteredLeft_*(1.0f-stereo)+filteredRight_*stereo,returnRight=filteredRight_*(1.0f-stereo)+filteredLeft_*stereo;
    leftDelay_[cursor_]=encode(left+returnLeft*feedback);rightDelay_[cursor_]=encode(right+returnRight*feedback);cursor_=(cursor_+1)%leftDelay_.size();
    left=left*(1.0f-mix)+filteredLeft_*mix;right=right*(1.0f-mix)+filteredRight_*mix;
}

void SpatialReverb::prepare(const ProcessSpec& spec) {
    sampleRate_=std::max(1.0,spec.sampleRate); for(auto& line:tank_)line.assign(std::max<std::size_t>(8,static_cast<std::size_t>(sampleRate_*0.12)),0.0f);
    preDelayLeft_.assign(std::max<std::size_t>(4,static_cast<std::size_t>(sampleRate_*0.125)),0);preDelayRight_=preDelayLeft_;
    pitchLeft_.assign(std::max<std::size_t>(8,static_cast<std::size_t>(sampleRate_*0.09)),0);pitchRight_=pitchLeft_;
    mix_.prepare(sampleRate_,20);mode_.prepare(sampleRate_,40);size_.prepare(sampleRate_,30);decay_.prepare(sampleRate_,30);damping_.prepare(sampleRate_,30);preDelay_.prepare(sampleRate_,25);modulation_.prepare(sampleRate_,30);shimmer_.prepare(sampleRate_,30);
}
void SpatialReverb::reset(float v) noexcept {for(auto&line:tank_)std::fill(line.begin(),line.end(),0.0f);std::fill(preDelayLeft_.begin(),preDelayLeft_.end(),0.0f);std::fill(preDelayRight_.begin(),preDelayRight_.end(),0.0f);std::fill(pitchLeft_.begin(),pitchLeft_.end(),0.0f);std::fill(pitchRight_.begin(),pitchRight_.end(),0.0f);tankCursor_={};preDelayCursor_=pitchCursor_=0;pitchPhaseA_=pitchPhaseB_=modulationPhase_=0;dampingState_={};dispersionState_={};choirState_={};mix_.reset(std::clamp(v,0.0f,1.0f));mode_.reset(1.0f);size_.reset(shimmerMode_?0.68f:0.58f);decay_.reset(shimmerMode_?0.68f:0.52f);damping_.reset(shimmerMode_?0.48f:0.55f);preDelay_.reset(shimmerMode_?0.22f:0.18f);modulation_.reset(0.22f);shimmer_.reset(shimmerMode_?0.5f:0.0f);}
void SpatialReverb::setNormalized(float v) noexcept {mix_.setTarget(std::clamp(v,0.0f,1.0f));} void SpatialReverb::setSize(float v) noexcept {size_.setTarget(std::clamp(v,0.0f,1.0f));}
void SpatialReverb::setMode(float v) noexcept {mode_.setTarget(std::clamp(v,0.0f,1.0f));}
void SpatialReverb::setDecay(float v) noexcept {decay_.setTarget(std::clamp(v,0.0f,1.0f));} void SpatialReverb::setDamping(float v) noexcept {damping_.setTarget(std::clamp(v,0.0f,1.0f));}
void SpatialReverb::setPreDelay(float v) noexcept {preDelay_.setTarget(std::clamp(v,0.0f,1.0f));} void SpatialReverb::setModulation(float v) noexcept {modulation_.setTarget(std::clamp(v,0.0f,1.0f));}
void SpatialReverb::setShimmer(float v) noexcept {shimmer_.setTarget(std::clamp(v,0.0f,1.0f));}
float SpatialReverb::readInterpolated(const std::vector<float>&buffer,std::size_t cursor,float delay) noexcept {float position=static_cast<float>(cursor)-delay;while(position<0)position+=static_cast<float>(buffer.size());const auto first=static_cast<std::size_t>(position)%buffer.size(),second=(first+1)%buffer.size();const float fraction=position-std::floor(position);return buffer[first]+(buffer[second]-buffer[first])*fraction;}
float SpatialReverb::pitchShift(const std::vector<float>&buffer,float voicePhase,float ratio,float offset) const noexcept {const float grain=static_cast<float>(sampleRate_*0.075);const float phase=std::fmod(voicePhase+offset,1.0f),phaseB=std::fmod(phase+0.5f,1.0f);const float a=readInterpolated(buffer,pitchCursor_,1.0f+(1.0f-phase)*grain),b=readInterpolated(buffer,pitchCursor_,1.0f+(1.0f-phaseB)*grain);const float wa=std::sin(3.14159265358979323846f*phase),wb=std::sin(3.14159265358979323846f*phaseB);const float sum=wa*wa+wb*wb;return(a*wa*wa+b*wb*wb)/std::max(0.001f,sum)*std::min(1.0f,1.25f/ratio);}
void SpatialReverb::processFrame(float&left,float&right) noexcept {
    if (tank_[0].empty()) return;
    constexpr float pi=3.14159265358979323846f;const float dryLeft=left,dryRight=right,mix=mix_.next(),sizeValue=size_.next(),decay=decay_.next(),damping=damping_.next(),pre=preDelay_.next(),mod=modulation_.next(),shimmer=shimmer_.next();const int mode=std::clamp(static_cast<int>(std::lround(mode_.next()*3.0f)),0,3);
    const auto preSamples=std::clamp<std::size_t>(static_cast<std::size_t>(pre*0.12f*sampleRate_),1,preDelayLeft_.size()-1);const auto preRead=(preDelayCursor_+preDelayLeft_.size()-preSamples)%preDelayLeft_.size();const float inputLeft=preDelayLeft_[preRead],inputRight=preDelayRight_[preRead];preDelayLeft_[preDelayCursor_]=left;preDelayRight_[preDelayCursor_]=right;preDelayCursor_=(preDelayCursor_+1)%preDelayLeft_.size();
    constexpr std::array<std::array<float,4>,4> delays{{{{13.7f,19.3f,23.1f,29.7f}},{{17.3f,25.1f,31.7f,38.9f}},{{21.1f,26.3f,34.7f,43.1f}},{{31.1f,43.7f,53.9f,67.3f}}}};constexpr std::array<float,4> sizeBase{0.46f,0.58f,0.62f,0.72f};constexpr std::array<float,4> sizeRange{0.72f,0.82f,0.88f,0.88f};constexpr std::array<float,4> brightness{0.72f,0.86f,1.08f,0.94f};constexpr std::array<float,4> modulationDepth{2.2f,1.3f,4.8f,6.2f};const float size=sizeBase[mode]+sizeValue*sizeRange[mode];std::array<float,4>x{};for(std::size_t i=0;i<4;++i){const float wobble=std::sin(modulationPhase_+static_cast<float>(i)*1.73f)*mod*modulationDepth[mode];const float delaySamples=std::clamp(static_cast<float>(sampleRate_)*0.001f*delays[mode][i]*size+wobble,2.0f,static_cast<float>(tank_[i].size()-2));x[i]=readInterpolated(tank_[i],tankCursor_[i],delaySamples);const float alpha=std::clamp((0.028f+(1.0f-damping)*0.48f)*brightness[mode],0.01f,0.62f);dampingState_[i]+=alpha*(x[i]-dampingState_[i]);x[i]=dampingState_[i];if(mode==1){for(int stage=0;stage<2;++stage){const std::size_t stateIndex=i*2+static_cast<std::size_t>(stage);const float coefficient=stage?0.71f:0.57f;const float output=-coefficient*x[i]+dispersionState_[stateIndex];dispersionState_[stateIndex]=x[i]+coefficient*output;x[i]=output;}}}
    const float m0=(x[0]+x[1]+x[2]+x[3])*0.5f,m1=(x[0]-x[1]+x[2]-x[3])*0.5f,m2=(x[0]+x[1]-x[2]-x[3])*0.5f,m3=(x[0]-x[1]-x[2]+x[3])*0.5f;constexpr std::array<float,4> feedbackBase{0.49f,0.53f,0.56f,0.58f};constexpr std::array<float,4> feedbackRange{0.43f,0.41f,0.41f,0.39f};const float feedback=std::min(0.965f,feedbackBase[mode]+decay*feedbackRange[mode]);
    float shiftedLeft=0,shiftedRight=0;if(shimmerMode_&&shimmer>0.0001f){pitchLeft_[pitchCursor_]=(x[0]+x[2])*0.5f;pitchRight_[pitchCursor_]=(x[1]+x[3])*0.5f;const float octave=2.0f,fifth=std::pow(2.0f,7.0f/12.0f);const float octaveLeft=pitchShift(pitchLeft_,pitchPhaseA_,octave,0),octaveRight=pitchShift(pitchRight_,pitchPhaseA_,octave,0.19f);const float fifthLeft=pitchShift(pitchLeft_,pitchPhaseB_,fifth,0.37f),fifthRight=pitchShift(pitchRight_,pitchPhaseB_,fifth,0.61f);const float choirAlpha=1.0f-std::exp(-2.0f*pi*4200.0f/static_cast<float>(sampleRate_));choirState_[0]+=choirAlpha*(octaveLeft-choirState_[0]);choirState_[1]+=choirAlpha*(octaveRight-choirState_[1]);choirState_[2]+=choirAlpha*(fifthLeft-choirState_[2]);choirState_[3]+=choirAlpha*(fifthRight-choirState_[3]);const float ensemble=0.5f+0.5f*std::sin(modulationPhase_*0.71f);shiftedLeft=choirState_[0]*0.62f+choirState_[2]*(0.28f+ensemble*0.12f);shiftedRight=choirState_[1]*0.62f+choirState_[3]*(0.40f-ensemble*0.12f);pitchCursor_=(pitchCursor_+1)%pitchLeft_.size();pitchPhaseA_=std::fmod(pitchPhaseA_+(octave-1.0f)/static_cast<float>(sampleRate_*0.075),1.0f);pitchPhaseB_=std::fmod(pitchPhaseB_+(fifth-1.0f)/static_cast<float>(sampleRate_*0.075),1.0f);}
    const float directCross=mode==0?0.22f:0.15f;const float pitchGain=shimmerMode_?shimmer*(0.16f+0.22f*shimmer):0.0f;const float injectionLeft=inputLeft*(0.48f-directCross)+inputRight*directCross+shiftedLeft*pitchGain,injectionRight=inputRight*(0.48f-directCross)+inputLeft*directCross+shiftedRight*pitchGain;const std::array<float,4>matrix{m0,m1,m2,m3};for(std::size_t i=0;i<4;++i){tank_[i][tankCursor_[i]]=std::tanh((i%2?injectionRight:injectionLeft)+matrix[i]*feedback);tankCursor_[i]=(tankCursor_[i]+1)%tank_[i].size();}
    modulationPhase_+=2*pi*(mode==3?0.13f:mode==2?0.19f:0.16f)/static_cast<float>(sampleRate_);if(modulationPhase_>=2*pi)modulationPhase_-=2*pi;const float earlyGain=mode==0?0.24f:mode==1?0.10f:0.06f;const float wetGain=mode==1?0.48f:mode==3?0.58f:0.55f;const float wetLeft=((x[0]+x[2]-x[1]*0.25f)*wetGain)+inputLeft*earlyGain,wetRight=((x[1]+x[3]-x[0]*0.25f)*wetGain)+inputRight*earlyGain;left=dryLeft*(1-mix)+wetLeft*mix;right=dryRight*(1-mix)+wetRight*mix;
}

void TempoDelay::prepare(const ProcessSpec& spec) {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    const auto length = std::max<std::size_t>(2, static_cast<std::size_t>(sampleRate_ * 2.0));
    leftDelay_.assign(length, 0.0f);
    rightDelay_.assign(length, 0.0f);
    cursor_ = 0;
    amount_.prepare(sampleRate_, 20.0);
}

void TempoDelay::reset(float normalized) noexcept {
    std::fill(leftDelay_.begin(), leftDelay_.end(), 0.0f);
    std::fill(rightDelay_.begin(), rightDelay_.end(), 0.0f);
    cursor_ = 0;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
}

void TempoDelay::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void TempoDelay::setTempoBpm(float bpm) noexcept {
    tempoBpm_ = std::clamp(bpm, 20.0f, 300.0f);
}

void TempoDelay::processFrame(float& left, float& right) noexcept {
    if (leftDelay_.empty()) return;
    const float amount = amount_.next();
    const auto delaySamples = std::clamp<std::size_t>(
        static_cast<std::size_t>(sampleRate_ * 30.0 / tempoBpm_), 1, leftDelay_.size() - 1);
    const auto readCursor = (cursor_ + leftDelay_.size() - delaySamples) % leftDelay_.size();
    const float delayedLeft = leftDelay_[readCursor];
    const float delayedRight = rightDelay_[readCursor];
    constexpr float feedback = 0.2f;
    leftDelay_[cursor_] = left + delayedRight * feedback;
    rightDelay_[cursor_] = right + delayedLeft * feedback;
    cursor_ = (cursor_ + 1) % leftDelay_.size();
    const float wet = 0.06f + amount * 0.18f;
    left += delayedLeft * wet;
    right += delayedRight * wet;
}

void StereoChorus::prepare(const ProcessSpec& spec) {
    sampleRate_ = std::max(1.0, spec.sampleRate);
    const auto length = std::max<std::size_t>(2, static_cast<std::size_t>(sampleRate_ * 0.05));
    leftDelay_.assign(length, 0.0f);
    rightDelay_.assign(length, 0.0f);
    cursor_ = 0;
    phase_ = 0.0f;
    amount_.prepare(sampleRate_, 20.0);
}

void StereoChorus::reset(float normalized) noexcept {
    std::fill(leftDelay_.begin(), leftDelay_.end(), 0.0f);
    std::fill(rightDelay_.begin(), rightDelay_.end(), 0.0f);
    cursor_ = 0;
    phase_ = 0.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
}

void StereoChorus::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

float StereoChorus::readDelay(const std::vector<float>& buffer, float delaySamples) const noexcept {
    if (buffer.empty()) return 0.0f;
    float position = static_cast<float>(cursor_) - delaySamples;
    while (position < 0.0f) position += static_cast<float>(buffer.size());
    const auto first = static_cast<std::size_t>(position) % buffer.size();
    const auto second = (first + 1) % buffer.size();
    const float fraction = position - std::floor(position);
    return buffer[first] + (buffer[second] - buffer[first]) * fraction;
}

void StereoChorus::processFrame(float& left, float& right) noexcept {
    if (leftDelay_.empty()) return;
    constexpr float pi = 3.14159265358979323846f;
    const float amount = amount_.next();
    leftDelay_[cursor_] = left;
    rightDelay_[cursor_] = right;
    const float baseDelay = static_cast<float>(sampleRate_ * 0.028);
    const float depth = static_cast<float>(sampleRate_ * 0.008);
    const float delayedLeft = readDelay(leftDelay_, baseDelay + depth * std::sin(phase_));
    const float delayedRight = readDelay(rightDelay_, baseDelay + depth * std::sin(phase_ + pi));
    cursor_ = (cursor_ + 1) % leftDelay_.size();
    phase_ += 2.0f * pi * 0.8f / static_cast<float>(sampleRate_);
    if (phase_ >= 2.0f * pi) phase_ -= 2.0f * pi;
    const float wet = 0.04f + amount * 0.12f;
    left += delayedLeft * wet;
    right += delayedRight * wet;
}

void StereoReverb::prepare(const ProcessSpec& spec) {
    const double sampleRate = std::max(1.0, spec.sampleRate);
    leftDelay_.assign(std::max<std::size_t>(2, static_cast<std::size_t>(sampleRate * 0.079)), 0.0f);
    rightDelay_.assign(std::max<std::size_t>(2, static_cast<std::size_t>(sampleRate * 0.113)), 0.0f);
    leftCursor_ = rightCursor_ = 0;
    amount_.prepare(sampleRate, 25.0);
}

void StereoReverb::reset(float normalized) noexcept {
    std::fill(leftDelay_.begin(), leftDelay_.end(), 0.0f);
    std::fill(rightDelay_.begin(), rightDelay_.end(), 0.0f);
    leftCursor_ = rightCursor_ = 0;
    dampedLeft_ = dampedRight_ = 0.0f;
    amount_.reset(std::clamp(normalized, 0.0f, 1.0f));
}

void StereoReverb::setNormalized(float normalized) noexcept {
    amount_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void StereoReverb::processFrame(float& left, float& right) noexcept {
    if (leftDelay_.empty() || rightDelay_.empty()) return;
    const float amount = amount_.next();
    const float delayedLeft = leftDelay_[leftCursor_];
    const float delayedRight = rightDelay_[rightCursor_];
    const float damping = 0.18f + amount * 0.32f;
    dampedLeft_ += damping * (delayedLeft - dampedLeft_);
    dampedRight_ += damping * (delayedRight - dampedRight_);
    const float feedback = 0.55f + amount * 0.28f;
    leftDelay_[leftCursor_] = left + dampedRight_ * feedback;
    rightDelay_[rightCursor_] = right + dampedLeft_ * feedback;
    leftCursor_ = (leftCursor_ + 1) % leftDelay_.size();
    rightCursor_ = (rightCursor_ + 1) % rightDelay_.size();
    const float wet = 0.08f + amount * 0.25f;
    left += (delayedLeft + delayedRight * 0.35f) * wet;
    right += (delayedRight + delayedLeft * 0.35f) * wet;
}

void DryWet::prepare(const ProcessSpec& spec) noexcept {
    mix_.prepare(spec.sampleRate, 10.0);
}

void DryWet::reset(float normalized) noexcept {
    mix_.reset(std::clamp(normalized, 0.0f, 1.0f));
}

void DryWet::setNormalized(float normalized) noexcept {
    mix_.setTarget(std::clamp(normalized, 0.0f, 1.0f));
}

void DryWet::processFrame(
    float dryLeft,
    float dryRight,
    float& wetLeft,
    float& wetRight) noexcept {
    const float mix = mix_.next();
    wetLeft = dryLeft + (wetLeft - dryLeft) * mix;
    wetRight = dryRight + (wetRight - dryRight) * mix;
}

EffectRack::Node::Node(const RackModuleConfig& source) noexcept : config(source) {}

void EffectRack::configure(
    const ProcessSpec& spec,
    const std::vector<RackModuleConfig>& modules) {
    nodes_.clear();
    nodes_.reserve(modules.size());
    for (const auto& module : modules) {
        nodes_.emplace_back(module);
        prepareNode(nodes_.back(), spec);
        resetNode(nodes_.back());
    }
}

void EffectRack::reset() noexcept {
    for (auto& node : nodes_) resetNode(node);
}

void EffectRack::processFrame(float& left, float& right) noexcept {
    float rackDryLeft = left;
    float rackDryRight = right;
    for (auto& node : nodes_) {
        if (node.config.type == RackModuleType::Unknown) continue;
        const float beforeLeft = left;
        const float beforeRight = right;
        switch (node.config.type) {
            case RackModuleType::InputTrim:
                node.inputTrim.processFrame(left, right);
                break;
            case RackModuleType::SoftClip:
                node.softClip.processFrame(left, right);
                break;
            case RackModuleType::LinkedCompressor:
                node.compressor.processFrame(left, right);
                break;
            case RackModuleType::DeEsser:
                node.deEsser.processFrame(left, right);
                break;
            case RackModuleType::ToneShaper:
                node.tone.processFrame(left, right);
                break;
            case RackModuleType::StereoWidth:
                node.width.processFrame(left, right);
                break;
            case RackModuleType::NoiseGate:
                node.noiseGate.processFrame(left, right);
                break;
            case RackModuleType::AmpOverdrive:
                node.overdrive.processFrame(left, right);
                break;
            case RackModuleType::AmpModel:
                node.ampModel.processFrame(left, right);
                break;
            case RackModuleType::DualHighGain:
                node.dualHighGain.processFrame(left, right);
                break;
            case RackModuleType::SilkBloom:
                node.silkBloom.processFrame(left, right);
                break;
            case RackModuleType::CabinetIr:
                node.cabinetIr.processFrame(left, right);
                break;
            case RackModuleType::CrossDelay:
                node.delay.processFrame(left, right);
                break;
            case RackModuleType::Chorus: node.chorus.processFrame(left, right); break;
            case RackModuleType::Flanger: node.flanger.processFrame(left, right); break;
            case RackModuleType::Tremolo: node.tremolo.processFrame(left, right); break;
            case RackModuleType::Vibrato: node.vibrato.processFrame(left, right); break;
            case RackModuleType::DigitalDelay: node.digitalDelay.processFrame(left, right); break;
            case RackModuleType::Reverb: node.reverb.processFrame(left, right); break;
            case RackModuleType::Shimmer: node.shimmer.processFrame(left, right); break;
            case RackModuleType::DryWet:
                node.dryWet.processFrame(rackDryLeft, rackDryRight, left, right);
                break;
            case RackModuleType::OutputTrim:
                node.outputTrim.processFrame(left, right);
                break;
            case RackModuleType::Unknown:
                break;
        }
        const float moduleMix = node.mix.next() * (1.0f - node.bypass.next());
        if (node.config.type == RackModuleType::LinkedCompressor) {
            node.effectiveGainReduction = 1.0f - moduleMix * (1.0f - node.compressor.gainReduction());
        }
        left = beforeLeft + (left - beforeLeft) * moduleMix;
        right = beforeRight + (right - beforeRight) * moduleMix;
        if (node.config.type == RackModuleType::InputTrim) {
            rackDryLeft = left;
            rackDryRight = right;
        }
    }
}

float EffectRack::gainReduction(std::size_t moduleIndex) const noexcept {
    const auto normalized = [](float gain) {
        return std::clamp(-20.0f * std::log10(std::max(0.000001f, gain)) / 24.0f, 0.0f, 1.0f);
    };
    if (moduleIndex < nodes_.size()) {
        const auto& node = nodes_[moduleIndex];
        return node.config.type == RackModuleType::LinkedCompressor ? normalized(node.effectiveGainReduction) : 0.0f;
    }
    float maximum = 0.0f;
    for (const auto& node : nodes_) {
        if (node.config.type == RackModuleType::LinkedCompressor) maximum = std::max(maximum, normalized(node.effectiveGainReduction));
    }
    return maximum;
}

void EffectRack::setInput(float normalized) noexcept {
    setLegacyValue(RackModuleType::InputTrim, normalized);
}

void EffectRack::setDrive(float normalized) noexcept {
    setLegacyValue(RackModuleType::SoftClip, normalized);
}

void EffectRack::setCompress(float normalized) noexcept {
    setLegacyValue(RackModuleType::LinkedCompressor, normalized);
}

void EffectRack::setTone(float normalized) noexcept {
    setLegacyValue(RackModuleType::ToneShaper, normalized);
}

void EffectRack::setWidth(float normalized) noexcept {
    setLegacyValue(RackModuleType::StereoWidth, normalized);
}

void EffectRack::setSpace(float normalized) noexcept {
    setLegacyValue(RackModuleType::CrossDelay, normalized);
}

void EffectRack::setDryWet(float normalized) noexcept {
    setLegacyValue(RackModuleType::DryWet, normalized);
}

void EffectRack::setOutput(float normalized) noexcept {
    setLegacyValue(RackModuleType::OutputTrim, normalized);
}

void EffectRack::setModuleNormalized(std::size_t index, float normalized) noexcept {
    if (index >= nodes_.size()) return;
    auto& node = nodes_[index];
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    node.config.normalized = value;
    switch (node.config.type) {
        case RackModuleType::InputTrim: node.inputTrim.setNormalized(value); break;
        case RackModuleType::SoftClip: node.softClip.setNormalized(value); break;
        case RackModuleType::LinkedCompressor: node.compressor.setNormalized(value); break;
        case RackModuleType::DeEsser: node.deEsser.setNormalized(value); break;
        case RackModuleType::ToneShaper: node.tone.setNormalized(value); break;
        case RackModuleType::StereoWidth: node.width.setNormalized(value); break;
        case RackModuleType::NoiseGate: node.noiseGate.setNormalized(value); break;
        case RackModuleType::AmpOverdrive: node.overdrive.setNormalized(value); break;
        case RackModuleType::AmpModel: node.ampModel.setNormalized(value); break;
        case RackModuleType::DualHighGain: node.dualHighGain.setNormalized(value); break;
        case RackModuleType::SilkBloom: node.silkBloom.setNormalized(value); break;
        case RackModuleType::CabinetIr: node.cabinetIr.setNormalized(value); break;
        case RackModuleType::CrossDelay: node.delay.setNormalized(value); break;
        case RackModuleType::Chorus: node.chorus.setNormalized(value); break;
        case RackModuleType::Flanger: node.flanger.setNormalized(value); break;
        case RackModuleType::Tremolo: node.tremolo.setNormalized(value); break;
        case RackModuleType::Vibrato: node.vibrato.setNormalized(value); break;
        case RackModuleType::DigitalDelay: node.digitalDelay.setNormalized(value); break;
        case RackModuleType::Reverb: node.reverb.setNormalized(value); break;
        case RackModuleType::Shimmer: node.shimmer.setNormalized(value); break;
        case RackModuleType::DryWet: node.dryWet.setNormalized(value); break;
        case RackModuleType::OutputTrim: node.outputTrim.setNormalized(value); break;
        case RackModuleType::Unknown: break;
    }
}

void EffectRack::setModuleParameter(std::size_t index, const char* key, float normalized) noexcept {
    if (index >= nodes_.size() || !key) return;
    auto& node = nodes_[index];
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    if (!std::strcmp(key, "normalized") || !std::strcmp(key, "value") || !std::strcmp(key, "amount")) {
        setModuleNormalized(index, value);
        return;
    }
    switch (node.config.type) {
        case RackModuleType::InputTrim:
            if (!std::strcmp(key, "input") || !std::strcmp(key, "gain")) node.inputTrim.setNormalized(value);
            break;
        case RackModuleType::SoftClip:
            if (!std::strcmp(key, "drive")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "character")) node.softClip.setCharacter(value);
            else if (!std::strcmp(key, "output")) node.softClip.setOutput(value);
            break;
        case RackModuleType::LinkedCompressor:
            if (!std::strcmp(key, "compress")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "threshold")) node.compressor.setThreshold(value);
            else if (!std::strcmp(key, "ratio")) node.compressor.setRatio(value);
            else if (!std::strcmp(key, "attack")) node.compressor.setAttack(value);
            else if (!std::strcmp(key, "release")) node.compressor.setRelease(value);
            else if (!std::strcmp(key, "makeup")) node.compressor.setMakeup(value);
            break;
        case RackModuleType::DeEsser:
            if (!std::strcmp(key, "frequency")) node.deEsser.setFrequency(value);
            else if (!std::strcmp(key, "threshold")) node.deEsser.setThreshold(value);
            else if (!std::strcmp(key, "range")) node.deEsser.setRange(value);
            else if (!std::strcmp(key, "attack")) node.deEsser.setAttack(value);
            else if (!std::strcmp(key, "release")) node.deEsser.setRelease(value);
            break;
        case RackModuleType::ToneShaper:
            if (!std::strcmp(key, "tone")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "low")) node.tone.setLow(value);
            else if (!std::strcmp(key, "mid")) node.tone.setMid(value);
            else if (!std::strcmp(key, "high")) node.tone.setHigh(value);
            break;
        case RackModuleType::StereoWidth:
            if (!std::strcmp(key, "width")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "mono_bass")) node.width.setMonoBass(value);
            break;
        case RackModuleType::NoiseGate:
            if (!std::strcmp(key, "threshold")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "release")) node.noiseGate.setRelease(value);
            break;
        case RackModuleType::AmpOverdrive:
            if (!std::strcmp(key, "drive")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "tone")) node.overdrive.setTone(value);
            else if (!std::strcmp(key, "level")) node.overdrive.setLevel(value);
            break;
        case RackModuleType::AmpModel:
            if (!std::strcmp(key, "gain")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "bass")) node.ampModel.setBass(value);
            else if (!std::strcmp(key, "mid")) node.ampModel.setMid(value);
            else if (!std::strcmp(key, "treble")) node.ampModel.setTreble(value);
            else if (!std::strcmp(key, "presence")) node.ampModel.setPresence(value);
            else if (!std::strcmp(key, "master")) node.ampModel.setMaster(value);
            break;
        case RackModuleType::DualHighGain:
            if (!std::strcmp(key, "gain")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "mode")) node.dualHighGain.setMode(value);
            else if (!std::strcmp(key, "tight")) node.dualHighGain.setTight(value);
            else if (!std::strcmp(key, "bass")) node.dualHighGain.setBass(value);
            else if (!std::strcmp(key, "mid")) node.dualHighGain.setMid(value);
            else if (!std::strcmp(key, "treble")) node.dualHighGain.setTreble(value);
            else if (!std::strcmp(key, "presence")) node.dualHighGain.setPresence(value);
            else if (!std::strcmp(key, "depth")) node.dualHighGain.setDepth(value);
            else if (!std::strcmp(key, "sag")) node.dualHighGain.setSag(value);
            else if (!std::strcmp(key, "master")) node.dualHighGain.setMaster(value);
            break;
        case RackModuleType::SilkBloom:
            if (!std::strcmp(key,"gain")) setModuleNormalized(index,value);
            else if (!std::strcmp(key,"mode")) node.silkBloom.setMode(value);
            else if (!std::strcmp(key,"pickup")) node.silkBloom.setPickup(value);
            else if (!std::strcmp(key,"touch")) node.silkBloom.setTouch(value);
            else if (!std::strcmp(key,"bass")) node.silkBloom.setBass(value);
            else if (!std::strcmp(key,"mid")) node.silkBloom.setMid(value);
            else if (!std::strcmp(key,"treble")) node.silkBloom.setTreble(value);
            else if (!std::strcmp(key,"presence")) node.silkBloom.setPresence(value);
            else if (!std::strcmp(key,"sag")) node.silkBloom.setSag(value);
            else if (!std::strcmp(key,"master")) node.silkBloom.setMaster(value);
            break;
        case RackModuleType::CabinetIr:
            if (!std::strcmp(key, "cabinet")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "mic_position")) node.cabinetIr.setMicPosition(value);
            else if (!std::strcmp(key, "mic_blend")) node.cabinetIr.setMicBlend(value);
            else if (!std::strcmp(key, "distance")) node.cabinetIr.setDistance(value);
            else if (!std::strcmp(key, "low_cut")) node.cabinetIr.setLowCut(value);
            else if (!std::strcmp(key, "high_cut")) node.cabinetIr.setHighCut(value);
            else if (!std::strcmp(key, "resonance")) node.cabinetIr.setResonance(value);
            else if (!std::strcmp(key, "level")) node.cabinetIr.setLevel(value);
            break;
        case RackModuleType::CrossDelay:
            if (!std::strcmp(key, "space")) setModuleNormalized(index, value);
            else if (!std::strcmp(key, "time")) node.delay.setTime(value);
            else if (!std::strcmp(key, "feedback")) node.delay.setFeedback(value);
            else if (!std::strcmp(key, "crossfeed")) node.delay.setCrossfeed(value);
            else if (!std::strcmp(key, "filter")) node.delay.setFilter(value);
            break;
        case RackModuleType::Chorus:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"rate")) node.chorus.setRate(value); else if (!std::strcmp(key,"depth")) node.chorus.setDepth(value); else if (!std::strcmp(key,"delay")) node.chorus.setDelay(value); else if (!std::strcmp(key,"feedback")) node.chorus.setFeedback(value); else if (!std::strcmp(key,"stereo")) node.chorus.setStereo(value); break;
        case RackModuleType::Flanger:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"rate")) node.flanger.setRate(value); else if (!std::strcmp(key,"depth")) node.flanger.setDepth(value); else if (!std::strcmp(key,"manual")) node.flanger.setDelay(value); else if (!std::strcmp(key,"feedback")) node.flanger.setFeedback(value); else if (!std::strcmp(key,"stereo")) node.flanger.setStereo(value); break;
        case RackModuleType::Tremolo:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"rate")) node.tremolo.setRate(value); else if (!std::strcmp(key,"depth")) node.tremolo.setDepth(value); else if (!std::strcmp(key,"shape")) node.tremolo.setShape(value); else if (!std::strcmp(key,"stereo")) node.tremolo.setStereo(value); break;
        case RackModuleType::Vibrato:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"rate")) node.vibrato.setRate(value); else if (!std::strcmp(key,"depth")) node.vibrato.setDepth(value); else if (!std::strcmp(key,"stereo")) node.vibrato.setStereo(value); break;
        case RackModuleType::DigitalDelay:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"time")) node.digitalDelay.setTime(value); else if (!std::strcmp(key,"feedback")) node.digitalDelay.setFeedback(value); else if (!std::strcmp(key,"tone")) node.digitalDelay.setTone(value); else if (!std::strcmp(key,"character")) node.digitalDelay.setCharacter(value); else if (!std::strcmp(key,"stereo")) node.digitalDelay.setStereo(value); break;
        case RackModuleType::Reverb:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"mode")) node.reverb.setMode(value); else if (!std::strcmp(key,"size")) node.reverb.setSize(value); else if (!std::strcmp(key,"decay")) node.reverb.setDecay(value); else if (!std::strcmp(key,"damping")) node.reverb.setDamping(value); else if (!std::strcmp(key,"pre_delay")) node.reverb.setPreDelay(value); else if (!std::strcmp(key,"modulation")) node.reverb.setModulation(value); break;
        case RackModuleType::Shimmer:
            if (!std::strcmp(key,"mix")) setModuleNormalized(index,value); else if (!std::strcmp(key,"size")) node.shimmer.setSize(value); else if (!std::strcmp(key,"decay")) node.shimmer.setDecay(value); else if (!std::strcmp(key,"damping")) node.shimmer.setDamping(value); else if (!std::strcmp(key,"pre_delay")) node.shimmer.setPreDelay(value); else if (!std::strcmp(key,"shimmer")) node.shimmer.setShimmer(value); break;
        case RackModuleType::DryWet:
            if (!std::strcmp(key, "mix")) setModuleNormalized(index, value);
            break;
        case RackModuleType::OutputTrim:
            if (!std::strcmp(key, "output") || !std::strcmp(key, "gain")) node.outputTrim.setNormalized(value);
            break;
        case RackModuleType::Unknown:
            break;
    }
}

void EffectRack::setModuleMix(std::size_t index, float mix) noexcept {
    if (index >= nodes_.size()) return;
    auto& node = nodes_[index];
    node.config.mix = std::clamp(mix, 0.0f, 1.0f);
    node.mix.setTarget(node.config.mix);
}

void EffectRack::setCustomImpulse(
    std::size_t index, const std::vector<std::size_t>& delays, const std::vector<float>& coefficients) noexcept {
    if (index >= nodes_.size() || nodes_[index].config.type != RackModuleType::CabinetIr) return;
    if (delays.empty() || coefficients.empty()) nodes_[index].cabinetIr.clearCustomImpulse();
    else nodes_[index].cabinetIr.setCustomImpulse(delays, coefficients);
}

void EffectRack::setModuleBypassed(std::size_t index, bool bypassed) noexcept {
    if (index >= nodes_.size()) return;
    auto& node = nodes_[index];
    node.config.bypassed = bypassed;
    node.bypass.setTarget(bypassed ? 1.0f : 0.0f);
}

void EffectRack::setLegacyValue(RackModuleType type, float normalized) noexcept {
    const float value = std::clamp(normalized, 0.0f, 1.0f);
    for (auto& node : nodes_) {
        if (node.config.type != type) continue;
        node.config.normalized = value;
        switch (type) {
            case RackModuleType::InputTrim: node.inputTrim.setNormalized(value); break;
            case RackModuleType::SoftClip: node.softClip.setNormalized(value); break;
            case RackModuleType::LinkedCompressor: node.compressor.setNormalized(value); break;
            case RackModuleType::DeEsser: node.deEsser.setNormalized(value); break;
            case RackModuleType::ToneShaper: node.tone.setNormalized(value); break;
            case RackModuleType::StereoWidth: node.width.setNormalized(value); break;
            case RackModuleType::NoiseGate: node.noiseGate.setNormalized(value); break;
            case RackModuleType::AmpOverdrive: node.overdrive.setNormalized(value); break;
            case RackModuleType::AmpModel: node.ampModel.setNormalized(value); break;
            case RackModuleType::DualHighGain: node.dualHighGain.setNormalized(value); break;
            case RackModuleType::SilkBloom: node.silkBloom.setNormalized(value); break;
            case RackModuleType::CabinetIr: node.cabinetIr.setNormalized(value); break;
            case RackModuleType::CrossDelay: node.delay.setNormalized(value); break;
            case RackModuleType::Chorus: node.chorus.setNormalized(value); break;
            case RackModuleType::Flanger: node.flanger.setNormalized(value); break;
            case RackModuleType::Tremolo: node.tremolo.setNormalized(value); break;
            case RackModuleType::Vibrato: node.vibrato.setNormalized(value); break;
            case RackModuleType::DigitalDelay: node.digitalDelay.setNormalized(value); break;
            case RackModuleType::Reverb: node.reverb.setNormalized(value); break;
            case RackModuleType::Shimmer: node.shimmer.setNormalized(value); break;
            case RackModuleType::DryWet: node.dryWet.setNormalized(value); break;
            case RackModuleType::OutputTrim: node.outputTrim.setNormalized(value); break;
            case RackModuleType::Unknown: break;
        }
        break;
    }
}

void EffectRack::prepareNode(Node& node, const ProcessSpec& spec) {
    node.mix.prepare(spec.sampleRate, 10.0);
    node.bypass.prepare(spec.sampleRate, 10.0);
    switch (node.config.type) {
        case RackModuleType::InputTrim: node.inputTrim.prepare(spec); break;
        case RackModuleType::SoftClip: node.softClip.prepare(spec); break;
        case RackModuleType::LinkedCompressor: node.compressor.prepare(spec); break;
        case RackModuleType::DeEsser: node.deEsser.prepare(spec); break;
        case RackModuleType::ToneShaper: node.tone.prepare(spec); break;
        case RackModuleType::StereoWidth: node.width.prepare(spec); break;
        case RackModuleType::NoiseGate: node.noiseGate.prepare(spec); break;
        case RackModuleType::AmpOverdrive: node.overdrive.prepare(spec); break;
        case RackModuleType::AmpModel: node.ampModel.prepare(spec); break;
        case RackModuleType::DualHighGain: node.dualHighGain.prepare(spec); break;
        case RackModuleType::SilkBloom: node.silkBloom.prepare(spec); break;
        case RackModuleType::CabinetIr: node.cabinetIr.prepare(spec); break;
        case RackModuleType::CrossDelay: node.delay.prepare(spec); break;
        case RackModuleType::Chorus: node.chorus.prepare(spec); break;
        case RackModuleType::Flanger: node.flanger.prepare(spec); break;
        case RackModuleType::Tremolo: node.tremolo.prepare(spec); break;
        case RackModuleType::Vibrato: node.vibrato.prepare(spec); break;
        case RackModuleType::DigitalDelay: node.digitalDelay.prepare(spec); break;
        case RackModuleType::Reverb: node.reverb.prepare(spec); break;
        case RackModuleType::Shimmer: node.shimmer.prepare(spec); break;
        case RackModuleType::DryWet: node.dryWet.prepare(spec); break;
        case RackModuleType::OutputTrim: node.outputTrim.prepare(spec); break;
        case RackModuleType::Unknown: break;
    }
}

void EffectRack::resetNode(Node& node) noexcept {
    node.mix.reset(std::clamp(node.config.mix, 0.0f, 1.0f));
    node.bypass.reset(node.config.bypassed ? 1.0f : 0.0f);
    node.effectiveGainReduction = 1.0f;
    const float value = std::clamp(node.config.normalized, 0.0f, 1.0f);
    switch (node.config.type) {
        case RackModuleType::InputTrim: node.inputTrim.reset(value); break;
        case RackModuleType::SoftClip: node.softClip.reset(value); break;
        case RackModuleType::LinkedCompressor: node.compressor.reset(value); break;
        case RackModuleType::DeEsser: node.deEsser.reset(value); break;
        case RackModuleType::ToneShaper: node.tone.reset(value); break;
        case RackModuleType::StereoWidth: node.width.reset(value); break;
        case RackModuleType::NoiseGate: node.noiseGate.reset(value); break;
        case RackModuleType::AmpOverdrive: node.overdrive.reset(value); break;
        case RackModuleType::AmpModel: node.ampModel.reset(value); break;
        case RackModuleType::DualHighGain: node.dualHighGain.reset(value); break;
        case RackModuleType::SilkBloom: node.silkBloom.reset(value); break;
        case RackModuleType::CabinetIr: node.cabinetIr.reset(value); break;
        case RackModuleType::CrossDelay: node.delay.reset(value); break;
        case RackModuleType::Chorus: node.chorus.reset(value); break;
        case RackModuleType::Flanger: node.flanger.reset(value); break;
        case RackModuleType::Tremolo: node.tremolo.reset(value); break;
        case RackModuleType::Vibrato: node.vibrato.reset(value); break;
        case RackModuleType::DigitalDelay: node.digitalDelay.reset(value); break;
        case RackModuleType::Reverb: node.reverb.reset(value); break;
        case RackModuleType::Shimmer: node.shimmer.reset(value); break;
        case RackModuleType::DryWet: node.dryWet.reset(value); break;
        case RackModuleType::OutputTrim: node.outputTrim.reset(value); break;
        case RackModuleType::Unknown: break;
    }
}

} // namespace tripleside::dsp
