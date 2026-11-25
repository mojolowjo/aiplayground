# Shows, adds or removes this server's router port mapping over UPnP.
# Changes the router only with -Add, -Remove or -Renew. -Renew re-adds every hour until stopped.
# Talks to the default gateway only, so it verifies each change with the router itself.
param([switch]$Add, [switch]$Remove, [switch]$Renew, [switch]$IncludeQueryPort, [int]$LeaseSeconds = 86400, [int]$RenewHours = 1)
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-Lan {
    $up = (Get-NetAdapter | Where-Object Status -eq 'Up').InterfaceIndex
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Where-Object { $up -contains $_.InterfaceIndex } |
        Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
    if (-not $route) { throw 'No default gateway.' }
    @{ Gateway = $route.NextHop; Ip = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1).IPAddress }
}

function Find-Router($lan) {
    $udp = New-Object Net.Sockets.UdpClient
    $udp.Client.Bind((New-Object Net.IPEndPoint ([Net.IPAddress]::Parse($lan.Ip)), 0))
    $udp.Client.ReceiveTimeout = 3000
    $msg = "M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nMX: 2`r`nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1`r`n`r`n"
    $bytes = [Text.Encoding]::ASCII.GetBytes($msg)
    1..2 | ForEach-Object { $null = $udp.Send($bytes, $bytes.Length, '239.255.255.250', 1900) }
    try {
        while ($true) {
            $ep = New-Object Net.IPEndPoint ([Net.IPAddress]::Any), 0
            $reply = [Text.Encoding]::ASCII.GetString($udp.Receive([ref]$ep))
            if ($reply -match '(?im)^location:\s*(\S+)') {
                $loc = [uri]$Matches[1]
                if ($loc.Host -ne $lan.Gateway) { continue }
                $desc = [xml](Invoke-WebRequest -UseBasicParsing $loc -TimeoutSec 8).Content
                foreach ($s in $desc.SelectNodes("//*[local-name()='service']")) {
                    if ($s.serviceType -match 'WAN(IP|PPP)Connection') {
                        return @{ Url = (New-Object Uri $loc, $s.controlURL); Type = $s.serviceType }
                    }
                }
            }
        }
    } catch [Net.Sockets.SocketException] { } finally { $udp.Close() }
    throw 'The router did not answer UPnP discovery.'
}

function Invoke-Router($router, $action, $inner) {
    $body = "<?xml version=`"1.0`"?><s:Envelope xmlns:s=`"http://schemas.xmlsoap.org/soap/envelope/`" s:encodingStyle=`"http://schemas.xmlsoap.org/soap/encoding/`"><s:Body><u:$action xmlns:u=`"$($router.Type)`">$inner</u:$action></s:Body></s:Envelope>"
    [xml](Invoke-WebRequest -UseBasicParsing $router.Url -Method Post -Body $body -ContentType 'text/xml' -TimeoutSec 8 -Headers @{ SOAPAction = "`"$($router.Type)#$action`"" }).Content
}

function Read-Field($xml, $name) { $xml.SelectSingleNode("//*[local-name()='$name']").InnerText }

function Get-Mapping($router, $port) {
    $key = "<NewRemoteHost></NewRemoteHost><NewExternalPort>$port</NewExternalPort><NewProtocol>UDP</NewProtocol>"
    try { $x = Invoke-Router $router 'GetSpecificPortMappingEntry' $key }
    catch [Net.WebException] {
        if (-not $_.Exception.Response) { throw }
        $text = (New-Object IO.StreamReader $_.Exception.Response.GetResponseStream()).ReadToEnd()
        if ($text -match '<errorCode>714<') { return $null }   # 714 = no such mapping
        throw
    }
    @{ Client = (Read-Field $x 'NewInternalClient'); Lease = (Read-Field $x 'NewLeaseDuration') }
}

function Update-Mappings {
    $lan = Get-Lan
    $router = Find-Router $lan
    foreach ($port in $ports) {
        $current = Get-Mapping $router $port
        if (($Add -or $Renew -or $Remove) -and $current -and $current.Client -ne $lan.Ip) {
            throw "UDP $port already belongs to $($current.Client); not touching it."
        }
        if ($Remove -and $current) {
            $null = Invoke-Router $router 'DeletePortMapping' "<NewRemoteHost></NewRemoteHost><NewExternalPort>$port</NewExternalPort><NewProtocol>UDP</NewProtocol>"
        }
        if ($Add -or $Renew) {
            $null = Invoke-Router $router 'AddPortMapping' ("<NewRemoteHost></NewRemoteHost><NewExternalPort>$port</NewExternalPort><NewProtocol>UDP</NewProtocol>" +
                "<NewInternalPort>$port</NewInternalPort><NewInternalClient>$($lan.Ip)</NewInternalClient><NewEnabled>1</NewEnabled>" +
                "<NewPortMappingDescription>Rust test $port</NewPortMappingDescription><NewLeaseDuration>$LeaseSeconds</NewLeaseDuration>")
        }
        $now = Get-Mapping $router $port
        if ($now) { "$(Get-Date -Format s) UDP $port -> $($now.Client), lease $($now.Lease) s" }
        else { "$(Get-Date -Format s) UDP $port is not mapped" }
        if (($Add -or $Renew) -and (-not $now -or $now.Client -ne $lan.Ip)) { throw "UDP $port mapping was not confirmed." }
        if ($Remove -and $now) { throw "UDP $port is still mapped." }
    }
}

$ports = @($GamePort)
if ($IncludeQueryPort) { $ports += $QueryPort }
if (-not $Renew) { Update-Mappings; return }
while ($true) {
    $wait = $RenewHours * 3600
    try { Update-Mappings } catch { "$(Get-Date -Format s) Renewal failed: $_"; $wait = 600 }
    Start-Sleep -Seconds $wait
}
