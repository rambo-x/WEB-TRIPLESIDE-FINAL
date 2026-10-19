#pragma once

#include <string>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace tripleside::native {

class LicenseRuntime {
public:
    static void initialize();
    static bool isLicensed() noexcept;
    static std::wstring statusText();
#if defined(_WIN32) || defined(__APPLE__)
    static bool activateSerial(const std::wstring& serial);
#endif
#if defined(_WIN32)
    static bool activateFromClipboard(HWND owner);
#endif
};

} // namespace tripleside::native
