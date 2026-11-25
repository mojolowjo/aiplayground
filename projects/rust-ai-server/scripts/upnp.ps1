# Shows, adds or removes router port mappings over UPnP. Changes the router only with -Add or -Remove.
# The mapping points at this PC's current LAN address; re-run -Add if that changes.
param([switch]$Add, [switch]$Remove, [switch]$IncludeQueryPort)
. "$PSScriptRoot\settings.ps1"
$ErrorActionPreference = 'Stop'
$map = (New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection
if ($null -eq $map) { throw 'No UPnP router found. Forward the port by hand, see README.' }
$ports = @($GamePort)
if ($IncludeQueryPort) { $ports += $QueryPort }
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
$ip = (Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1).IPAddress
foreach ($port in $ports) {
    if ($Remove) { $null = $map.Remove($port, 'UDP'); "Removed UDP $port" }
    if ($Add) { $null = $map.Add($port, 'UDP', $port, $ip, $true, "Rust test $port"); "Added UDP $port -> $ip" }
}
foreach ($m in $map) { "$($m.Protocol) $($m.ExternalIPAddress):$($m.ExternalPort) -> $($m.InternalClient):$($m.InternalPort) $($m.Description)" }
