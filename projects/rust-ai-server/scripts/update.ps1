# Installs or updates SteamCMD, the Rust server and Carbon. Stop the server first.
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (Get-Process RustDedicated -ErrorAction SilentlyContinue) { throw 'Stop the Rust server first.' }
$dl = Join-Path $Root 'downloads'
New-Item -ItemType Directory -Force $dl, (Split-Path $SteamCmd), $ServerDir | Out-Null

if (-not (Test-Path $SteamCmd)) {
    Invoke-WebRequest -UseBasicParsing 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile "$dl\steamcmd.zip"
    Expand-Archive "$dl\steamcmd.zip" (Split-Path $SteamCmd) -Force
}
# SteamCMD can exit 7 after updating itself, so allow one retry.
foreach ($try in 1, 2) {
    & $SteamCmd +force_install_dir $ServerDir +login anonymous +app_update 258550 validate +quit
    if ($LASTEXITCODE -eq 0) { break }
}
if ($LASTEXITCODE -ne 0) { throw "SteamCMD failed with exit code $LASTEXITCODE" }

$zip = Join-Path $dl 'Carbon.Windows.Release.zip'
$rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/CarbonCommunity/Carbon/releases/tags/production_build'
$asset = $rel.assets | Where-Object name -eq 'Carbon.Windows.Release.zip'
Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
$hash = 'sha256:' + (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($asset.digest -and $hash -ne $asset.digest) { throw "Carbon download hash mismatch: $hash" }
Expand-Archive $zip $ServerDir -Force
"Rust and $($rel.name) are up to date."
