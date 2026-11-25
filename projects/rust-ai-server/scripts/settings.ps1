# Shared settings. Every script dot-sources this file.
# Override anything by creating settings.local.ps1 next to it (ignored by git).
$Root        = 'C:\Users\mojol\Documents\Game Servers\ai rust server'
$Identity    = 'aitest'
$HostName    = 'AI Player Test (whitelisted)'
$WorldSize   = 2000
$Seed        = 11225
$MaxPlayers  = 10
$GamePort    = 28015   # UDP, forward this
$QueryPort   = 28017   # UDP, forward only if you want the server browser to see it
$RconPort    = 28016   # TCP, bound to 127.0.0.1, never forward
$BindIp      = '0.0.0.0'
$LocalSettings = Join-Path $PSScriptRoot 'settings.local.ps1'
if (Test-Path $LocalSettings) { . $LocalSettings }

$ServerDir   = Join-Path $Root 'server'
$SteamCmd    = Join-Path $Root 'steamcmd\steamcmd.exe'
$ProjectDir  = Split-Path $PSScriptRoot -Parent
$RconFile    = Join-Path $Root 'rcon-password.txt'

function Get-RconPassword {
    if (-not (Test-Path $RconFile)) {
        $bytes = New-Object byte[] 24
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        ([BitConverter]::ToString($bytes) -replace '-') | Out-File $RconFile -Encoding ascii -NoNewline
    }
    (Get-Content $RconFile -Raw).Trim()
}
