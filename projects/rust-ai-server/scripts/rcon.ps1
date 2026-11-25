# Sends one console command to the running server, e.g. .\rcon.ps1 "status"
param([Parameter(Mandatory)][string]$Command, [int]$TimeoutSeconds = 15)
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$ws = New-Object Net.WebSockets.ClientWebSocket
$ct = (New-Object Threading.CancellationTokenSource ($TimeoutSeconds * 1000)).Token
$null = $ws.ConnectAsync("ws://127.0.0.1:$RconPort/$(Get-RconPassword)", $ct).GetAwaiter().GetResult()
$id = Get-Random -Minimum 1000 -Maximum 99999
$json = @{ Identifier = $id; Message = $Command; Name = 'rcon.ps1' } | ConvertTo-Json -Compress
$seg = New-Object 'ArraySegment[byte]' (, [Text.Encoding]::UTF8.GetBytes($json))
$null = $ws.SendAsync($seg, 'Text', $true, $ct).GetAwaiter().GetResult()
$buf = New-Object byte[] 65536
try {
    while ($true) {
        $ms = New-Object IO.MemoryStream
        do {
            $r = $ws.ReceiveAsync((New-Object 'ArraySegment[byte]' (, $buf)), $ct).GetAwaiter().GetResult()
            $ms.Write($buf, 0, $r.Count)
        } until ($r.EndOfMessage)
        if ($r.MessageType -eq 'Close') { break }
        $m = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
        if ($m.Identifier -eq $id) { $m.Message; break }
    }
} finally {
    if ($ws.State -eq 'Open') { try { $null = $ws.CloseOutputAsync('NormalClosure', '', $ct).Wait(1000) } catch {} }
    $ws.Dispose()
}
