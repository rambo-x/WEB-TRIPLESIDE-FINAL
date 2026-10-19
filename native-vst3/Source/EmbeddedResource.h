#pragma once

#include <cstddef>

namespace tripleside::native
{
struct EmbeddedResource
{
    const unsigned char* data = nullptr;
    std::size_t size = 0;

    [[nodiscard]] bool empty() const noexcept { return data == nullptr || size == 0; }
};

[[nodiscard]] EmbeddedResource findEmbeddedResource(const wchar_t* name) noexcept;
} // namespace tripleside::native
