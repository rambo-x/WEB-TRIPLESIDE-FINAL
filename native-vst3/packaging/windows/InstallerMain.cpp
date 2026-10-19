#include "InstallerSupport.h"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <exception>
#include <filesystem>
#include <system_error>

namespace fs = std::filesystem;
using namespace tripleside::installer;

namespace {

bool ensureDirectory(const fs::path& path, std::wstring& error) {
    std::error_code filesystemError;
    fs::create_directories(path, filesystemError);
    if (!filesystemError) return true;
    error = L"Unable to create directory " + path.native() + L".";
    return false;
}

bool rollbackMove(const fs::path& backup, const fs::path& destination) {
    if (!fs::exists(backup)) return true;
    std::wstring ignored;
    if (fs::exists(destination) && !removeTreeNoFollow(destination, ignored)) return false;
    return moveReplacing(backup, destination, ignored);
}

int install() {
    std::wstring error;
    const fs::path package = executablePath();
    PackageManifest manifest;
    if (!readPackageManifest(package, manifest, error)) {
        showError(error);
        return 10;
    }

    if (!isSilentCommandLine()) {
        const std::wstring prompt = L"Install " + manifest.productName + L" VST3 for all users?\n\nThe plugin will be installed in the system VST3 folder.";
        if (MessageBoxW(nullptr, prompt.c_str(), L"TripleSide Studio", MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND) != IDYES) return 2;
    }

    const fs::path vstRoot = commonVst3Root();
    const fs::path productUninstallRoot = uninstallRoot() / manifest.productName;
    const fs::path bundleTarget = vstRoot / manifest.bundleName;
    if (!isDirectChild(vstRoot, bundleTarget) || !isDirectChild(uninstallRoot(), productUninstallRoot)) {
        showError(L"The package resolved an unsafe installation target.");
        return 11;
    }
    if (!ensureDirectory(vstRoot, error) || !ensureDirectory(uninstallRoot(), error)) {
        showError(error);
        return 12;
    }

    const fs::path bundleStage = uniqueSibling(bundleTarget, L".installing-");
    const fs::path uninstallStage = uniqueSibling(productUninstallRoot, L".installing-");
    const fs::path bundleBackup = uniqueSibling(bundleTarget, L".previous-");
    const fs::path uninstallBackup = uniqueSibling(productUninstallRoot, L".previous-");
    removeTreeNoFollow(bundleStage, error);
    removeTreeNoFollow(uninstallStage, error);
    if (!ensureDirectory(bundleStage, error) || !ensureDirectory(uninstallStage, error)) {
        showError(error);
        return 13;
    }

    std::uint64_t installedBytes = 0;
    for (const PayloadItem& item : manifest.files) {
        const fs::path destination = bundleStage / fs::path(item.relativePath);
        if (!extractPayloadItem(package, item, destination, error)) {
            removeTreeNoFollow(bundleStage, error);
            removeTreeNoFollow(uninstallStage, error);
            showError(error);
            return 14;
        }
        installedBytes += item.size;
    }
    const fs::path stagedUninstaller = uninstallStage / L"uninstall.exe";
    if (!extractPayloadItem(package, manifest.uninstaller, stagedUninstaller, error) ||
        !writeUninstallMetadata(uninstallStage / L"uninstall.dat", {manifest.productName, manifest.bundleName, manifest.installerId}, error)) {
        removeTreeNoFollow(bundleStage, error);
        removeTreeNoFollow(uninstallStage, error);
        showError(error);
        return 15;
    }
    installedBytes += manifest.uninstaller.size;

    bool bundleBackedUp = false;
    bool uninstallBackedUp = false;
    if (fs::exists(bundleTarget)) {
        if (!moveReplacing(bundleTarget, bundleBackup, error)) {
            removeTreeNoFollow(bundleStage, error);
            removeTreeNoFollow(uninstallStage, error);
            showError(error);
            return 16;
        }
        bundleBackedUp = true;
    }
    if (!moveReplacing(bundleStage, bundleTarget, error)) {
        rollbackMove(bundleBackup, bundleTarget);
        removeTreeNoFollow(uninstallStage, error);
        showError(error);
        return 17;
    }
    if (fs::exists(productUninstallRoot)) {
        if (!moveReplacing(productUninstallRoot, uninstallBackup, error)) {
            removeTreeNoFollow(bundleTarget, error);
            rollbackMove(bundleBackup, bundleTarget);
            removeTreeNoFollow(uninstallStage, error);
            showError(error);
            return 18;
        }
        uninstallBackedUp = true;
    }
    if (!moveReplacing(uninstallStage, productUninstallRoot, error)) {
        removeTreeNoFollow(bundleTarget, error);
        rollbackMove(bundleBackup, bundleTarget);
        rollbackMove(uninstallBackup, productUninstallRoot);
        showError(error);
        return 19;
    }

    const fs::path installedUninstaller = productUninstallRoot / L"uninstall.exe";
    if (!registerUninstaller(manifest, bundleTarget, installedUninstaller, installedBytes, error)) {
        removeTreeNoFollow(bundleTarget, error);
        removeTreeNoFollow(productUninstallRoot, error);
        rollbackMove(bundleBackup, bundleTarget);
        rollbackMove(uninstallBackup, productUninstallRoot);
        showError(error);
        return 20;
    }

    if (bundleBackedUp) removeTreeNoFollow(bundleBackup, error);
    if (uninstallBackedUp) removeTreeNoFollow(uninstallBackup, error);
    appendLog(L"Installed bundle: " + bundleTarget.native());
    showInformation(manifest.productName + L" VST3 was installed successfully.");
    return 0;
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    try {
        return install();
    } catch (const std::exception&) {
        showError(L"The native installer encountered an unexpected error.");
        return 100;
    }
}
