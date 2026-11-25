# Copies plugins\*.cs into carbon\plugins. Carbon hot-reloads changed files.
# With -Watch it keeps copying whenever a plugin is saved.
param([switch]$Watch)
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$src = Join-Path $ProjectDir 'plugins'
$dst = Join-Path $ServerDir 'carbon\plugins'
New-Item -ItemType Directory -Force $dst | Out-Null
function Sync-Plugins {
    foreach ($f in Get-ChildItem $src -Filter *.cs) {
        $t = Join-Path $dst $f.Name
        if (-not (Test-Path $t) -or (Get-FileHash $t).Hash -ne (Get-FileHash $f.FullName).Hash) {
            Copy-Item $f.FullName $t -Force
            "Deployed $($f.Name)"
        }
    }
}
Sync-Plugins
while ($Watch) { Start-Sleep 2; Sync-Plugins }
