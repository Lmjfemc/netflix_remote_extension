$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$previousExe = $env:NATIVE_HOST_EXE
try {
    $version = (Get-Content extension/manifest.json -Raw | ConvertFrom-Json).version
    $packageVersion = (Get-Content package.json -Raw | ConvertFrom-Json).version
    if ($version -ne $packageVersion) { throw 'Extension and package versions differ.' }
    $output = "dist/v$version"
    ./build.ps1 -OutputDirectory $output
    if (!(Test-Path node_modules/ws)) { throw 'Run npm ci before packaging.' }
    $env:NATIVE_HOST_EXE = Join-Path $PSScriptRoot "$output/netflix-remote.exe"
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Integration tests failed.' }
    npm run format:check
    if ($LASTEXITCODE -ne 0) { throw 'Formatting check failed.' }

    # Unique staging directory avoids deleting unrelated or previous artifacts.
    $stage = Join-Path $PSScriptRoot ('.tools/release-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force (Join-Path $stage 'dist') | Out-Null
    Copy-Item -LiteralPath extension -Destination $stage -Recurse
    Copy-Item -LiteralPath $env:NATIVE_HOST_EXE -Destination (Join-Path $stage 'dist/netflix-remote.exe')
    $docs = @('install-host.ps1','uninstall-host.ps1','allow-lan.ps1','README.md','VALIDATION.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md')
    foreach ($file in $docs) { Copy-Item -LiteralPath $file -Destination $stage }

    $bundle = "$output/netflix-lan-remote-v$version-windows-amd64.zip"
    $extensionZip = "$output/netflix-lan-remote-v$version-extension.zip"
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $bundle -Force
    Compress-Archive -Path 'extension/*' -DestinationPath $extensionZip -Force
    $artifacts = @($bundle, $extensionZip, "$output/netflix-remote.exe")
    $checksums = foreach ($file in $artifacts) {
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $([IO.Path]::GetFileName($file))"
    }
    [IO.File]::WriteAllLines((Join-Path $PSScriptRoot "$output/SHA256SUMS.txt"), $checksums, [Text.UTF8Encoding]::new($false))
    Get-Item ($artifacts + "$output/SHA256SUMS.txt") | Select-Object Name,Length
} finally {
    $env:NATIVE_HOST_EXE = $previousExe
    Pop-Location
}
