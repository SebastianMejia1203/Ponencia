# ====================================================================
# Script de Instalación Rápida - YOLO Annotator
# ====================================================================
# 
# Este script instala automáticamente todas las dependencias necesarias
# para ejecutar la aplicación en Windows.
#
# USO:
#   .\install.ps1
#
# ====================================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  YOLO Annotator - Instalación Rápida" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en la carpeta correcta
if (-not (Test-Path ".\python") -or -not (Test-Path ".\angular")) {
    Write-Host "❌ Error: Ejecuta este script desde la carpeta raíz del proyecto (Ponencia)" -ForegroundColor Red
    exit 1
}

# ====================================================================
# 1. VERIFICAR REQUISITOS PREVIOS
# ====================================================================

Write-Host "📋 Verificando requisitos previos..." -ForegroundColor Yellow
Write-Host ""

# Verificar Python
Write-Host "Verificando Python..." -NoNewline
try {
    $pythonVersion = python --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✅ $pythonVersion" -ForegroundColor Green
    } else {
        throw
    }
} catch {
    Write-Host " ❌ No encontrado" -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor instala Python 3.10+ desde: https://www.python.org/downloads/" -ForegroundColor Yellow
    exit 1
}

# Verificar Node.js
Write-Host "Verificando Node.js..." -NoNewline
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host " ✅ $nodeVersion" -ForegroundColor Green
    } else {
        throw
    }
} catch {
    Write-Host " ❌ No encontrado" -ForegroundColor Red
    Write-Host ""
    Write-Host "Por favor instala Node.js 18+ desde: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# ====================================================================
# 2. INSTALAR DEPENDENCIAS DE PYTHON
# ====================================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📦 Instalando dependencias de Python" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Crear entorno virtual si no existe
if (-not (Test-Path ".\.venv")) {
    Write-Host "Creando entorno virtual de Python..." -ForegroundColor Yellow
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error al crear entorno virtual" -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Entorno virtual creado" -ForegroundColor Green
} else {
    Write-Host "✅ Entorno virtual ya existe" -ForegroundColor Green
}

Write-Host ""

# Activar entorno virtual e instalar dependencias
Write-Host "Instalando dependencias de Python..." -ForegroundColor Yellow
& ".\.venv\Scripts\Activate.ps1"

if (Test-Path ".\python\requirements.txt") {
    pip install -r .\python\requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error al instalar dependencias de Python" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "❌ No se encontró python/requirements.txt" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Dependencias de Python instaladas correctamente" -ForegroundColor Green
Write-Host ""

# ====================================================================
# 3. INSTALAR DEPENDENCIAS DE ANGULAR
# ====================================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📦 Instalando dependencias de Angular" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location .\angular

Write-Host "Instalando dependencias de Angular..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al instalar dependencias de Angular" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Write-Host "✅ Dependencias de Angular instaladas correctamente" -ForegroundColor Green
Write-Host ""

Set-Location ..

# ====================================================================
# 4. VERIFICAR INSTALACIÓN
# ====================================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ Verificando instalación" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Verificar dependencias de Python
Write-Host "Verificando dependencias de Python..." -NoNewline
& ".\.venv\Scripts\Activate.ps1"
$pythonTest = python -c "import webview; import PIL; import yaml; print('OK')" 2>&1

if ($pythonTest -like "*OK*") {
    Write-Host " ✅" -ForegroundColor Green
} else {
    Write-Host " ⚠️  Advertencia: Algunas dependencias pueden faltar" -ForegroundColor Yellow
}

# Verificar Angular CLI
Write-Host "Verificando Angular CLI..." -NoNewline
Set-Location .\angular
$ngTest = ng version 2>&1
Set-Location ..

if ($LASTEXITCODE -eq 0) {
    Write-Host " ✅" -ForegroundColor Green
} else {
    Write-Host " ⚠️  Angular CLI no encontrado globalmente" -ForegroundColor Yellow
    Write-Host "   Puedes instalarlo con: npm install -g @angular/cli" -ForegroundColor Gray
}

Write-Host ""

# ====================================================================
# 5. RESUMEN FINAL
# ====================================================================

Write-Host "========================================" -ForegroundColor Green
Write-Host "  🎉 ¡Instalación Completada!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Para ejecutar la aplicación:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Terminal 1 (Backend):" -ForegroundColor Yellow
Write-Host "    .\.venv\Scripts\Activate.ps1" -ForegroundColor Gray
Write-Host "    python python\app.py" -ForegroundColor Gray
Write-Host ""
Write-Host "  Terminal 2 (Frontend):" -ForegroundColor Yellow
Write-Host "    cd angular" -ForegroundColor Gray
Write-Host "    ng serve" -ForegroundColor Gray
Write-Host ""
Write-Host "O ejecuta:" -ForegroundColor Yellow
Write-Host "    .\run.ps1" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
