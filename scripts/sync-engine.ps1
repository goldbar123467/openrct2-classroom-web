param(
    [string]$RunId = "29610479932"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Staging = Join-Path $ProjectRoot ".engine-staging"
$EngineOut = Join-Path $ProjectRoot "public\engine"
$ExpectedPrefix = $ProjectRoot.TrimEnd('\') + '\'
$ResolvedStaging = [System.IO.Path]::GetFullPath($Staging)

if (-not $ResolvedStaging.StartsWith($ExpectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a staging directory outside the project."
}
if (Test-Path -LiteralPath $ResolvedStaging) {
    Remove-Item -LiteralPath $ResolvedStaging -Recurse -Force
}
New-Item -ItemType Directory -Path $ResolvedStaging | Out-Null
New-Item -ItemType Directory -Force -Path $EngineOut | Out-Null

$EngineArtifact = "OpenRCT2-v0.5.3-49-g9de2d43fb6-emscripten"
$PortableArtifact = "OpenRCT2-v0.5.3-49-g9de2d43fb6-Windows-portable-x64"
gh run download $RunId --repo OpenRCT2/OpenRCT2 --name $EngineArtifact --dir (Join-Path $ResolvedStaging "emscripten")
gh run download $RunId --repo OpenRCT2/OpenRCT2 --name $PortableArtifact --dir (Join-Path $ResolvedStaging "portable")

$PortableZip = Get-ChildItem -LiteralPath (Join-Path $ResolvedStaging "portable") -Filter "*.zip" -File | Select-Object -First 1
if (-not $PortableZip) { throw "Portable OpenRCT2 archive was not downloaded." }
Expand-Archive -LiteralPath $PortableZip.FullName -DestinationPath (Join-Path $ResolvedStaging "portable-extracted")

Copy-Item -LiteralPath (Join-Path $ResolvedStaging "emscripten\openrct2.js") -Destination (Join-Path $EngineOut "openrct2.js") -Force
Copy-Item -LiteralPath (Join-Path $ResolvedStaging "emscripten\openrct2.wasm") -Destination (Join-Path $EngineOut "openrct2.wasm") -Force
$AssetsZip = Join-Path $EngineOut "assets.zip"
if (Test-Path -LiteralPath $AssetsZip) { Remove-Item -LiteralPath $AssetsZip -Force }
Compress-Archive -Path (Join-Path $ResolvedStaging "portable-extracted\data"),(Join-Path $ResolvedStaging "portable-extracted\changelog.txt") -DestinationPath $AssetsZip -CompressionLevel Optimal

node (Join-Path $PSScriptRoot "patch-engine.mjs")
Write-Output "Engine files refreshed. Update scripts/engine-manifest.json with the new SHA-256 hashes before committing."
