# ====================================================================
# Script de Ejecución - YOLO Annotator
# ====================================================================
# 
# Este script ejecuta el backend y frontend automáticamente
# en terminales separadas.
#
# USO:
#   .\run.ps1
#
# ====================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  🚀 Iniciando YOLO Annotator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en la carpeta correcta
if (-not (Test-Path ".\python") -or -not (Test-Path ".\angular")) {
    Write-Host "❌ Error: Ejecuta este script desde la carpeta raíz del proyecto (Ponencia)" -ForegroundColor Red
    exit 1
}

# Verificar que las dependencias están instaladas
if (-not (Test-Path ".\.venv")) {
    Write-Host "❌ Error: Entorno virtual no encontrado" -ForegroundColor Red
    Write-Host "Ejecuta primero: .\install.ps1" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path ".\angular\node_modules")) {
    Write-Host "❌ Error: Dependencias de Angular no instaladas" -ForegroundColor Red
    Write-Host "Ejecuta primero: .\install.ps1" -ForegroundColor Yellow
    exit 1
}

# ====================================================================
# INICIAR BACKEND
# ====================================================================

Write-Host "📍 Iniciando Backend (Python)..." -ForegroundColor Yellow

# Obtener ruta absoluta actual
$currentPath = Get-Location

# Crear comando para backend
$backendCommand = "cd '$currentPath'; .\.venv\Scripts\Activate.ps1; python python\app.py"

# Iniciar backend en nueva terminal
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand

Write-Host "✅ Backend iniciado en nueva terminal" -ForegroundColor Green
Write-Host ""

# Esperar 3 segundos para que el backend inicie
Write-Host "⏳ Esperando a que el backend inicie (3s)..." -ForegroundColor Gray
Start-Sleep -Seconds 3

# ====================================================================
# INICIAR FRONTEND
# ====================================================================

Write-Host "📍 Iniciando Frontend (Angular)..." -ForegroundColor Yellow

# Crear comando para frontend
$frontendCommand = "cd '$currentPath\angular'; ng serve"

# Iniciar frontend en nueva terminal
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand

Write-Host "✅ Frontend iniciado en nueva terminal" -ForegroundColor Green
Write-Host ""

# ====================================================================
# INFORMACIÓN
# ====================================================================

Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ Aplicación iniciada" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Se han abierto 2 terminales:" -ForegroundColor Cyan
Write-Host "  1. Backend (Python + pywebview)" -ForegroundColor Yellow
Write-Host "  2. Frontend (Angular)" -ForegroundColor Yellow
Write-Host ""
Write-Host "La aplicación se abrirá automáticamente." -ForegroundColor Cyan
Write-Host ""
Write-Host "Para detener la aplicación:" -ForegroundColor Yellow
Write-Host "  - Cierra ambas terminales" -ForegroundColor Gray
Write-Host "  - O presiona Ctrl+C en cada terminal" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Mantener esta terminal abierta
Write-Host "Presiona cualquier tecla para cerrar esta ventana..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
