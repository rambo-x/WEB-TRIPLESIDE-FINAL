#include "InstallerSupport.h"

#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

#include <cwchar>
#include <exception>
#include <filesystem>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using namespace tripleside::installer;

namespace {

std::vector<std::wstring> commandLineArguments() {
    int count = 0;
    LPWSTR* raw = CommandLineToArgvW(GetCommandLineW(), &count);
    std::vector<std::wstring> values;
    if (raw != nullptr) {
        values.assign(raw, raw + count);
        LocalFree(raw);
    }
    return values;
}

std::wstring quoteArgument(const std::wstring& value) {
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (const wchar_t character : value) {
        if (character == L'\\') {
            ++slashes;
        } else if (character == L'\"') {
            result.append(slashes * 2 + 1, L'\\');
            result.push_back(L'\"');
            slashes = 0;
        } else {
            result.append(slashes, L'\\');
            slashes = 0;
            result.push_back(character);
        }
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'\"');
    return result;
}

int cleanupAfterParent(const std::vector<std::wstring>& arguments) {
    if (arguments.size() != 4) return 30;
    wchar_t* end = nullptr;
    const unsigned long parentId = std::wcstoul(arguments[2].c_str(), &end, 10);
    if (parentId == 0 || end == nullptr || *end != L'\0') return 31;
    const fs::path directory(arguments[3]);
    if (!isDirectChild(uninstallRoot(), directory)) return 32;
    HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(parentId));
    if (parent != nullptr) {
        WaitForSingleObject(parent, 30000);
        CloseHandle(parent);
    }
    std::wstring error;
    const bool removed = removeTreeNoFollow(directory, error);
    MoveFileExW(executablePath().c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
    return removed ? 0 : 33;
}

bool launchCleanupCopy(const fs::path& uninstallDirectory, std::wstring& error) {
    wchar_t temporaryRoot[MAX_PATH + 1]{};
    if (GetTempPathW(MAX_PATH, temporaryRoot) == 0) {
        error = L"Unable to locate the Windows temporary directory.";
        return false;
    }
    wchar_t temporaryName[MAX_PATH + 1]{};
    if (GetTempFileNameW(temporaryRoot, L"TSU", 0, temporaryName) == 0) {
        error = L"Unable to reserve a temporary uninstaller path.";
        return false;
    }
    DeleteFileW(temporaryName);
    const fs::path helper = fs::path(temporaryName).replace_extension(L".exe");
    if (!CopyFileW(executablePath().c_str(), helper.c_str(), FALSE)) {
        error = L"Unable to create the native uninstall cleanup helper.";
        return false;
    }
    std::wstring command = quoteArgument(helper.native()) + L" --cleanup " + std::to_wstring(GetCurrentProcessId()) + L" " + quoteArgument(uninstallDirectory.native());
    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(helper.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
        DeleteFileW(helper.c_str());
        error = L"Unable to launch the native uninstall cleanup helper.";
        return false;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return true;
}

int uninstall() {
    const fs::path currentExecutable = executablePath();
    std::wstring error;
    UninstallMetadata metadata;
    const fs::path currentDirectory = currentExecutable.parent_path();
    const bool installedCopy = isDirectChild(uninstallRoot(), currentDirectory) && pathEquals(currentExecutable, currentDirectory / L"uninstall.exe");
    if (!(installedCopy ? readUninstallMetadata(currentDirectory / L"uninstall.dat", metadata, error)
                        : readPortableUninstallMetadata(currentExecutable, metadata, error))) {
        showError(error);
        return 21;
    }
    const fs::path uninstallDirectory = uninstallRoot() / metadata.productName;
    if (installedCopy && !pathEquals(currentDirectory, uninstallDirectory)) {
        showError(L"The uninstall metadata does not match this product directory.");
        return 22;
    }
    const fs::path bundle = commonVst3Root() / metadata.bundleName;
    if (!isDirectChild(commonVst3Root(), bundle)) {
        showError(L"The uninstall metadata resolved an unsafe VST3 path.");
        return 23;
    }
    if (!isSilentCommandLine()) {
        const std::wstring prompt = L"Uninstall " + metadata.productName + L" VST3?\n\nOnly this product's VST3 bundle and uninstall registration will be removed.";
        if (MessageBoxW(nullptr, prompt.c_str(), L"TripleSide Studio", MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND) != IDYES) return 2;
    }
    if (!removeTreeNoFollow(bundle, error)) {
        showError(error);
        return 24;
    }
    if (!unregisterProduct(metadata.installerId, error)) {
        showError(error);
        return 25;
    }
    DeleteFileW((uninstallDirectory / L"uninstall.dat").c_str());
    appendLog(L"Removed bundle: " + bundle.native());
    showInformation(metadata.productName + L" VST3 was uninstalled successfully.");
    if (!launchCleanupCopy(uninstallDirectory, error)) {
        MoveFileExW(currentExecutable.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
        MoveFileExW(uninstallDirectory.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
        showError(error);
        return 26;
    }
    return 0;
}

} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    try {
        const std::vector<std::wstring> arguments = commandLineArguments();
        if (arguments.size() >= 2 && arguments[1] == L"--cleanup") return cleanupAfterParent(arguments);
        return uninstall();
    } catch (const std::exception&) {
        showError(L"The native uninstaller encountered an unexpected error.");
        return 100;
    }
}
