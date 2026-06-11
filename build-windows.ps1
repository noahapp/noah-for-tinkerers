# Noah Windows Build Script
# Usage (from project root):
#   powershell -File build-windows.ps1                    # Full release build
#   powershell -File build-windows.ps1 -Check             # Compile check only
#   powershell -File build-windows.ps1 -Upload             # Build + upload
#   powershell -File build-windows.ps1 -Tag v0.15.0       # Specific tag
#   powershell -File build-windows.ps1 -SkipInstall       # Skip pnpm install

param(
    [switch]$Check,
    [switch]$Upload,
    [string]$Tag,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ── Ensure tools are on PATH ──

$cargobin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargobin) { $env:PATH = "$cargobin;$env:PATH" }

$nvmDir = Join-Path $env:APPDATA "nvm"
if (Test-Path $nvmDir) {
    $nodeVer = Get-ChildItem $nvmDir -Directory |
        Where-Object { $_.Name -match '^v\d' } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($nodeVer) { $env:PATH = "$($nodeVer.FullName);$env:PATH" }
}

$pnpmHome = Join-Path $env:LOCALAPPDATA "pnpm"
if (Test-Path $pnpmHome) { $env:PATH = "$pnpmHome;$env:PATH" }

# ── Signing key ──

$keyFile = Join-Path $env:USERPROFILE ".tauri\noah.key"
if (Test-Path $keyFile) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
    $passwordFile = Join-Path $env:USERPROFILE ".tauri\noah.key.password"
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -and (Test-Path $passwordFile)) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content $passwordFile -Raw).Trim()
    }
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
        Write-Host "WARNING: TAURI_SIGNING_PRIVATE_KEY_PASSWORD not set; signed updater builds may fail." -ForegroundColor Yellow
    }
} else {
    Write-Host "WARNING: Signing key not found at $keyFile" -ForegroundColor Yellow
}

# ── Check-only mode ──

if ($Check) {
    Write-Host "==> Compile-checking noah-desktop..."
    cargo check -p noah-desktop
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "==> Compile check passed." -ForegroundColor Green
    exit 0
}

# ── Build / Release ──

Write-Host "==> Pulling latest..."
git pull

$argsList = @()
if ($Upload) { $argsList += '--upload' } else { $argsList += '--build' }
if ($Tag) { $argsList += @('--tag', $Tag) }
if ($SkipInstall) { $argsList += '--skip-install' }

node .\scripts\release.mjs @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$conf = Get-Content apps\desktop\src-tauri\tauri.conf.json | ConvertFrom-Json
$v = $conf.version
Write-Host "`n==> Done! Artifacts in target\release\bundle\" -ForegroundColor Green
