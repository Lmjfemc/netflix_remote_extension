param([string]$OutputDirectory = 'dist')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Push-Location $root
try {
    $go = Join-Path $root '.tools/go/bin/go.exe'
    if (!(Test-Path $go)) { $go = (Get-Command go -ErrorAction Stop).Source }
    $env:GOCACHE = Join-Path $root '.tools/gocache'
    $env:GOMODCACHE = Join-Path $root '.tools/gomodcache'
    $env:CGO_ENABLED = '0'
    & $go test ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go tests failed' }
    $output = Join-Path $root $OutputDirectory
    New-Item -ItemType Directory -Force $output | Out-Null
    & $go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go vet failed' }
    & $go build -trimpath -ldflags '-s -w -H=windowsgui' -o (Join-Path $output 'netflix-remote.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'Go build failed' }
    Get-Item (Join-Path $output 'netflix-remote.exe') | Select-Object FullName, Length
} finally { Pop-Location }
