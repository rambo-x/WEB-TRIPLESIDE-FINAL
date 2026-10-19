param(
    [Parameter(Mandatory = $true)][string]$Spec,
    [Parameter(Mandatory = $true)][string]$SamplesDir,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][string]$Vst3SdkDir,
    [string]$BackgroundImage = "",
    [string]$VisualRenderUrl = "",
    [string]$VisualBrowser = "",
    [ValidateRange(1, 64)][int]$BuildJobs = 1,
    [string]$PythonPath = "python",
    [string]$CMakePath = "cmake",
    [string]$ValidatorPath = "",
    [ValidateSet("Release")][string]$BuildType = "Release"
)

$ErrorActionPreference = "Stop"
$RuntimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
$GeneratedDir = Join-Path $ResolvedOutput "generated"
$BuildDir = Join-Path $ResolvedOutput "cmake-build"
$env:CMAKE_BUILD_PARALLEL_LEVEL = "$BuildJobs"

function Invoke-CapturedNativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][object[]]$ArgumentList
    )
    # Windows PowerShell turns each native stderr line into an ErrorRecord. With
    # ErrorActionPreference=Stop that used to abort on "Traceback ..." and lose
    # the actual Python exception. Capture the complete merged stream first.
    $PreviousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $CapturedLines = @(& $FilePath @ArgumentList 2>&1)
        $ExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
    $CapturedText = ($CapturedLines | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    return [PSCustomObject]@{ ExitCode = $ExitCode; Output = $CapturedText }
}

function Write-CapturedOutput {
    param([string]$Text)
    if (-not [string]::IsNullOrWhiteSpace($Text)) { Write-Host $Text }
}

function Throw-CapturedFailure {
    param([string]$Message, $Result)
    $Details = if ([string]::IsNullOrWhiteSpace($Result.Output)) { "(subprocess tidak menghasilkan output)" } else { $Result.Output }
    throw "$Message`nExit code: $($Result.ExitCode)`n--- stdout/stderr lengkap ---`n$Details"
}

$ExportArguments = @((Join-Path $RuntimeRoot "tools/export_project.py"), $Spec, "--samples-dir", $SamplesDir, "--output", $ResolvedOutput)
if (-not [string]::IsNullOrWhiteSpace($BackgroundImage)) {
    $ExportArguments += @("--background-image", $BackgroundImage)
}
$ExportResult = Invoke-CapturedNativeCommand -FilePath $PythonPath -ArgumentList $ExportArguments
Write-CapturedOutput $ExportResult.Output
if ($ExportResult.ExitCode -ne 0) { Throw-CapturedFailure "Ekspor project native gagal." $ExportResult }

if (-not [string]::IsNullOrWhiteSpace($VisualRenderUrl)) {
    $VisualArguments = @((Join-Path $RuntimeRoot "tools/render_visual_assets.py"), (Join-Path $GeneratedDir "project.json"), "--url", $VisualRenderUrl)
    if (-not [string]::IsNullOrWhiteSpace($VisualBrowser)) { $VisualArguments += @("--browser", $VisualBrowser) }
    $VisualResult = $null
    for ($VisualAttempt = 1; $VisualAttempt -le 2; $VisualAttempt++) {
        $VisualResult = Invoke-CapturedNativeCommand -FilePath $PythonPath -ArgumentList $VisualArguments
        Write-CapturedOutput $VisualResult.Output
        if ($VisualResult.ExitCode -eq 0) { break }
        if ($VisualResult.ExitCode -eq 75 -and $VisualAttempt -eq 1) {
            Write-Host "Visual capture mengalami kegagalan sementara; mengulang satu kali dengan aset capture yang dibersihkan."
            Start-Sleep -Seconds 2
            continue
        }
        Throw-CapturedFailure "VST Maker visual capture failed; refusing a mismatched renderer fallback." $VisualResult
    }
    $VerifyArguments = @((Join-Path $RuntimeRoot "tools/verify_visual_assets.py"), (Join-Path $GeneratedDir "project.json"))
    $VerifyResult = Invoke-CapturedNativeCommand -FilePath $PythonPath -ArgumentList $VerifyArguments
    Write-CapturedOutput $VerifyResult.Output
    if ($VerifyResult.ExitCode -ne 0) { Throw-CapturedFailure "Visual asset composition does not match the browser reference." $VerifyResult }
}

$CompileArguments = @(
    (Join-Path $RuntimeRoot "tools/compile_manifest.py"),
    (Join-Path $GeneratedDir "project.json"),
    "--output", (Join-Path $GeneratedDir "NativeProject.h")
)
$CompileResult = Invoke-CapturedNativeCommand -FilePath $PythonPath -ArgumentList $CompileArguments
Write-CapturedOutput $CompileResult.Output
if ($CompileResult.ExitCode -ne 0) { Throw-CapturedFailure "Kompilasi manifest native gagal." $CompileResult }

& $CMakePath -S $RuntimeRoot -B $BuildDir -G "Visual Studio 17 2022" -A x64 `
    "-DTRIPLESIDE_GENERATED_DIR=$GeneratedDir" `
    "-DTRIPLESIDE_VST3_SDK_DIR=$Vst3SdkDir" `
    "-DTRIPLESIDE_BUILD_VISUAL_HOST=OFF" `
    "-DSMTG_CREATE_BUNDLE_FOR_WINDOWS=ON" `
    "-DSMTG_RUN_VST_VALIDATOR=OFF"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $CMakePath --build $BuildDir --config $BuildType --target TripleSideNativeInstrument TripleSideWindowsInstaller TripleSideWindowsUninstaller --parallel $BuildJobs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$Bundle = Get-ChildItem -Path $BuildDir -Filter *.vst3 -Directory -Recurse |
    Where-Object { Get-ChildItem -Path $_.FullName -Filter *.vst3 -File -Recurse | Select-Object -First 1 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $Bundle) { throw "Native VST3 bundle was not produced." }

if (-not [string]::IsNullOrWhiteSpace($ValidatorPath)) {
    if (-not (Test-Path -LiteralPath $ValidatorPath -PathType Leaf)) {
        throw "Steinberg validator was not found: $ValidatorPath"
    }
    & $ValidatorPath $Bundle.FullName
    if ($LASTEXITCODE -ne 0) { throw "Steinberg VST3 validator failed." }
}

$ArtifactDir = Join-Path $ResolvedOutput "artifacts"
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$ProductBaseName = [System.IO.Path]::GetFileNameWithoutExtension($Bundle.Name)
$ProjectManifest = Get-Content -LiteralPath (Join-Path $GeneratedDir "project.json") -Raw | ConvertFrom-Json
$ProductVersion = [string]$ProjectManifest.build.version
if ($ProductVersion -notmatch '^[0-9]+(?:\.[0-9]+){0,3}$') { $ProductVersion = "1.0.0" }
$Publisher = [string]$ProjectManifest.build.company_name
if ([string]::IsNullOrWhiteSpace($Publisher)) { $Publisher = "TripleSide Studio" }
$InstallerSlug = ($ProductBaseName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($InstallerSlug)) { $InstallerSlug = "plugin" }
$InstallerId = "com.triplesidestudio.vst3.$InstallerSlug"
$InstallerBaseName = $ProductBaseName + "-windows-vst3-setup"
$InstallerPath = Join-Path $ArtifactDir ($InstallerBaseName + ".exe")
$PortableUninstallerPath = Join-Path $ArtifactDir ($ProductBaseName + "-windows-vst3-uninstall.exe")
$InstallerStub = Join-Path $BuildDir "packaging\tripleside-native-setup-stub.exe"
$UninstallerStub = Join-Path $BuildDir "packaging\tripleside-native-uninstaller.exe"
foreach ($NativeStub in @($InstallerStub, $UninstallerStub)) {
    if (-not (Test-Path -LiteralPath $NativeStub -PathType Leaf)) {
        throw "Native Windows packaging stub was not produced: $NativeStub"
    }
}
$PackagingArguments = @(
    (Join-Path $RuntimeRoot "tools/package_windows_installer.py"),
    "--stub", $InstallerStub,
    "--uninstaller", $UninstallerStub,
    "--bundle", $Bundle.FullName,
    "--output", $InstallerPath,
    "--portable-uninstaller-output", $PortableUninstallerPath,
    "--product-name", $ProductBaseName,
    "--product-version", $ProductVersion,
    "--publisher", $Publisher,
    "--installer-id", $InstallerId,
    "--verify"
)
$PackagingResult = Invoke-CapturedNativeCommand -FilePath $PythonPath -ArgumentList $PackagingArguments
Write-CapturedOutput $PackagingResult.Output
if ($PackagingResult.ExitCode -ne 0) { Throw-CapturedFailure "Native Windows installer EXE packaging failed." $PackagingResult }
if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Native Windows installer EXE was not produced." }
if (-not (Test-Path -LiteralPath $PortableUninstallerPath -PathType Leaf)) { throw "Portable Windows uninstaller EXE was not produced." }

$ZipPath = Join-Path $ArtifactDir ($ProductBaseName + "-windows-vst3-installer.zip")
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
$NoticesDir = Join-Path $ResolvedOutput "package-notices"
New-Item -ItemType Directory -Force -Path $NoticesDir | Out-Null
Copy-Item -LiteralPath (Join-Path $RuntimeRoot "ThirdParty/signalsmith-stretch/LICENSE.txt") -Destination (Join-Path $NoticesDir "Signalsmith-Stretch-LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $RuntimeRoot "ThirdParty/signalsmith-linear/LICENSE.txt") -Destination (Join-Path $NoticesDir "Signalsmith-Linear-LICENSE.txt") -Force
& tar.exe -a -c -f $ZipPath -C $ArtifactDir ([System.IO.Path]::GetFileName($InstallerPath)) ([System.IO.Path]::GetFileName($PortableUninstallerPath)) -C $NoticesDir "Signalsmith-Stretch-LICENSE.txt" "Signalsmith-Linear-LICENSE.txt"
if ($LASTEXITCODE -ne 0) { throw "Native VST3 ZIP packaging failed." }
Write-Output $ZipPath
