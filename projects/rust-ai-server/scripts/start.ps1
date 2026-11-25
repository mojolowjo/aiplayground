# Starts the server in this window. Stop it with Ctrl+C, or cleanly with: .\rcon.ps1 "quit"
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$cfgDir = Join-Path $ServerDir "server\$Identity\cfg"
New-Item -ItemType Directory -Force $cfgDir | Out-Null
Copy-Item "$ProjectDir\config\server.cfg" "$cfgDir\server.cfg" -Force
& "$PSScriptRoot\deploy-plugins.ps1"

$env:DOORSTOP_ENABLED = '1'
Push-Location $ServerDir
try {
    & .\RustDedicated.exe -batchmode -nographics `
        +server.identity $Identity +server.hostname "`"$HostName`"" `
        +server.level 'Procedural Map' +server.worldsize $WorldSize +server.seed $Seed `
        +server.maxplayers $MaxPlayers +server.ip $BindIp `
        +server.port $GamePort +server.queryport $QueryPort `
        +rcon.ip 127.0.0.1 +rcon.port $RconPort +rcon.web 1 +rcon.password (Get-RconPassword) `
        +app.port -1 +server.saveinterval 600 -logfile "$Root\server.log" | Out-Default
} finally { Pop-Location }
