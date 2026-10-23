#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>

namespace tripleside::native {

class BarSpectrumAnalyzer {
public:
    static constexpr std::size_t fftSize = 2048;
    static constexpr std::size_t bandCount = 48;
    static constexpr float minimumFrequency = 35.f;
    static constexpr float maximumFrequency = 18000.f;
    static constexpr float dynamicRangeDb = 90.f;
    static constexpr float tiltDbPerOctave = 4.5f;
    static constexpr float attackSeconds = .045f;
    static constexpr float releaseSeconds = .34f;

    const std::array<float, bandCount>& process(
        const float* left, const float* right, std::size_t sampleCount,
        float sampleRate, float elapsedSeconds) {
        const auto leftTargets = channelTargets(left, sampleCount, sampleRate);
        const auto rightTargets = channelTargets(right ? right : left, sampleCount, sampleRate);
        elapsedSeconds = std::clamp(elapsedSeconds, .001f, .12f);
        for (std::size_t band = 0; band < bandCount; ++band) {
            const float target = std::max(leftTargets[band], rightTargets[band]);
            const float timeConstant = target > levels_[band] ? attackSeconds : releaseSeconds;
            const float blend = 1.f - std::exp(-elapsedSeconds / timeConstant);
            levels_[band] += (target - levels_[band]) * blend;
            if (levels_[band] < .001f) levels_[band] = 0.f;
        }
        return levels_;
    }

    const std::array<float, bandCount>& levels() const { return levels_; }
    void reset() { levels_.fill(0.f); }

private:
    static std::array<float, bandCount> channelTargets(
        const float* samples, std::size_t sampleCount, float sampleRate) {
        constexpr float pi = 3.14159265358979323846f;
        std::array<std::complex<float>, fftSize> bins{};
        if (samples && sampleCount) {
            const std::size_t sourceOffset = sampleCount > fftSize ? sampleCount - fftSize : 0;
            const std::size_t count = std::min(sampleCount, fftSize);
            const std::size_t destinationOffset = fftSize - count;
            for (std::size_t index = 0; index < count; ++index) {
                const std::size_t destination = destinationOffset + index;
                const float window = .5f - .5f * std::cos(2.f * pi * destination / (fftSize - 1));
                bins[destination] = {samples[sourceOffset + index] * window, 0.f};
            }
        }
        for (std::size_t index = 1, reversed = 0; index < fftSize; ++index) {
            std::size_t bit = fftSize >> 1;
            for (; reversed & bit; bit >>= 1) reversed ^= bit;
            reversed ^= bit;
            if (index < reversed) std::swap(bins[index], bins[reversed]);
        }
        for (std::size_t length = 2; length <= fftSize; length <<= 1) {
            const float angle = -2.f * pi / static_cast<float>(length);
            const std::complex<float> step(std::cos(angle), std::sin(angle));
            for (std::size_t offset = 0; offset < fftSize; offset += length) {
                std::complex<float> phase(1.f, 0.f);
                for (std::size_t item = 0; item < length / 2; ++item) {
                    const auto even = bins[offset + item];
                    const auto odd = bins[offset + item + length / 2] * phase;
                    bins[offset + item] = even + odd;
                    bins[offset + item + length / 2] = even - odd;
                    phase *= step;
                }
            }
        }

        std::array<float, bandCount> targets{};
        sampleRate = std::max(8000.f, sampleRate);
        const float frequencyRatio = maximumFrequency / minimumFrequency;
        for (std::size_t band = 0; band < bandCount; ++band) {
            const float startFrequency = minimumFrequency * std::pow(frequencyRatio, static_cast<float>(band) / bandCount);
            const float endFrequency = minimumFrequency * std::pow(frequencyRatio, static_cast<float>(band + 1) / bandCount);
            const float centerFrequency = std::sqrt(startFrequency * endFrequency);
            const std::size_t startBin = std::clamp<std::size_t>(static_cast<std::size_t>(std::floor(startFrequency * fftSize / sampleRate)), 1, fftSize / 2 - 1);
            const std::size_t endBin = std::clamp<std::size_t>(static_cast<std::size_t>(std::ceil(endFrequency * fftSize / sampleRate)), startBin, fftSize / 2 - 1);
            float power = 0.f, peakDb = -120.f;
            for (std::size_t bin = startBin; bin <= endBin; ++bin) {
                const float magnitude = std::abs(bins[bin]) / (fftSize * .25f);
                const float db = 20.f * std::log10(std::max(1e-12f, magnitude));
                power += std::pow(10.f, db / 10.f);
                peakDb = std::max(peakDb, db);
            }
            const float count = static_cast<float>(endBin - startBin + 1);
            const float rmsDb = 10.f * std::log10(std::max(1e-12f, power / count));
            const float measuredDb = std::max(rmsDb, peakDb - 8.f);
            if (measuredDb <= -99.f) continue;
            const float tiltedDb = measuredDb + tiltDbPerOctave * std::log2(centerFrequency / 1000.f);
            targets[band] = std::clamp((tiltedDb + dynamicRangeDb) / dynamicRangeDb, 0.f, 1.f);
        }
        return targets;
    }

    std::array<float, bandCount> levels_{};
};

} // namespace tripleside::native
