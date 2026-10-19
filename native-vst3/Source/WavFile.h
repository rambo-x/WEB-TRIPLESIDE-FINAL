#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace tripleside::native
{
struct WavFile
{
    int sampleRate = 0;
    int channels = 0;
    std::vector<float> interleaved;

    [[nodiscard]] std::size_t frameCount() const noexcept
    {
        return channels > 0 ? interleaved.size() / static_cast<std::size_t>(channels) : 0;
    }

    [[nodiscard]] float sample(std::size_t frame, int channel) const noexcept;
    [[nodiscard]] bool empty() const noexcept { return frameCount() == 0; }

    static bool load(const std::filesystem::path& path, WavFile& destination, std::string& error);
    static bool load(const unsigned char* data, std::size_t size, WavFile& destination, std::string& error);
};
} // namespace tripleside::native
