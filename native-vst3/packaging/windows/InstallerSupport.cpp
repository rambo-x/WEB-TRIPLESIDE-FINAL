#include "InstallerSupport.h"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <knownfolders.h>
#include <shellapi.h>
#include <shlobj.h>

#include <algorithm>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <fstream>
#include <limits>
#include <memory>
#include <span>
#include <stdexcept>
#include <string_view>
#include <system_error>

namespace fs = std::filesystem;

namespace tripleside::installer {
namespace {

constexpr std::array<char, 8> kManifestMagic{'T', 'S', 'V', 'S', 'T', '3', 'M', '1'};
constexpr std::array<char, 16> kFooterMagic{'T', 'S', 'V', 'S', 'T', '3', 'P', 'K', 'G', 'F', 'O', 'O', 'T', '1', '\0', '\0'};
constexpr std::array<char, 16> kPortableUninstallFooterMagic{'T', 'S', 'V', 'S', 'T', '3', 'U', 'N', 'I', 'N', 'S', 'T', '1', '\0', '\0', '\0'};
constexpr std::array<char, 8> kUninstallMagic{'T', 'S', 'V', 'S', 'T', '3', 'U', '1'};
constexpr std::uint32_t kFormatVersion = 1;
constexpr std::uint32_t kMaximumFiles = 4096;
constexpr std::uint32_t kMaximumStringBytes = 4096;
constexpr std::uint64_t kMaximumManifestBytes = 16ULL * 1024ULL * 1024ULL;
constexpr std::uint64_t kCopyBufferBytes = 1024ULL * 1024ULL;

#pragma pack(push, 1)
struct PackageFooter {
    char magic[16];
    std::uint32_t version;
    std::uint64_t manifestOffset;
    std::uint64_t manifestSize;
    std::uint8_t manifestSha256[kSha256Size];
};
#pragma pack(pop)

static_assert(sizeof(PackageFooter) == 68);

std::wstring win32Message(const DWORD code) {
    wchar_t* raw = nullptr;
    const DWORD length = FormatMessageW(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr,
        code,
        0,
        reinterpret_cast<wchar_t*>(&raw),
        0,
        nullptr);
    std::wstring message = length != 0 && raw != nullptr ? std::wstring(raw, length) : L"Windows error " + std::to_wstring(code);
    if (raw != nullptr) LocalFree(raw);
    while (!message.empty() && (message.back() == L'\r' || message.back() == L'\n')) message.pop_back();
    return message;
}

std::wstring quoteArgument(const std::wstring& value) {
    std::wstring quoted = L"\"";
    std::size_t slashes = 0;
    for (const wchar_t character : value) {
        if (character == L'\\') {
            ++slashes;
            continue;
        }
        if (character == L'\"') {
            quoted.append(slashes * 2 + 1, L'\\');
            quoted.push_back(L'\"');
            slashes = 0;
            continue;
        }
        quoted.append(slashes, L'\\');
        slashes = 0;
        quoted.push_back(character);
    }
    quoted.append(slashes * 2, L'\\');
    quoted.push_back(L'\"');
    return quoted;
}

fs::path knownFolder(const KNOWNFOLDERID& identifier) {
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(identifier, KF_FLAG_DEFAULT, nullptr, &raw);
    if (FAILED(result) || raw == nullptr) throw std::runtime_error("Known Windows folder is unavailable");
    fs::path value(raw);
    CoTaskMemFree(raw);
    return value;
}

std::wstring normalizedPath(const fs::path& path) {
    std::wstring value = path.lexically_normal().native();
    while (value.size() > 3 && (value.back() == L'\\' || value.back() == L'/')) value.pop_back();
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
    return value;
}

bool readExact(HANDLE file, const std::uint64_t offset, void* destination, const std::size_t bytes, std::wstring& error) {
    if (bytes > std::numeric_limits<DWORD>::max()) {
        error = L"Read request exceeds the supported Windows size.";
        return false;
    }
    LARGE_INTEGER position{};
    position.QuadPart = static_cast<LONGLONG>(offset);
    if (!SetFilePointerEx(file, position, nullptr, FILE_BEGIN)) {
        error = L"Unable to seek in the installer package: " + win32Message(GetLastError());
        return false;
    }
    DWORD read = 0;
    if (!ReadFile(file, destination, static_cast<DWORD>(bytes), &read, nullptr) || read != bytes) {
        error = L"Unable to read the complete installer package: " + win32Message(GetLastError());
        return false;
    }
    return true;
}

class Sha256 {
public:
    Sha256() {
        if (BCryptOpenAlgorithmProvider(&algorithm_, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) return;
        DWORD objectBytes = 0;
        DWORD resultBytes = 0;
        if (BCryptGetProperty(
                algorithm_,
                BCRYPT_OBJECT_LENGTH,
                reinterpret_cast<PUCHAR>(&objectBytes),
                sizeof(objectBytes),
                &resultBytes,
                0) < 0) return;
        object_.resize(objectBytes);
        if (BCryptCreateHash(algorithm_, &hash_, object_.data(), objectBytes, nullptr, 0, 0) < 0) hash_ = nullptr;
    }
    ~Sha256() {
        if (hash_ != nullptr) BCryptDestroyHash(hash_);
        if (algorithm_ != nullptr) BCryptCloseAlgorithmProvider(algorithm_, 0);
    }
    Sha256(const Sha256&) = delete;
    Sha256& operator=(const Sha256&) = delete;
    bool valid() const { return algorithm_ != nullptr && hash_ != nullptr; }
    bool update(const void* data, const std::size_t size) {
        if (!valid() || size > std::numeric_limits<ULONG>::max()) return false;
        return BCryptHashData(hash_, static_cast<PUCHAR>(const_cast<void*>(data)), static_cast<ULONG>(size), 0) >= 0;
    }
    bool finish(std::array<std::uint8_t, kSha256Size>& output) {
        return valid() && BCryptFinishHash(hash_, output.data(), static_cast<ULONG>(output.size()), 0) >= 0;
    }
private:
    BCRYPT_ALG_HANDLE algorithm_{};
    BCRYPT_HASH_HANDLE hash_{};
    std::vector<std::uint8_t> object_;
};

bool hashBytes(std::span<const std::uint8_t> bytes, std::array<std::uint8_t, kSha256Size>& digest) {
    Sha256 hash;
    return hash.update(bytes.data(), bytes.size()) && hash.finish(digest);
}

class ManifestReader {
public:
    explicit ManifestReader(const std::vector<std::uint8_t>& bytes) : bytes_(bytes) {}

    template <typename Value>
    bool read(Value& value) {
        if (sizeof(Value) > bytes_.size() - position_) return false;
        std::memcpy(&value, bytes_.data() + position_, sizeof(Value));
        position_ += sizeof(Value);
        return true;
    }

    bool readBytes(void* destination, const std::size_t size) {
        if (size > bytes_.size() - position_) return false;
        std::memcpy(destination, bytes_.data() + position_, size);
        position_ += size;
        return true;
    }

    bool readString(std::wstring& value) {
        std::uint32_t size = 0;
        if (!read(size) || size == 0 || size > kMaximumStringBytes || size > bytes_.size() - position_) return false;
        const char* source = reinterpret_cast<const char*>(bytes_.data() + position_);
        if (std::find(source, source + size, '\0') != source + size) return false;
        const int wideSize = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, source, static_cast<int>(size), nullptr, 0);
        if (wideSize <= 0) return false;
        value.resize(static_cast<std::size_t>(wideSize));
        if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, source, static_cast<int>(size), value.data(), wideSize) != wideSize) return false;
        position_ += size;
        return true;
    }

    bool finished() const { return position_ == bytes_.size(); }

private:
    const std::vector<std::uint8_t>& bytes_;
    std::size_t position_{};
};

void appendUint32(std::vector<std::uint8_t>& data, const std::uint32_t value) {
    const auto* bytes = reinterpret_cast<const std::uint8_t*>(&value);
    data.insert(data.end(), bytes, bytes + sizeof(value));
}

bool appendUtf8(std::vector<std::uint8_t>& data, const std::wstring& value) {
    if (value.empty()) return false;
    const int required = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (required <= 0 || required > static_cast<int>(kMaximumStringBytes)) return false;
    const std::size_t offset = data.size();
    appendUint32(data, static_cast<std::uint32_t>(required));
    data.resize(data.size() + static_cast<std::size_t>(required));
    return WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), reinterpret_cast<char*>(data.data() + offset + sizeof(std::uint32_t)), required, nullptr, nullptr) == required;
}

std::wstring registryPath(const std::wstring& installerId) {
    return L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\" + installerId;
}

bool setRegistryString(HKEY key, const wchar_t* name, const std::wstring& value, std::wstring& error) {
    const DWORD bytes = static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t));
    const LONG result = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()), bytes);
    if (result == ERROR_SUCCESS) return true;
    error = L"Unable to write the Windows uninstall registry entry: " + win32Message(static_cast<DWORD>(result));
    return false;
}

bool setRegistryDword(HKEY key, const wchar_t* name, const DWORD value, std::wstring& error) {
    const LONG result = RegSetValueExW(key, name, 0, REG_DWORD, reinterpret_cast<const BYTE*>(&value), sizeof(value));
    if (result == ERROR_SUCCESS) return true;
    error = L"Unable to write the Windows uninstall registry entry: " + win32Message(static_cast<DWORD>(result));
    return false;
}

} // namespace

bool isSilentCommandLine() {
    int count = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    if (arguments == nullptr) return false;
    bool silent = false;
    for (int index = 1; index < count; ++index) {
        std::wstring value(arguments[index]);
        std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
        if (value == L"/s" || value == L"/silent" || value == L"/verysilent" || value == L"--silent") silent = true;
    }
    LocalFree(arguments);
    return silent;
}

void showError(const std::wstring& message) {
    appendLog(L"ERROR: " + message);
    if (!isSilentCommandLine()) MessageBoxW(nullptr, message.c_str(), L"TripleSide Studio", MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
}

void showInformation(const std::wstring& message) {
    appendLog(message);
    if (!isSilentCommandLine()) MessageBoxW(nullptr, message.c_str(), L"TripleSide Studio", MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND);
}

void appendLog(const std::wstring& message) {
    int count = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    std::wstring logPath;
    if (arguments != nullptr) {
        for (int index = 1; index < count; ++index) {
            std::wstring value(arguments[index]);
            if (value.size() > 5 && (_wcsnicmp(value.c_str(), L"/LOG=", 5) == 0 || _wcsnicmp(value.c_str(), L"--log=", 6) == 0)) {
                logPath = value.substr(value[1] == L'-' ? 6 : 5);
                break;
            }
        }
        LocalFree(arguments);
    }
    if (logPath.empty()) return;
    std::wofstream stream(fs::path(logPath), std::ios::app);
    if (stream) stream << message << L'\n';
}

fs::path executablePath() {
    std::wstring buffer(32768, L'\0');
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0 || length >= buffer.size()) throw std::runtime_error("Unable to resolve executable path");
    buffer.resize(length);
    return fs::path(buffer);
}

fs::path commonVst3Root() { return knownFolder(FOLDERID_ProgramFilesCommon) / L"VST3"; }
fs::path uninstallRoot() { return knownFolder(FOLDERID_ProgramData) / L"TripleSide Studio" / L"Uninstall"; }

bool isSafeSegment(const std::wstring& value) {
    if (value.empty() || value == L"." || value == L".." || value.back() == L' ' || value.back() == L'.') return false;
    constexpr wchar_t forbidden[] = L"<>:\"/\\|?*";
    return std::none_of(value.begin(), value.end(), [&](const wchar_t character) {
        return character < 32 || std::wcschr(forbidden, character) != nullptr;
    });
}

bool isSafeInstallerId(const std::wstring& value) {
    constexpr std::wstring_view prefix = L"com.triplesidestudio.vst3.";
    if (!value.starts_with(prefix) || value.size() <= prefix.size()) return false;
    return std::all_of(value.begin(), value.end(), [](const wchar_t character) {
        return std::iswalnum(character) != 0 || character == L'.' || character == L'_' || character == L'-';
    });
}

bool isSafeRelativePath(const std::wstring& value) {
    if (value.empty() || value.front() == L'/' || value.front() == L'\\' || value.find(L':') != std::wstring::npos) return false;
    fs::path path(value);
    if (path.is_absolute() || path.has_root_path()) return false;
    for (const auto& part : path) {
        const std::wstring segment = part.native();
        if (!isSafeSegment(segment)) return false;
    }
    return true;
}

bool pathEquals(const fs::path& left, const fs::path& right) { return normalizedPath(left) == normalizedPath(right); }

bool isDirectChild(const fs::path& parent, const fs::path& child) {
    return pathEquals(child.parent_path(), parent) && isSafeSegment(child.filename().native());
}

bool removeTreeNoFollow(const fs::path& path, std::wstring& error) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) {
        if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND) return true;
        error = L"Unable to inspect path before removal: " + win32Message(GetLastError());
        return false;
    }
    if ((attributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
        if ((attributes & FILE_ATTRIBUTE_READONLY) != 0) SetFileAttributesW(path.c_str(), attributes & ~FILE_ATTRIBUTE_READONLY);
        if (DeleteFileW(path.c_str())) return true;
        error = L"Unable to remove file " + path.native() + L": " + win32Message(GetLastError());
        return false;
    }
    if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
        if (RemoveDirectoryW(path.c_str())) return true;
        error = L"Unable to remove reparse-point directory " + path.native() + L": " + win32Message(GetLastError());
        return false;
    }
    WIN32_FIND_DATAW entry{};
    const fs::path pattern = path / L"*";
    HANDLE search = FindFirstFileW(pattern.c_str(), &entry);
    if (search != INVALID_HANDLE_VALUE) {
        do {
            if (std::wcscmp(entry.cFileName, L".") == 0 || std::wcscmp(entry.cFileName, L"..") == 0) continue;
            if (!removeTreeNoFollow(path / entry.cFileName, error)) {
                FindClose(search);
                return false;
            }
        } while (FindNextFileW(search, &entry));
        const DWORD findError = GetLastError();
        FindClose(search);
        if (findError != ERROR_NO_MORE_FILES) {
            error = L"Unable to enumerate directory " + path.native() + L": " + win32Message(findError);
            return false;
        }
    } else if (GetLastError() != ERROR_FILE_NOT_FOUND) {
        error = L"Unable to enumerate directory " + path.native() + L": " + win32Message(GetLastError());
        return false;
    }
    if (RemoveDirectoryW(path.c_str())) return true;
    error = L"Unable to remove directory " + path.native() + L": " + win32Message(GetLastError());
    return false;
}

bool readPackageManifest(const fs::path& package, PackageManifest& manifest, std::wstring& error) {
    HANDLE file = CreateFileW(package.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        error = L"Unable to open installer package: " + win32Message(GetLastError());
        return false;
    }
    LARGE_INTEGER fileSize{};
    if (!GetFileSizeEx(file, &fileSize) || fileSize.QuadPart < static_cast<LONGLONG>(sizeof(PackageFooter))) {
        error = L"Installer package is truncated.";
        CloseHandle(file);
        return false;
    }
    PackageFooter footer{};
    const std::uint64_t totalBytes = static_cast<std::uint64_t>(fileSize.QuadPart);
    if (!readExact(file, totalBytes - sizeof(footer), &footer, sizeof(footer), error)) {
        CloseHandle(file);
        return false;
    }
    if (!std::equal(kFooterMagic.begin(), kFooterMagic.end(), footer.magic) || footer.version != kFormatVersion ||
        footer.manifestSize == 0 || footer.manifestSize > kMaximumManifestBytes ||
        footer.manifestOffset > totalBytes - sizeof(footer) ||
        footer.manifestSize != totalBytes - sizeof(footer) - footer.manifestOffset) {
        error = L"Installer package footer or manifest bounds are invalid.";
        CloseHandle(file);
        return false;
    }
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(footer.manifestSize));
    if (!readExact(file, footer.manifestOffset, bytes.data(), bytes.size(), error)) {
        CloseHandle(file);
        return false;
    }
    CloseHandle(file);
    std::array<std::uint8_t, kSha256Size> digest{};
    if (!hashBytes(bytes, digest) || !std::equal(digest.begin(), digest.end(), footer.manifestSha256)) {
        error = L"Installer package manifest checksum is invalid.";
        return false;
    }
    ManifestReader reader(bytes);
    std::array<char, 8> magic{};
    std::uint32_t version = 0;
    if (!reader.readBytes(magic.data(), magic.size()) || magic != kManifestMagic || !reader.read(version) || version != kFormatVersion ||
        !reader.readString(manifest.productName) || !reader.readString(manifest.bundleName) ||
        !reader.readString(manifest.productVersion) || !reader.readString(manifest.publisher) || !reader.readString(manifest.installerId) ||
        !reader.read(manifest.uninstaller.offset) || !reader.read(manifest.uninstaller.size) ||
        !reader.readBytes(manifest.uninstaller.sha256.data(), manifest.uninstaller.sha256.size())) {
        error = L"Installer package manifest header is invalid.";
        return false;
    }
    std::uint32_t fileCount = 0;
    if (!reader.read(fileCount) || fileCount == 0 || fileCount > kMaximumFiles) {
        error = L"Installer package contains an invalid file count.";
        return false;
    }
    manifest.files.clear();
    manifest.files.reserve(fileCount);
    std::uint64_t previousEnd = 0;
    auto validateItem = [&](const PayloadItem& item) {
        if (item.size == 0 || item.offset > footer.manifestOffset || item.size > footer.manifestOffset - item.offset) return false;
        if (previousEnd != 0 && item.offset < previousEnd) return false;
        previousEnd = item.offset + item.size;
        return true;
    };
    if (!validateItem(manifest.uninstaller)) {
        error = L"Installer package contains invalid uninstaller bounds.";
        return false;
    }
    std::vector<std::wstring> foldedPaths;
    for (std::uint32_t index = 0; index < fileCount; ++index) {
        PayloadItem item;
        if (!reader.readString(item.relativePath) || !reader.read(item.offset) || !reader.read(item.size) ||
            !reader.readBytes(item.sha256.data(), item.sha256.size()) || !isSafeRelativePath(item.relativePath) || !validateItem(item)) {
            error = L"Installer package contains an invalid payload entry.";
            return false;
        }
        std::wstring folded = item.relativePath;
        std::transform(folded.begin(), folded.end(), folded.begin(), [](wchar_t character) { return static_cast<wchar_t>(std::towlower(character)); });
        if (std::find(foldedPaths.begin(), foldedPaths.end(), folded) != foldedPaths.end()) {
            error = L"Installer package contains duplicate case-insensitive paths.";
            return false;
        }
        foldedPaths.push_back(std::move(folded));
        manifest.files.push_back(std::move(item));
    }
    manifest.manifestOffset = footer.manifestOffset;
    if (!reader.finished() || !isSafeSegment(manifest.productName) || !isSafeSegment(manifest.bundleName) ||
        !manifest.bundleName.ends_with(L".vst3") || !isSafeInstallerId(manifest.installerId)) {
        error = L"Installer package product metadata is unsafe or malformed.";
        return false;
    }
    return true;
}

bool extractPayloadItem(const fs::path& package, const PayloadItem& item, const fs::path& destination, std::wstring& error) {
    std::error_code filesystemError;
    fs::create_directories(destination.parent_path(), filesystemError);
    if (filesystemError) {
        error = L"Unable to create installer staging directory: " + destination.parent_path().native();
        return false;
    }
    HANDLE input = CreateFileW(package.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (input == INVALID_HANDLE_VALUE) {
        error = L"Unable to reopen installer package: " + win32Message(GetLastError());
        return false;
    }
    HANDLE output = CreateFileW(destination.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (output == INVALID_HANDLE_VALUE) {
        error = L"Unable to create staged file " + destination.native() + L": " + win32Message(GetLastError());
        CloseHandle(input);
        return false;
    }
    LARGE_INTEGER position{};
    position.QuadPart = static_cast<LONGLONG>(item.offset);
    bool success = SetFilePointerEx(input, position, nullptr, FILE_BEGIN) != FALSE;
    Sha256 hash;
    std::vector<std::uint8_t> buffer(static_cast<std::size_t>(kCopyBufferBytes));
    std::uint64_t remaining = item.size;
    while (success && remaining != 0) {
        const DWORD requested = static_cast<DWORD>(std::min<std::uint64_t>(remaining, buffer.size()));
        DWORD read = 0;
        DWORD written = 0;
        success = ReadFile(input, buffer.data(), requested, &read, nullptr) != FALSE && read == requested;
        if (success) success = hash.update(buffer.data(), read);
        if (success) success = WriteFile(output, buffer.data(), read, &written, nullptr) != FALSE && written == read;
        remaining -= success ? read : 0;
    }
    if (success) success = FlushFileBuffers(output) != FALSE;
    CloseHandle(output);
    CloseHandle(input);
    std::array<std::uint8_t, kSha256Size> digest{};
    if (success) success = hash.finish(digest) && digest == item.sha256;
    if (!success) {
        DeleteFileW(destination.c_str());
        error = L"Payload extraction or SHA-256 verification failed for " + destination.native() + L".";
    }
    return success;
}

bool writeUninstallMetadata(const fs::path& path, const UninstallMetadata& metadata, std::wstring& error) {
    std::vector<std::uint8_t> bytes(kUninstallMagic.begin(), kUninstallMagic.end());
    appendUint32(bytes, kFormatVersion);
    if (!appendUtf8(bytes, metadata.productName) || !appendUtf8(bytes, metadata.bundleName) || !appendUtf8(bytes, metadata.installerId)) {
        error = L"Unable to encode uninstall metadata.";
        return false;
    }
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        error = L"Unable to create uninstall metadata.";
        return false;
    }
    output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    output.flush();
    if (!output) {
        error = L"Unable to persist uninstall metadata.";
        return false;
    }
    return true;
}

bool decodeUninstallMetadata(const std::vector<std::uint8_t>& bytes, UninstallMetadata& metadata, std::wstring& error) {
    ManifestReader reader(bytes);
    std::array<char, 8> magic{};
    std::uint32_t version = 0;
    if (!reader.readBytes(magic.data(), magic.size()) || magic != kUninstallMagic || !reader.read(version) || version != kFormatVersion ||
        !reader.readString(metadata.productName) || !reader.readString(metadata.bundleName) || !reader.readString(metadata.installerId) ||
        !reader.finished() || !isSafeSegment(metadata.productName) || !isSafeSegment(metadata.bundleName) ||
        !metadata.bundleName.ends_with(L".vst3") || !isSafeInstallerId(metadata.installerId)) {
        error = L"Uninstall metadata is malformed.";
        return false;
    }
    return true;
}

bool readUninstallMetadata(const fs::path& path, UninstallMetadata& metadata, std::wstring& error) {
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    if (!input) {
        error = L"Uninstall metadata is missing.";
        return false;
    }
    const std::streamoff size = input.tellg();
    if (size <= 0 || size > static_cast<std::streamoff>(64 * 1024)) {
        error = L"Uninstall metadata size is invalid.";
        return false;
    }
    input.seekg(0);
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    input.read(reinterpret_cast<char*>(bytes.data()), size);
    return input && decodeUninstallMetadata(bytes, metadata, error);
}

bool readPortableUninstallMetadata(const fs::path& path, UninstallMetadata& metadata, std::wstring& error) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        error = L"Unable to open portable uninstaller: " + win32Message(GetLastError());
        return false;
    }
    LARGE_INTEGER fileSize{};
    bool success = GetFileSizeEx(file, &fileSize) != FALSE && fileSize.QuadPart >= static_cast<LONGLONG>(sizeof(PackageFooter));
    PackageFooter footer{};
    if (success) success = readExact(file, static_cast<std::uint64_t>(fileSize.QuadPart) - sizeof(PackageFooter), &footer, sizeof(footer), error);
    if (success && (std::memcmp(footer.magic, kPortableUninstallFooterMagic.data(), kPortableUninstallFooterMagic.size()) != 0 ||
                    footer.version != kFormatVersion || footer.manifestSize > 64 * 1024 ||
                    footer.manifestOffset + footer.manifestSize != static_cast<std::uint64_t>(fileSize.QuadPart) - sizeof(PackageFooter))) {
        error = L"Portable uninstaller metadata bounds are invalid.";
        success = false;
    }
    std::vector<std::uint8_t> bytes;
    if (success) {
        bytes.resize(static_cast<std::size_t>(footer.manifestSize));
        success = readExact(file, footer.manifestOffset, bytes.data(), bytes.size(), error);
    }
    CloseHandle(file);
    std::array<std::uint8_t, kSha256Size> digest{};
    if (success) success = hashBytes(bytes, digest) && std::memcmp(digest.data(), footer.manifestSha256, digest.size()) == 0;
    if (!success) {
        if (error.empty()) error = L"Portable uninstaller metadata checksum is invalid.";
        return false;
    }
    return decodeUninstallMetadata(bytes, metadata, error);
}

bool registerUninstaller(
    const PackageManifest& manifest,
    const fs::path& bundlePath,
    const fs::path& uninstallerPath,
    const std::uint64_t installedBytes,
    std::wstring& error) {
    HKEY key = nullptr;
    const LONG createResult = RegCreateKeyExW(
        HKEY_LOCAL_MACHINE,
        registryPath(manifest.installerId).c_str(),
        0,
        nullptr,
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE | KEY_WOW64_64KEY,
        nullptr,
        &key,
        nullptr);
    if (createResult != ERROR_SUCCESS) {
        error = L"Unable to create the Windows uninstall registry entry: " + win32Message(static_cast<DWORD>(createResult));
        return false;
    }
    const std::wstring quotedUninstaller = quoteArgument(uninstallerPath.native());
    bool success = setRegistryString(key, L"DisplayName", manifest.productName + L" VST3", error) &&
        setRegistryString(key, L"DisplayVersion", manifest.productVersion, error) &&
        setRegistryString(key, L"Publisher", manifest.publisher, error) &&
        setRegistryString(key, L"InstallLocation", bundlePath.native(), error) &&
        setRegistryString(key, L"DisplayIcon", quotedUninstaller, error) &&
        setRegistryString(key, L"UninstallString", quotedUninstaller, error) &&
        setRegistryString(key, L"QuietUninstallString", quotedUninstaller + L" --silent", error) &&
        setRegistryDword(key, L"NoModify", 1, error) && setRegistryDword(key, L"NoRepair", 1, error) &&
        setRegistryDword(key, L"EstimatedSize", static_cast<DWORD>(std::min<std::uint64_t>((installedBytes + 1023) / 1024, MAXDWORD)), error);
    RegCloseKey(key);
    if (!success) RegDeleteTreeW(HKEY_LOCAL_MACHINE, registryPath(manifest.installerId).c_str());
    return success;
}

bool unregisterProduct(const std::wstring& installerId, std::wstring& error) {
    const LONG result = RegDeleteTreeW(HKEY_LOCAL_MACHINE, registryPath(installerId).c_str());
    if (result == ERROR_SUCCESS || result == ERROR_FILE_NOT_FOUND) return true;
    error = L"Unable to remove the Windows uninstall registry entry: " + win32Message(static_cast<DWORD>(result));
    return false;
}

fs::path uniqueSibling(const fs::path& target, const wchar_t* suffix) {
    return target.parent_path() / (target.filename().native() + suffix + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()));
}

bool moveReplacing(const fs::path& source, const fs::path& destination, std::wstring& error) {
    if (MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return true;
    error = L"Unable to replace " + destination.native() + L": " + win32Message(GetLastError());
    return false;
}

} // namespace tripleside::installer
