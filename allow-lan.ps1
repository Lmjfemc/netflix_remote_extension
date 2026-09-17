# Run once in an elevated PowerShell if Windows blocks phone access.
# Grants only this executable's TCP 8787 listener on a Private network,
# and only to peers on the local subnet. Does not change the network profile.
$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'NetflixRemote/netflix-remote.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Run install.cmd first.' }
$name = 'NetflixLANRemote-Go'
if (!(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name $name -DisplayName 'Netflix LAN Remote (Go)' -Direction Inbound -Action Allow -Program $exe -Protocol TCP -LocalPort 8787 -RemoteAddress LocalSubnet -Profile Private | Out-Null
} else {
    Get-NetFirewallRule -Name $name | Get-NetFirewallApplicationFilter | Set-NetFirewallApplicationFilter -Program $exe | Out-Null
}
Write-Output 'Private LAN access configured for the Go helper.'
