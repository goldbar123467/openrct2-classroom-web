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

Remove-BuildDirectory $Staging "Engine staging directory"
New-Item -ItemType Directory -Force -Path $Output | Out-Null

# Build on the immutable container's own overlay filesystem. Previous parallel
# runs produced different coupled JS/WASM pairs across hosts, so the build below
# removes both the mutable host filesystem and scheduler concurrency variables.
# Required Linux CI and local Docker now consume the same source bytes, paths,
# tools, filesystem implementation, and one-job build order. Emscripten and
# Binaryen have separate worker-pool controls, so both must be pinned.
$ContainerName = "parkworks-engine-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 12))"
$ContainerCreated = $false
$BuildCommand = @'
set -euo pipefail
mkdir -p /src
cd /src
git init --quiet
git config core.autocrlf false
git config core.eol lf
git remote add origin https://github.com/OpenRCT2/OpenRCT2.git
git fetch --quiet --filter=blob:none --depth=256 origin __COMMIT__
git fetch --quiet --filter=blob:none --tags origin
git checkout --quiet --detach __COMMIT__
test "$(git rev-parse HEAD)" = "__COMMIT__"
git apply --unidiff-zero --check /tmp/engine-lite.patch
git apply --unidiff-zero /tmp/engine-lite.patch
grep -q 'MAXIMUM_MEMORY=2GB' scripts/build-emscripten
grep -q 'INITIAL_MEMORY=512MB' scripts/build-emscripten
grep -q 'PTHREAD_POOL_SIZE=4' scripts/build-emscripten
grep -q 'DISABLE_IPO=ON' scripts/build-emscripten
grep -q -- '-Wl,--threads=1' scripts/build-emscripten
grep -q 'emmake ninja -j 1' scripts/build-emscripten
if grep -q "$(printf '\r')" scripts/build-emscripten; then
  echo 'Upstream Linux build script contains a carriage return; checkout normalization is unsafe.' >&2
  exit 1
fi
export EMCC_CORES=1
export BINARYEN_CORES=1
bash scripts/build-emscripten
'@.Replace("__COMMIT__", $Commit)
$BuildCommand = $BuildCommand.Replace("`r`n", "`n") + "`n"
$ContainerScript = Join-Path $Staging "container-build.sh"
[System.IO.File]::WriteAllText($ContainerScript, $BuildCommand, [System.Text.UTF8Encoding]::new($false))
$ContainerPatch = Join-Path $Staging "engine-lite.patch"
$PatchText = [System.IO.File]::ReadAllText($Patch).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText($ContainerPatch, $PatchText, [System.Text.UTF8Encoding]::new($false))

try {
    Invoke-Checked "Pinned build image pull" { docker pull $Image }
    Invoke-Checked "Hermetic build container creation" { docker create --name $ContainerName $Image bash /tmp/parkworks-build.sh }
    $ContainerCreated = $true
    Invoke-Checked "Hermetic build script transfer" { docker cp $ContainerScript "${ContainerName}:/tmp/parkworks-build.sh" }
    Invoke-Checked "Classroom patch transfer" { docker cp $ContainerPatch "${ContainerName}:/tmp/engine-lite.patch" }
    Invoke-Checked "Pinned OpenRCT2 Emscripten build" { docker start --attach $ContainerName }
    foreach ($Name in @("openrct2.js", "openrct2.wasm")) {
        Invoke-Checked "$Name extraction" {
            docker cp "${ContainerName}:/src/build/www/$Name" (Join-Path $Output $Name)
        }
    }
    if ($KeepSource) {
        New-Item -ItemType Directory -Force -Path $Source | Out-Null
        Invoke-Checked "Built source extraction" { docker cp "${ContainerName}:/src/." $Source }
    }
}
finally {
    if ($ContainerCreated) {
        docker rm --force $ContainerName | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove hermetic build container $ContainerName." }
    }
}

Invoke-Checked "Deterministic JavaScript wrapper patch" { node (Join-Path $PSScriptRoot "patch-engine.mjs") $Output }

$Metadata = [ordered]@{
    upstreamCommit = $Commit
    containerImage = $Image
    patch = "scripts/engine-lite.patch"
    buildJobs = 1
    emccCores = 1
    binaryenCores = 1
    linkerThreads = 1
    ipoDisabled = $true
    hermeticContainerFilesystem = $true
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

Write-Output "Rebuilt OpenRCT2 $Commit with the pinned container. Output: $Output"
