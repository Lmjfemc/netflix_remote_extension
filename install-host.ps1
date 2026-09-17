param([Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'dist/netflix-remote.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Run build.ps1 first.' }
$manifest = Join-Path $PSScriptRoot 'dist/com.netflixlan.remote.json'
$config = @{
    name = 'com.netflixlan.remote'
    description = 'Netflix LAN Remote local helper'
    path = $exe
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
[System.IO.File]::WriteAllText($manifest, ($config | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.netflixlan.remote'
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value $manifest
Write-Output "Registered helper for extension $ExtensionId. Keep this project folder in place."
