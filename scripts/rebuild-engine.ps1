param(
    [string]$OutputDirectory = ".engine-rebuild\output",
    [switch]$VerifyManifest,
    [switch]$VerifyContract,
    [switch]$KeepSource
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ProjectPrefix = $ProjectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$Staging = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot ".engine-rebuild"))
$Output = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $OutputDirectory))
$Source = Join-Path $Staging "source"
$Patch = Join-Path $PSScriptRoot "engine-lite.patch"
$Commit = "9de2d43fb6e7d6a6213336125a4afbddf8cc167c"
$Image = "ghcr.io/openrct2/openrct2-build@sha256:0e1daa8e3f5a1c6951179aeab5c5de471ea705cb5f756bfb6e0ae5162b7e67be"

function Assert-ProjectPath([string]$Path, [string]$Label) {
    if (-not $Path.StartsWith($ProjectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label must remain inside the project workspace: $Path"
    }
}

function Invoke-Checked([string]$Label, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Remove-BuildDirectory([string]$Path, [string]$Label) {
    $ResolvedPath = [System.IO.Path]::GetFullPath($Path)
    Assert-ProjectPath $ResolvedPath $Label
    if (-not (Test-Path -LiteralPath $ResolvedPath)) { return }

    try {
        Remove-Item -LiteralPath $ResolvedPath -Recurse -Force -ErrorAction Stop
        return
    }
    catch {
        Write-Warning "$Label contains container-owned files; retrying cleanup through the pinned build image."
    }

    # Linux runners receive root-owned outputs from the pinned container. The
    # exact bind mount is already constrained to the project by the assertion.
    Invoke-Checked "$Label container cleanup" {
        docker run --rm --volume "${ResolvedPath}:/src" $Image bash -lc "find /src -depth -mindepth 1 -delete"
    }
    Remove-Item -LiteralPath $ResolvedPath -Force -ErrorAction Stop
}

Assert-ProjectPath $Staging "Engine staging directory"
Assert-ProjectPath $Output "Engine output directory"
if ($VerifyManifest -and $VerifyContract) { throw "Choose either -VerifyManifest or -VerifyContract, not both." }

Remove-BuildDirectory $Source "Engine source directory"
if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
New-Item -ItemType Directory -Path $Source | Out-Null

Invoke-Checked "Git initialization" { git -C $Source init --quiet }
Invoke-Checked "Byte-preserving checkout configuration" { git -C $Source config core.autocrlf false }
Invoke-Checked "Unix source line-ending configuration" { git -C $Source config core.eol lf }
Invoke-Checked "Upstream remote configuration" { git -C $Source remote add origin https://github.com/OpenRCT2/OpenRCT2.git }
Invoke-Checked "Exact upstream fetch" { git -C $Source fetch --quiet --filter=blob:none --depth=256 origin $Commit }
Invoke-Checked "Upstream tags fetch" { git -C $Source fetch --quiet --filter=blob:none --tags origin }
Invoke-Checked "Exact upstream checkout" { git -C $Source checkout --quiet --detach FETCH_HEAD }

$ActualCommit = (git -C $Source rev-parse HEAD).Trim()
if ($ActualCommit -ne $Commit) { throw "Expected OpenRCT2 $Commit but checked out $ActualCommit." }
Invoke-Checked "Classroom patch preflight" { git -C $Source apply --unidiff-zero --check $Patch }
Invoke-Checked "Classroom patch application" { git -C $Source apply --unidiff-zero $Patch }

$BuildScript = Get-Content -LiteralPath (Join-Path $Source "scripts\build-emscripten") -Raw
foreach ($Marker in @("MAXIMUM_MEMORY=2GB", "INITIAL_MEMORY=512MB", "PTHREAD_POOL_SIZE=4")) {
    if (-not $BuildScript.Contains($Marker)) { throw "Patched build script is missing $Marker." }
}
$BuildScriptBytes = [System.IO.File]::ReadAllBytes((Join-Path $Source "scripts\build-emscripten"))
if ($BuildScriptBytes -contains 13) { throw "Upstream Linux build script contains a carriage return; checkout normalization is unsafe." }

Invoke-Checked "Pinned build image pull" { docker pull $Image }
Invoke-Checked "Pinned OpenRCT2 Emscripten build" {
    docker run --rm --volume "${Source}:/src" --workdir /src $Image bash -lc "bash scripts/build-emscripten"
}

New-Item -ItemType Directory -Force -Path $Output | Out-Null
$BuiltDirectory = Join-Path $Source "build\www"
Copy-Item -LiteralPath (Join-Path $BuiltDirectory "openrct2.js") -Destination (Join-Path $Output "openrct2.js") -Force
Copy-Item -LiteralPath (Join-Path $BuiltDirectory "openrct2.wasm") -Destination (Join-Path $Output "openrct2.wasm") -Force
Invoke-Checked "Deterministic JavaScript wrapper patch" { node (Join-Path $PSScriptRoot "patch-engine.mjs") $Output }

$Metadata = [ordered]@{
    upstreamCommit = $Commit
    containerImage = $Image
    patch = "scripts/engine-lite.patch"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    files = [ordered]@{}
}
foreach ($Name in @("openrct2.js", "openrct2.wasm")) {
    $File = Get-Item -LiteralPath (Join-Path $Output $Name)
    $Metadata.files[$Name] = [ordered]@{
        bytes = $File.Length
        sha256 = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$Metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Output "rebuild-metadata.json") -Encoding utf8

if ($VerifyManifest) {
    Invoke-Checked "Rebuilt engine manifest comparison" { node (Join-Path $PSScriptRoot "verify-engine.mjs") $Output --skip-assets }
}
if ($VerifyContract) {
    Invoke-Checked "Rebuilt engine contract verification" { node (Join-Path $PSScriptRoot "verify-engine.mjs") $Output --skip-assets --contract-only }
}

if (-not $KeepSource) {
    Remove-BuildDirectory $Source "Engine source directory"
}

Write-Output "Rebuilt OpenRCT2 $Commit with the pinned container. Output: $Output"
