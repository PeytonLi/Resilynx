Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Resilynx - Starting All Services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$root = $PSScriptRoot
$root = Split-Path -Parent $root

# 1. Python venv
$venvPath = Join-Path $root "apps/nexla-service/.venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "[1/5] Creating Python virtual environment..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "apps/nexla-service")
    python -m venv .venv
    & ".\.venv\Scripts\Activate.ps1"
    pip install -e ".[dev]"
    deactivate
    Pop-Location
} else {
    Write-Host "[1/5] Python venv already exists" -ForegroundColor Green
}

# 2. Nexla service
Write-Host "[2/5] Starting Nexla Standardization Service (port 5001)..." -ForegroundColor Yellow
$nexlaJob = Start-Job -Name "resilynx-nexla" -ScriptBlock {
    param($r)
    Set-Location (Join-Path $r "apps/nexla-service")
    & ".\.venv\Scripts\python.exe" -m uvicorn nexla_service.server:app --app-dir src --port 5001 --log-level warning
} -ArgumentList $root
Start-Sleep -Seconds 3

# 3. Mock provider
Write-Host "[3/5] Starting Mock Grid Sensor (port 4001)..." -ForegroundColor Yellow
$mockJob = Start-Job -Name "resilynx-mock" -ScriptBlock {
    param($r)
    Set-Location (Join-Path $r "apps/mock-provider")
    bun run src/index.ts
} -ArgumentList $root
Start-Sleep -Seconds 2

# 4. Backend
Write-Host "[4/5] Starting Backend (port 8080)..." -ForegroundColor Yellow
$backendJob = Start-Job -Name "resilynx-backend" -ScriptBlock {
    param($r)
    Set-Location (Join-Path $r "apps/backend")
    bun run src/index.ts
} -ArgumentList $root
Start-Sleep -Seconds 2

# 5. Frontend
Write-Host "[5/5] Starting Frontend (port 3000)..." -ForegroundColor Yellow
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All services starting!" -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Backend:  http://localhost:8080" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Push-Location (Join-Path $root "apps/frontend")
pnpm dev
Pop-Location

# Cleanup
Write-Host "Stopping services..." -ForegroundColor Yellow
Stop-Job -Name "resilynx-nexla", "resilynx-mock", "resilynx-backend" -ErrorAction SilentlyContinue
Remove-Job -Name "resilynx-nexla", "resilynx-mock", "resilynx-backend" -ErrorAction SilentlyContinue
Write-Host "Done." -ForegroundColor Green
