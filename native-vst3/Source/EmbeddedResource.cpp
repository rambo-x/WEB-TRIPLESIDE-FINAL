#include "EmbeddedResource.h"

#if defined(_WIN32)
#include <windows.h>
#include <array>
#include <cwchar>
#endif

namespace tripleside::native
{
EmbeddedResource findEmbeddedResource(const wchar_t* name) noexcept
{
#if defined(_WIN32)
    if (name == nullptr || *name == L'\0')
        return {};

    HMODULE module = nullptr;
    const auto address = reinterpret_cast<LPCWSTR>(&findEmbeddedResource);
    if (!GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            address,
            &module))
        return {};

    auto resource = FindResourceW(module, name, MAKEINTRESOURCEW(10));
    // RC stores quoted string identifiers with the quote characters included
    // in the resource name (for example: "\"sample_000.wav\""). Keep the
    // direct lookup for compatibility, then use the representation emitted by
    // NativeAssets.rc. Avoid allocation because this function is noexcept.
    if (resource == nullptr)
    {
        constexpr std::size_t maxResourceName = 511;
        const auto length = std::wcslen(name);
        if (length <= maxResourceName - 2)
        {
            std::array<wchar_t, maxResourceName + 1> quotedName{};
            quotedName[0] = L'"';
            std::wmemcpy(quotedName.data() + 1, name, length);
            quotedName[length + 1] = L'"';
            resource = FindResourceW(module, quotedName.data(), MAKEINTRESOURCEW(10));
        }
    }
    if (resource == nullptr)
        return {};
    const auto size = SizeofResource(module, resource);
    const auto loaded = LoadResource(module, resource);
    const auto* data = static_cast<const unsigned char*>(LockResource(loaded));
    if (data == nullptr || size == 0)
        return {};
    return {data, static_cast<std::size_t>(size)};
#else
    (void) name;
    return {};
#endif
}
} // namespace tripleside::native
