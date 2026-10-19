#include "WavFile.h"

#include <algorithm>
#include <cstring>
#include <fstream>
#include <limits>

namespace tripleside::native
{
namespace
{
std::uint16_t readU16(const unsigned char* value) noexcept
{
    return static_cast<std::uint16_t>(value[0] | (static_cast<std::uint16_t>(value[1]) << 8));
}

std::uint32_t readU32(const unsigned char* value) noexcept
{
    return static_cast<std::uint32_t>(value[0])
        | (static_cast<std::uint32_t>(value[1]) << 8)
        | (static_cast<std::uint32_t>(value[2]) << 16)
        | (static_cast<std::uint32_t>(value[3]) << 24);
}

float decodePcm(const unsigned char* source, int bits) noexcept
{
    if (bits == 16)
    {
        const auto value = static_cast<std::int16_t>(readU16(source));
        return static_cast<float>(value) / 32768.0f;
    }
    if (bits == 24)
    {
        std::int32_t value = static_cast<std::int32_t>(source[0])
            | (static_cast<std::int32_t>(source[1]) << 8)
            | (static_cast<std::int32_t>(source[2]) << 16);
        if ((value & 0x00800000) != 0)
            value |= static_cast<std::int32_t>(0xff000000);
        return static_cast<float>(value) / 8388608.0f;
    }
    const auto value = static_cast<std::int32_t>(readU32(source));
    return static_cast<float>(static_cast<double>(value) / 2147483648.0);
}
} // namespace

float WavFile::sample(std::size_t frame, int channel) const noexcept
{
    if (channels <= 0 || frame >= frameCount())
        return 0.0f;
    const auto selected = std::clamp(channel, 0, channels - 1);
    return interleaved[frame * static_cast<std::size_t>(channels) + static_cast<std::size_t>(selected)];
}

bool WavFile::load(const std::filesystem::path& path, WavFile& destination, std::string& error)
{
    std::ifstream stream(path, std::ios::binary);
    if (!stream)
    {
        error = "cannot open WAV resource";
        return false;
    }

    stream.seekg(0, std::ios::end);
    const auto length = static_cast<std::streamoff>(stream.tellg());
    if (length <= 0 || static_cast<unsigned long long>(length) > 2ull * 1024ull * 1024ull * 1024ull)
    {
        error = "invalid WAV resource size";
        return false;
    }
    stream.seekg(0, std::ios::beg);
    std::vector<unsigned char> bytes(static_cast<std::size_t>(length));
    stream.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!stream)
    {
        error = "truncated WAV resource";
        return false;
    }
    return load(bytes.data(), bytes.size(), destination, error);
}

bool WavFile::load(const unsigned char* bytes, std::size_t byteCount, WavFile& destination, std::string& error)
{
    if (bytes == nullptr || byteCount < 12
        || std::memcmp(bytes, "RIFF", 4) != 0
        || std::memcmp(bytes + 8, "WAVE", 4) != 0)
    {
        error = "resource is not a RIFF/WAVE file";
        return false;
    }

    std::uint16_t format = 0;
    std::uint16_t channels = 0;
    std::uint32_t sampleRate = 0;
    std::uint16_t blockAlign = 0;
    std::uint16_t bitsPerSample = 0;
    const unsigned char* audioBytes = nullptr;
    std::size_t audioByteCount = 0;
    std::size_t cursor = 12;

    while (cursor + 8 <= byteCount && (format == 0 || audioBytes == nullptr))
    {
        const auto* chunkHeader = bytes + cursor;
        const auto chunkSize = static_cast<std::size_t>(readU32(chunkHeader + 4));
        cursor += 8;
        if (chunkSize > byteCount - cursor)
        {
            error = "truncated WAV chunk";
            return false;
        }
        const auto* chunkData = bytes + cursor;
        if (std::memcmp(chunkHeader, "fmt ", 4) == 0)
        {
            if (chunkSize < 16 || chunkSize > 4096)
            {
                error = "invalid WAV format chunk";
                return false;
            }
            format = readU16(chunkData);
            channels = readU16(chunkData + 2);
            sampleRate = readU32(chunkData + 4);
            blockAlign = readU16(chunkData + 12);
            bitsPerSample = readU16(chunkData + 14);
            // Modern DAWs commonly write PCM/float WAVs using
            // WAVE_FORMAT_EXTENSIBLE. Its SubFormat GUID carries the actual
            // PCM (1) or IEEE-float (3) tag while the sample container fields
            // above retain their normal meaning.
            if (format == 0xfffe && chunkSize >= 40 && readU16(chunkData + 16) >= 22)
            {
                static constexpr unsigned char kWaveSubtypeTail[14] = {
                    0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80,
                    0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
                };
                const auto subtype = readU16(chunkData + 24);
                if ((subtype == 1 || subtype == 3)
                    && std::memcmp(chunkData + 26, kWaveSubtypeTail, sizeof(kWaveSubtypeTail)) == 0)
                    format = subtype;
            }
        }
        else if (std::memcmp(chunkHeader, "data", 4) == 0)
        {
            if (chunkSize == 0 || chunkSize > (2u * 1024u * 1024u * 1024u - 1u))
            {
                error = "invalid WAV data size";
                return false;
            }
            audioBytes = chunkData;
            audioByteCount = chunkSize;
        }
        cursor += chunkSize;
        if ((chunkSize & 1u) != 0 && cursor < byteCount)
            ++cursor;
    }

    const auto supportedPcm = format == 1 && (bitsPerSample == 16 || bitsPerSample == 24 || bitsPerSample == 32);
    const auto supportedFloat = format == 3 && bitsPerSample == 32;
    const auto bytesPerSample = bitsPerSample / 8;
    if ((!supportedPcm && !supportedFloat) || channels < 1 || channels > 2 || sampleRate < 8000
        || blockAlign == 0 || blockAlign < channels * bytesPerSample || audioBytes == nullptr)
    {
        error = "WAV must be mono/stereo PCM16/24/32 or float32";
        return false;
    }
    if (audioByteCount % blockAlign != 0)
    {
        error = "WAV data is not frame aligned";
        return false;
    }

    const auto frames = audioByteCount / blockAlign;
    if (frames > std::numeric_limits<std::size_t>::max() / channels)
    {
        error = "WAV is too large";
        return false;
    }

    WavFile decoded;
    decoded.sampleRate = static_cast<int>(sampleRate);
    decoded.channels = static_cast<int>(channels);
    decoded.interleaved.resize(frames * channels);
    for (std::size_t frame = 0; frame < frames; ++frame)
    {
        const auto* frameData = audioBytes + frame * blockAlign;
        for (std::size_t channel = 0; channel < channels; ++channel)
        {
            const auto* source = frameData + channel * bytesPerSample;
            float value = 0.0f;
            if (supportedFloat)
                std::memcpy(&value, source, sizeof(float));
            else
                value = decodePcm(source, bitsPerSample);
            decoded.interleaved[frame * channels + channel] = std::clamp(value, -1.0f, 1.0f);
        }
    }
    destination = std::move(decoded);
    return true;
}
} // namespace tripleside::native
