#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace tripleside::installer {

constexpr std::size_t kSha256Size = 32;

struct PayloadItem {
    std::wstring relativePath;
    std::uint64_t offset{};
    std::uint64_t size{};
    std::array<std::uint8_t, kSha256Size> sha256{};
};

struct PackageManifest {
    std::wstring productName;
    std::wstring bundleName;
    std::wstring productVersion;
    std::wstring publisher;
    std::wstring installerId;
    PayloadItem uninstaller;
    std::vector<PayloadItem> files;
    std::uint64_t manifestOffset{};
};

struct UninstallMetadata {
    std::wstring productName;
    std::wstring bundleName;
    std::wstring installerId;
};

bool isSilentCommandLine();
void showError(const std::wstring& message);
void showInformation(const std::wstring& message);
void appendLog(const std::wstring& message);
std::filesystem::path executablePath();
std::filesystem::path commonVst3Root();
std::filesystem::path uninstallRoot();
bool isSafeSegment(const std::wstring& value);
bool isSafeInstallerId(const std::wstring& value);
bool isSafeRelativePath(const std::wstring& value);
bool pathEquals(const std::filesystem::path& left, const std::filesystem::path& right);
bool isDirectChild(const std::filesystem::path& parent, const std::filesystem::path& child);
bool removeTreeNoFollow(const std::filesystem::path& path, std::wstring& error);
bool readPackageManifest(const std::filesystem::path& package, PackageManifest& manifest, std::wstring& error);
bool extractPayloadItem(
    const std::filesystem::path& package,
    const PayloadItem& item,
    const std::filesystem::path& destination,
    std::wstring& error);
bool writeUninstallMetadata(const std::filesystem::path& path, const UninstallMetadata& metadata, std::wstring& error);
bool readUninstallMetadata(const std::filesystem::path& path, UninstallMetadata& metadata, std::wstring& error);
bool registerUninstaller(
    const PackageManifest& manifest,
    const std::filesystem::path& bundlePath,
    const std::filesystem::path& uninstallerPath,
    std::uint64_t installedBytes,
    std::wstring& error);
bool unregisterProduct(const std::wstring& installerId, std::wstring& error);
std::filesystem::path uniqueSibling(const std::filesystem::path& target, const wchar_t* suffix);
bool moveReplacing(const std::filesystem::path& source, const std::filesystem::path& destination, std::wstring& error);

} // namespace tripleside::installer
