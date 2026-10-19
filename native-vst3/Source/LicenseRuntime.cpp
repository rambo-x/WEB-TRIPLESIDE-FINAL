#include "LicenseRuntime.h"
#include "NativeProject.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <bcrypt.h>
#include <dpapi.h>
#include <shlobj.h>
#include <winhttp.h>
#endif

namespace tripleside::native {
namespace {
std::atomic<bool> licensed{!project::kLicenseRequired};
std::atomic<bool> refreshStarted{false};
std::mutex stateMutex;
std::wstring status = project::kLicenseRequired ? L"Belum diaktifkan" : L"Lisensi tidak diperlukan";

#if defined(_WIN32)
std::string utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string result(static_cast<std::size_t>(std::max(0, size)), '\0');
    if (size > 0) WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

std::wstring wide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring result(static_cast<std::size_t>(std::max(0, size)), L'\0');
    if (size > 0) MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

std::string sha256(const std::string& value) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectBytes = 0, hashBytes = 0, copied = 0;
    std::vector<unsigned char> object, digest;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) return {};
    if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes), sizeof(objectBytes), &copied, 0) < 0
        || BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashBytes), sizeof(hashBytes), &copied, 0) < 0) {
        BCryptCloseAlgorithmProvider(algorithm, 0); return {};
    }
    object.resize(objectBytes); digest.resize(hashBytes);
    const bool ok = BCryptCreateHash(algorithm, &hash, object.data(), objectBytes, nullptr, 0, 0) >= 0
        && BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())), static_cast<ULONG>(value.size()), 0) >= 0
        && BCryptFinishHash(hash, digest.data(), hashBytes, 0) >= 0;
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    if (!ok) return {};
    static constexpr char hex[] = "0123456789abcdef";
    std::string result; result.reserve(digest.size() * 2);
    for (const auto byte : digest) { result.push_back(hex[byte >> 4]); result.push_back(hex[byte & 15]); }
    return result;
}

std::string hardwareId() {
    wchar_t machineGuid[256]{}; DWORD bytes = sizeof(machineGuid);
    if (RegGetValueW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", L"MachineGuid", RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY, nullptr, machineGuid, &bytes) != ERROR_SUCCESS) {
        DWORD count = 255; GetComputerNameW(machineGuid, &count);
    }
    return sha256(utf8(machineGuid) + "|TripleSideVstMaker");
}

std::wstring machineName() {
    wchar_t value[256]{}; DWORD count = 255;
    return GetComputerNameW(value, &count) ? std::wstring(value, count) : L"Windows PC";
}

std::filesystem::path cachePath() {
    wchar_t root[MAX_PATH]{};
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, root))) return {};
    auto directory = std::filesystem::path(root) / L"TripleSide Studio" / L"VST Licenses";
    std::error_code error; std::filesystem::create_directories(directory, error);
    return directory / wide(sha256(project::kLicenseProductId) + ".dat");
}

bool saveCache(const std::string& key, const std::string& hardware, std::int64_t verifiedAt) {
    const std::string plain = key + "\n" + hardware + "\n" + std::to_string(verifiedAt);
    DATA_BLOB input{static_cast<DWORD>(plain.size()), reinterpret_cast<BYTE*>(const_cast<char*>(plain.data()))}, output{};
    if (!CryptProtectData(&input, L"TripleSide VST License", nullptr, nullptr, nullptr, 0, &output)) return false;
    const auto path = cachePath(); std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    if (stream) stream.write(reinterpret_cast<const char*>(output.pbData), output.cbData);
    LocalFree(output.pbData); return stream.good();
}

bool loadCache(std::string& key, std::int64_t& verifiedAt) {
    const auto path = cachePath(); std::ifstream stream(path, std::ios::binary);
    if (!stream) return false;
    const std::vector<char> raw((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
    std::vector<BYTE> encrypted(raw.begin(), raw.end());
    if (encrypted.empty()) return false;
    DATA_BLOB input{static_cast<DWORD>(encrypted.size()), encrypted.data()}, output{};
    if (!CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, 0, &output)) return false;
    std::string plain(reinterpret_cast<char*>(output.pbData), output.cbData); LocalFree(output.pbData);
    std::istringstream lines(plain); std::string cachedHardware, timestamp;
    if (!std::getline(lines, key) || !std::getline(lines, cachedHardware) || !std::getline(lines, timestamp)) return false;
    try { verifiedAt = std::stoll(timestamp); } catch (...) { return false; }
    return !key.empty() && cachedHardware == hardwareId();
}

void deleteCache() {
    std::error_code error;
    std::filesystem::remove(cachePath(), error);
}

std::string jsonEscape(const std::string& value) {
    std::string result; result.reserve(value.size() + 8);
    for (const unsigned char character : value) {
        if (character == '"' || character == '\\') { result.push_back('\\'); result.push_back(static_cast<char>(character)); }
        else if (character >= 0x20) result.push_back(static_cast<char>(character));
    }
    return result;
}

bool postJson(const wchar_t* url, const std::string& body, std::string& response, DWORD& statusCode) {
    URL_COMPONENTS parts{sizeof(parts)}; parts.dwHostNameLength = static_cast<DWORD>(-1); parts.dwUrlPathLength = static_cast<DWORD>(-1); parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(url, 0, 0, &parts)) return false;
    const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    HINTERNET session = WinHttpOpen(L"TripleSideVstMaker/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, nullptr, nullptr, 0);
    if (!session) return false;
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 8000);
    HINTERNET connection = WinHttpConnect(session, host.c_str(), parts.nPort, 0);
    HINTERNET request = connection ? WinHttpOpenRequest(connection, L"POST", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0) : nullptr;
    bool ok = request && WinHttpSendRequest(request, L"Content-Type: application/json\r\n", static_cast<DWORD>(-1), const_cast<char*>(body.data()), static_cast<DWORD>(body.size()), static_cast<DWORD>(body.size()), 0)
        && WinHttpReceiveResponse(request, nullptr);
    if (ok) {
        DWORD size = sizeof(statusCode); WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, nullptr, &statusCode, &size, nullptr);
        for (;;) {
            DWORD available = 0; if (!WinHttpQueryDataAvailable(request, &available) || !available || response.size() + available > 1024 * 1024) break;
            const auto offset = response.size(); response.resize(offset + available); DWORD read = 0;
            if (!WinHttpReadData(request, response.data() + offset, available, &read)) { ok = false; break; }
            response.resize(offset + read); if (!read) break;
        }
    }
    if (request) WinHttpCloseHandle(request); if (connection) WinHttpCloseHandle(connection); WinHttpCloseHandle(session); return ok;
}

struct RefreshContext {
    HMODULE module{};
    std::string key;
    std::string hardware;
};

DWORD WINAPI refreshOnline(LPVOID raw) {
    std::unique_ptr<RefreshContext> context(static_cast<RefreshContext*>(raw));
    const auto machine = utf8(machineName());
    const std::string body = "{\"license_key\":\"" + jsonEscape(context->key)
        + "\",\"hardware_id\":\"" + context->hardware
        + "\",\"machine_name\":\"" + jsonEscape(machine)
        + "\",\"os_name\":\"Windows\",\"plugin_version\":\""
        + jsonEscape(TS_PLUGIN_VERSION) + "\",\"product_id\":\""
        + jsonEscape(project::kLicenseProductId) + "\"}";
    std::string response;
    DWORD responseCode = 0;
    const bool requested = postJson(wide(project::kLicenseVerifyUrl).c_str(), body, response, responseCode);
    if (requested && responseCode == 200) {
        if (response.find("\"valid\":true") != std::string::npos) {
            const auto now = std::chrono::duration_cast<std::chrono::seconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            saveCache(context->key, context->hardware, now);
        } else {
            deleteCache();
            licensed = false;
            std::lock_guard lock(stateMutex);
            status = response.find("\"reason\":\"revoked\"") != std::string::npos
                ? L"Lisensi telah dicabut" : L"Aktivasi perangkat telah di-reset";
        }
    }
    const auto module = context->module;
    context.reset();
    FreeLibraryAndExitThread(module, 0);
    return 0;
}

void startOnlineRefresh(const std::string& key, const std::string& hardware) {
    bool expected = false;
    if (!refreshStarted.compare_exchange_strong(expected, true)) return;
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
            reinterpret_cast<LPCWSTR>(&licensed), &module)) {
        refreshStarted = false;
        return;
    }
    auto* context = new RefreshContext{module, key, hardware};
    const auto thread = CreateThread(nullptr, 0, refreshOnline, context, 0, nullptr);
    if (!thread) {
        delete context;
        FreeLibrary(module);
        refreshStarted = false;
        return;
    }
    CloseHandle(thread);
}

std::wstring clipboardSerial(HWND owner) {
    if (!OpenClipboard(owner)) return {};
    const auto handle = GetClipboardData(CF_UNICODETEXT); const auto* text = handle ? static_cast<const wchar_t*>(GlobalLock(handle)) : nullptr;
    std::wstring result = text ? text : L""; if (text) GlobalUnlock(handle); CloseClipboard();
    result.erase(std::remove_if(result.begin(), result.end(), [](wchar_t character) { return std::iswspace(character); }), result.end());
    std::transform(result.begin(), result.end(), result.begin(), [](wchar_t character) { return static_cast<wchar_t>(std::towupper(character)); });
    return result;
}
#endif
} // namespace

void LicenseRuntime::initialize() {
    if (!project::kLicenseRequired) { licensed = true; return; }
#if defined(_WIN32)
    std::string key; std::int64_t verifiedAt = 0;
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
    const bool valid = loadCache(key, verifiedAt);
    licensed = valid;
    std::lock_guard lock(stateMutex); status = valid ? L"Lisensi aktif" : L"Aktivasi diperlukan";
    if (valid && (verifiedAt > now + 300 || now - verifiedAt >= 24 * 60 * 60)) {
        startOnlineRefresh(key, hardwareId());
    }
#else
    licensed = false;
#endif
}

bool LicenseRuntime::isLicensed() noexcept { return licensed.load(); }

std::wstring LicenseRuntime::statusText() { std::lock_guard lock(stateMutex); return status; }

#if defined(_WIN32)
bool LicenseRuntime::activateFromClipboard(HWND owner) {
    if (!project::kLicenseRequired) return true;
    const auto serialWide = clipboardSerial(owner);
    return activateSerial(serialWide);
}

bool LicenseRuntime::activateSerial(const std::wstring& serialWide) {
    if (!project::kLicenseRequired) return true;
    auto normalizedSerial=serialWide;while(!normalizedSerial.empty()&&std::iswspace(normalizedSerial.back()))normalizedSerial.pop_back();while(!normalizedSerial.empty()&&std::iswspace(normalizedSerial.front()))normalizedSerial.erase(normalizedSerial.begin());for(auto&character:normalizedSerial)character=static_cast<wchar_t>(std::towupper(character));
    if (normalizedSerial.empty()) { std::lock_guard lock(stateMutex); status = L"Masukkan serial lisensi terlebih dahulu"; return false; }
    const auto serial = utf8(normalizedSerial), hardware = hardwareId(), machine = utf8(machineName());
    const std::string body = "{\"license_key\":\"" + jsonEscape(serial) + "\",\"hardware_id\":\"" + hardware
        + "\",\"machine_name\":\"" + jsonEscape(machine) + "\",\"os_name\":\"Windows\",\"plugin_version\":\""
        + jsonEscape(TS_PLUGIN_VERSION) + "\",\"product_id\":\"" + jsonEscape(project::kLicenseProductId) + "\"}";
    std::string response; DWORD responseCode = 0;
    const bool requested = postJson(wide(project::kLicenseActivationUrl).c_str(), body, response, responseCode);
    const bool valid = requested && responseCode == 200 && response.find(project::kLicenseProductId) != std::string::npos && response.find("\"signature\"") != std::string::npos;
    if (valid) {
        const auto now = std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
        if (!saveCache(serial, hardware, now)) { std::lock_guard lock(stateMutex); status = L"Aktif, tetapi cache lisensi gagal disimpan"; return false; }
        licensed = true; std::lock_guard lock(stateMutex); status = L"Lisensi aktif"; return true;
    }
    std::lock_guard lock(stateMutex);
    status = responseCode == 409 ? L"Batas aktivasi perangkat telah tercapai" : responseCode == 403 ? L"Serial ditolak atau dicabut" : responseCode == 404 ? L"Serial tidak ditemukan" : L"Aktivasi gagal; periksa internet dan serial";
    return false;
}
#endif

} // namespace tripleside::native
