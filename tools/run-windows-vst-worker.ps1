param(
    [string]$ApiBase = "https://triplesidestudio.com/api",
    [string]$WorkerToken = $env:VST_BUILD_WORKER_TOKEN,
    [string]$WorkerId = $env:COMPUTERNAME,
    [string]$NativeRoot = "C:\TripleSideWorker\native-vst3",
    [string]$Vst3SdkDir = "C:\TripleSideWorker\vst3sdk",
    [string]$ValidatorPath = "C:\TripleSideWorker\vst3-validator-build\bin\Release\validator.exe",
    [string]$WorkRoot = "C:\TripleSideWorker\jobs",
    [string]$PythonPath = "C:\Program Files\Python312\python.exe",
    [string]$CMakePath = "C:\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
    [string]$DumpbinPath = "C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\dumpbin.exe",
    [string]$InnoSetupCompiler = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    [string]$PlaywrightBrowsersPath = "C:\TripleSideWorker\ms-playwright",
    [ValidateRange(5, 300)][int]$PollSeconds = 15,
    [switch]$Once
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Net.Http

if ([string]::IsNullOrWhiteSpace($WorkerToken)) {
    $WorkerToken = [Environment]::GetEnvironmentVariable("VST_BUILD_WORKER_TOKEN", "Machine")
}
if ([string]::IsNullOrWhiteSpace($WorkerToken)) { throw "VST_BUILD_WORKER_TOKEN belum diatur." }
if ([string]::IsNullOrWhiteSpace($WorkerId)) { throw "WorkerId belum diatur." }
foreach ($RequiredPath in @($NativeRoot, $Vst3SdkDir, $ValidatorPath, $PythonPath, $CMakePath, $DumpbinPath, $InnoSetupCompiler)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) { throw "Path worker tidak ditemukan: $RequiredPath" }
}
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null

$AuthHeaders = @{ Authorization = "Bearer $WorkerToken" }

function Resolve-VisualBrowser {
    if (-not (Test-Path -LiteralPath $PlaywrightBrowsersPath -PathType Container)) {
        throw "Direktori browser visual worker tidak ditemukan: $PlaywrightBrowsersPath"
    }
    $Candidates = Get-ChildItem -LiteralPath $PlaywrightBrowsersPath -Directory -Filter "chromium_headless_shell-*" |
        Sort-Object LastWriteTime -Descending
    foreach ($Candidate in $Candidates) {
        $Executable = Join-Path $Candidate.FullName "chrome-headless-shell-win64\chrome-headless-shell.exe"
        if (Test-Path -LiteralPath $Executable -PathType Leaf) { return $Executable }
    }
    throw "Executable Chromium Playwright tidak ditemukan di lokasi browser bersama: $PlaywrightBrowsersPath"
}

function Invoke-WorkerJson {
    param([string]$Method, [string]$Path, [object]$Body)
    $Parameters = @{
        Method = $Method
        Uri = "$($ApiBase.TrimEnd('/'))$Path"
        Headers = $AuthHeaders
        UseBasicParsing = $true
        TimeoutSec = 120
    }
    if ($null -ne $Body) {
        $Parameters.ContentType = "application/json"
        $Parameters.Body = ($Body | ConvertTo-Json -Depth 20 -Compress)
    }
    $Response = Invoke-WebRequest @Parameters
    if ($Response.StatusCode -eq 204 -or [string]::IsNullOrWhiteSpace($Response.Content)) { return $null }
    return $Response.Content | ConvertFrom-Json
}

function Set-BuildStatus {
    param($Job, [string]$Status, [int]$Progress, [string]$Message, [string]$Failure = "")
    if ($Failure.Length -gt 12000) {
        $Marker = "[... log awal dipotong ...]`n"
        $Failure = $Marker + $Failure.Substring($Failure.Length - (12000 - $Marker.Length))
    }
    Invoke-WorkerJson -Method POST -Path "/vst-worker/jobs/$($Job.job_id)/status" -Body @{
        lease_token = $Job.lease_token
        status = $Status
        progress = $Progress
        message = $Message
        error = $Failure
    } | Out-Null
}

function Send-Artifact {
    param($Job, [string]$ZipPath, [string]$Sha256, [string]$ValidatorName)
    $Client = New-Object System.Net.Http.HttpClient
    $Client.Timeout = [TimeSpan]::FromHours(1)
    $Client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $WorkerToken)
    $Client.DefaultRequestHeaders.Add("X-Lease-Token", [string]$Job.lease_token)
    $Client.DefaultRequestHeaders.Add("X-Artifact-SHA256", $Sha256.ToLowerInvariant())
    $Client.DefaultRequestHeaders.Add("X-Validator-Name", $ValidatorName)
    $Multipart = New-Object System.Net.Http.MultipartFormDataContent
    $Stream = [System.IO.File]::OpenRead($ZipPath)
    try {
        $FileContent = New-Object System.Net.Http.StreamContent($Stream)
        $FileContent.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue("application/zip")
        $Multipart.Add($FileContent, "file", [System.IO.Path]::GetFileName($ZipPath))
        $Response = $Client.PostAsync("$($ApiBase.TrimEnd('/'))/vst-worker/jobs/$($Job.job_id)/artifact", $Multipart).GetAwaiter().GetResult()
        $Text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $Response.IsSuccessStatusCode) { throw "Upload artifact gagal ($([int]$Response.StatusCode)): $Text" }
    }
    finally {
        $Stream.Dispose()
        $Multipart.Dispose()
        $Client.Dispose()
    }
}

function Invoke-BuildJob {
    param($Job)
    $JobRoot = Join-Path $WorkRoot $Job.job_id
    $SamplesDir = Join-Path $JobRoot "samples"
    $OutputDir = Join-Path $JobRoot "output"
    $SpecPath = Join-Path $JobRoot "project.json"
    $BackgroundPath = Join-Path $JobRoot "plugin-background"
    if (Test-Path -LiteralPath $JobRoot) { Remove-Item -LiteralPath $JobRoot -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $SamplesDir | Out-Null
    try {
        $SpecJson = $Job.spec | ConvertTo-Json -Depth 40
        [System.IO.File]::WriteAllText($SpecPath, $SpecJson, (New-Object System.Text.UTF8Encoding($false)))
        # The server hash uses canonical JSON, so integrity is anchored by TLS and the immutable server snapshot.
        if ([string]::IsNullOrWhiteSpace($Job.spec_sha256)) { throw "Spec build tidak memiliki checksum." }

        $Index = 0
        foreach ($Sample in $Job.samples) {
            $Index++
            $Destination = Join-Path $SamplesDir ([string]$Sample.filename)
            Set-BuildStatus $Job "preparing" ([Math]::Min(20, 2 + $Index)) "Mengunduh sample $Index/$($Job.samples.Count)"
            Invoke-WebRequest -Uri $Sample.download_url -OutFile $Destination -UseBasicParsing -TimeoutSec 600
            $ActualSize = (Get-Item -LiteralPath $Destination).Length
            $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Destination).Hash.ToLowerInvariant()
            if ($ActualSize -ne [long]$Sample.size_bytes -or $ActualHash -ne ([string]$Sample.sha256).ToLowerInvariant()) {
                throw "Integritas sample gagal: $($Sample.filename)"
            }
        }

        if ($null -ne $Job.background -and -not [string]::IsNullOrWhiteSpace([string]$Job.background.download_url)) {
            Set-BuildStatus $Job "preparing" 22 "Mengunduh background interface"
            $BackgroundUrl = [string]$Job.background.download_url
            if ($BackgroundUrl.StartsWith("/")) {
                $ApiUri = [System.Uri]$ApiBase
                $BackgroundUrl = "$($ApiUri.Scheme)://$($ApiUri.Authority)$BackgroundUrl"
            }
            if (-not $BackgroundUrl.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "URL background build harus menggunakan HTTPS."
            }
            Invoke-WebRequest -Uri $BackgroundUrl -OutFile $BackgroundPath -UseBasicParsing -TimeoutSec 300 -MaximumRedirection 0
            $BackgroundSize = (Get-Item -LiteralPath $BackgroundPath).Length
            if ($BackgroundSize -le 0 -or $BackgroundSize -gt 10MB) {
                throw "Ukuran background build tidak valid."
            }
        }

        $NonWavSamples = @($Job.samples | Where-Object { [System.IO.Path]::GetExtension([string]$_.filename).ToLowerInvariant() -ne ".wav" })
        if ($NonWavSamples.Count -ne 0) {
            throw "Runtime native Steinberg hanya menerima sample WAV."
        }
        Set-BuildStatus $Job "building" 25 "Mengompilasi VST3 Windows (native Steinberg SDK)"
        $BuildScript = Join-Path $NativeRoot "build-windows.ps1"
        $BuildParameters = @{
            Spec = $SpecPath
            SamplesDir = $SamplesDir
            OutputDir = $OutputDir
            Vst3SdkDir = $Vst3SdkDir
            ValidatorPath = $ValidatorPath
            BuildJobs = 1
            PythonPath = $PythonPath
            CMakePath = $CMakePath
            InnoSetupCompiler = $InnoSetupCompiler
            BuildType = "Release"
        }
        if (Test-Path -LiteralPath $BackgroundPath -PathType Leaf) {
            $BuildParameters.BackgroundImage = $BackgroundPath
        }
        # Select rendering by capability, never by a template allowlist. Older
        # queued specs predate visual_contract, so infer the same capability from
        # their DSP profile. New specs use shared preview for the complete static
        # interface; live analyzers are native overlays in measured DOM boxes.
        $VisualMode = [string]$Job.spec.visual_contract.mode
        if ([string]::IsNullOrWhiteSpace($VisualMode)) {
            $VisualMode = if ([string]$Job.spec.dsp_profile -eq "prism_eq") { "native_live" } else { "shared_preview" }
        }
        if ($VisualMode -eq "shared_preview") {
            $ApiUri = [System.Uri]$ApiBase
            $BuildParameters.VisualRenderUrl = "$($ApiUri.Scheme)://$($ApiUri.Authority)/vst-visual-render"
            # The scheduled worker runs as SYSTEM. Always use the shared browser
            # installation explicitly instead of a user-profile Playwright cache.
            $BuildParameters.VisualBrowser = Resolve-VisualBrowser
        } elseif ($VisualMode -ne "native_live") {
            throw "Mode kontrak visual tidak dikenal: $VisualMode"
        }
        # Run compilation in a child PowerShell job so this worker can renew
        # the lease and publish honest heartbeat progress while MSBuild is busy.
        $CompilationStartedAt = Get-Date
        $HeartbeatProgress = 25
        $CompilerJob = Start-Job -ScriptBlock {
            param([string]$ScriptPath, [hashtable]$Parameters)
            $Lines = @(& $ScriptPath @Parameters 2>&1 | ForEach-Object { [string]$_ })
            [pscustomobject]@{ ExitCode = $LASTEXITCODE; Lines = $Lines }
        } -ArgumentList $BuildScript, $BuildParameters
        try {
            while ($CompilerJob.State -in @("NotStarted", "Running")) {
                Wait-Job -Job $CompilerJob -Timeout 15 | Out-Null
                if ($CompilerJob.State -eq "Running") {
                    $HeartbeatProgress = [Math]::Min(88, $HeartbeatProgress + 2)
                    $Elapsed = (Get-Date) - $CompilationStartedAt
                    $ElapsedText = if ($Elapsed.TotalMinutes -ge 1) {
                        "{0} menit {1} detik" -f [Math]::Floor($Elapsed.TotalMinutes), $Elapsed.Seconds
                    } else {
                        "{0} detik" -f [Math]::Max(1, [Math]::Floor($Elapsed.TotalSeconds))
                    }
                    Set-BuildStatus $Job "building" $HeartbeatProgress "Compiler Windows aktif · berjalan $ElapsedText"
                }
            }
            $BuildResult = Receive-Job -Job $CompilerJob
        }
        finally {
            Remove-Job -Job $CompilerJob -Force -ErrorAction SilentlyContinue
        }
        $BuildOutput = @($BuildResult.Lines)
        if ([int]$BuildResult.ExitCode -ne 0) { throw ($BuildOutput | Out-String) }
        $ZipPath = [string]($BuildOutput | Select-Object -Last 1)
        if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw "Artifact ZIP tidak ditemukan setelah build." }

        Set-BuildStatus $Job "validating" 92 "Memvalidasi entry point VST3"
        $Bundle = Get-ChildItem -Path (Join-Path $OutputDir "cmake-build") -Filter *.vst3 -Directory -Recurse | Select-Object -First 1
        $Module = Get-ChildItem -Path $Bundle.FullName -Filter *.vst3 -File -Recurse | Select-Object -First 1
        if (-not $Module) { throw "Modul VST3 tidak ditemukan untuk validasi." }
        $Headers = & $DumpbinPath /headers $Module.FullName 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $Headers -notmatch "\.rsrc") {
            throw "Section resource embedded (.rsrc) tidak ditemukan di modul VST3."
        }
        $GeneratedAssets = Join-Path $OutputDir "generated\assets"
        $EmbeddedPayloadBytes = (Get-ChildItem -LiteralPath $GeneratedAssets -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        if ($null -eq $EmbeddedPayloadBytes) { $EmbeddedPayloadBytes = 0 }
        if ($Module.Length -le [long]$EmbeddedPayloadBytes) {
            throw "Ukuran modul tidak membuktikan bahwa seluruh aset project tertanam."
        }
        $Resources = Join-Path $Bundle.FullName "Contents\Resources"
        if (Test-Path -LiteralPath $Resources -PathType Container) {
            $ExternalRuntimeAssets = @(Get-ChildItem -LiteralPath $Resources -File | Where-Object {
                $_.Name -like "sample_*.wav" -or $_.Name -like "ui_background.*" -or $_.Extension -eq ".png"
            })
            if ($ExternalRuntimeAssets.Count -ne 0) {
                throw "Build native masih bergantung pada aset runtime eksternal."
            }
        }
        $Exports = & $DumpbinPath /exports $Module.FullName 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $Exports -notmatch "GetPluginFactory") { throw "Entry point GetPluginFactory tidak ditemukan." }

        $ArtifactHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ZipPath).Hash
        $ValidatorName = "Steinberg validator + embedded .rsrc + GetPluginFactory"
        Send-Artifact $Job $ZipPath $ArtifactHash $ValidatorName
        Write-Host "[$(Get-Date -Format s)] READY $($Job.job_id) $ZipPath"
    }
    catch {
        $Failure = ($_ | Out-String).Trim()
        try { Set-BuildStatus $Job "failed" 0 "Build VST3 gagal" $Failure } catch { Write-Warning "Status gagal tidak dapat dikirim: $_" }
        Write-Error "[$(Get-Date -Format s)] FAILED $($Job.job_id): $Failure" -ErrorAction Continue
    }
    finally {
        if (Test-Path -LiteralPath $JobRoot) { Remove-Item -LiteralPath $JobRoot -Recurse -Force }
    }
}

do {
    try {
        $Job = Invoke-WorkerJson -Method POST -Path "/vst-worker/claim" -Body @{ worker_id = $WorkerId }
        if ($null -ne $Job) { Invoke-BuildJob $Job }
    }
    catch {
        Write-Warning "[$(Get-Date -Format s)] Worker error: $_"
    }
    if (-not $Once) { Start-Sleep -Seconds $PollSeconds }
} while (-not $Once)
