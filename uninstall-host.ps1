$ErrorActionPreference = 'Stop'
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.netflixlan.remote'
if (Test-Path $key) { Remove-Item -LiteralPath $key }
Write-Output 'Native host registration removed. Project files are preserved.'
