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

$PortableArtifact = "OpenRCT2-v0.5.3-49-g9de2d43fb6-Windows-portable-x64"

& (Join-Path $PSScriptRoot "rebuild-engine.ps1") -OutputDirectory "public\engine"
if ($LASTEXITCODE -ne 0) { throw "The pinned source-to-WASM rebuild failed." }

gh run download $RunId --repo OpenRCT2/OpenRCT2 --name $PortableArtifact --dir (Join-Path $ResolvedStaging "portable")

$PortableZip = Get-ChildItem -LiteralPath (Join-Path $ResolvedStaging "portable") -Filter "*.zip" -File | Select-Object -First 1
if (-not $PortableZip) { throw "Portable OpenRCT2 archive was not downloaded." }
Expand-Archive -LiteralPath $PortableZip.FullName -DestinationPath (Join-Path $ResolvedStaging "portable-extracted")

$AssetsZip = Join-Path $EngineOut "assets.zip"
if (Test-Path -LiteralPath $AssetsZip) { Remove-Item -LiteralPath $AssetsZip -Force }
Compress-Archive -Path (Join-Path $ResolvedStaging "portable-extracted\data"),(Join-Path $ResolvedStaging "portable-extracted\changelog.txt") -DestinationPath $AssetsZip -CompressionLevel Optimal

Write-Output "Engine and open assets refreshed from pinned source/artifacts. Update scripts/engine-manifest.json, then run npm run verify:engine before committing."
