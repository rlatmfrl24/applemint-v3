$ErrorActionPreference = 'Stop'
$applemintRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$applemintNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $applemintNode)) {
    $applemintNode = (Get-Command node -ErrorAction Stop).Source
}
$applemintReports = Join-Path $applemintRoot 'reports'
New-Item -ItemType Directory -Path $applemintReports -Force | Out-Null
Start-Process -FilePath $applemintNode -ArgumentList @("`"$(Join-Path $PSScriptRoot 'watch-docker.mjs')`"") -WorkingDirectory $applemintRoot -WindowStyle Hidden -RedirectStandardError (Join-Path $applemintReports 'docker-auto-start-error.log')
