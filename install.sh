#!/bin/bash
# ====================================================================
# Script de Instalación Rápida - YOLO Annotator (Linux/Mac)
# ====================================================================
# 
# Este script instala automáticamente todas las dependencias necesarias
#
# USO:
#   chmod +x install.sh
#   ./install.sh
#
# ====================================================================

echo ""
echo "========================================"
echo "  YOLO Annotator - Instalación Rápida"
echo "========================================"
echo ""

# Verificar que estamos en la carpeta correcta
if [ ! -d "./python" ] || [ ! -d "./angular" ]; then
    echo "❌ Error: Ejecuta este script desde la carpeta raíz del proyecto (Ponencia)"
    exit 1
fi

# ====================================================================
# 1. VERIFICAR REQUISITOS PREVIOS
# ====================================================================

echo "📋 Verificando requisitos previos..."
echo ""

# Verificar Python
echo -n "Verificando Python... "
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✅ $PYTHON_VERSION"
else
    echo "❌ No encontrado"
    echo ""
    echo "Por favor instala Python 3.10+ desde: https://www.python.org/downloads/"
    exit 1
fi

# Verificar Node.js
echo -n "Verificando Node.js... "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node $NODE_VERSION"
else
    echo "❌ No encontrado"
    echo ""
    echo "Por favor instala Node.js 18+ desde: https://nodejs.org/"
    exit 1
fi

echo ""

# ====================================================================
# 2. INSTALAR DEPENDENCIAS DE PYTHON
# ====================================================================

echo "========================================"
echo "📦 Instalando dependencias de Python"
echo "========================================"
echo ""

# Crear entorno virtual si no existe
if [ ! -d ".venv" ]; then
    echo "Creando entorno virtual de Python..."
    python3 -m venv .venv
    if [ $? -ne 0 ]; then
        echo "❌ Error al crear entorno virtual"
        exit 1
    fi
    echo "✅ Entorno virtual creado"
else
    echo "✅ Entorno virtual ya existe"
fi

echo ""

# Activar entorno virtual e instalar dependencias
echo "Instalando dependencias de Python..."
source .venv/bin/activate

if [ -f "./python/requirements.txt" ]; then
    pip install -r ./python/requirements.txt
    if [ $? -ne 0 ]; then
        echo "❌ Error al instalar dependencias de Python"
        exit 1
    fi
else
    echo "❌ No se encontró python/requirements.txt"
    exit 1
fi

echo "✅ Dependencias de Python instaladas correctamente"
echo ""

# ====================================================================
# 3. INSTALAR DEPENDENCIAS DE ANGULAR
# ====================================================================

echo "========================================"
echo "📦 Instalando dependencias de Angular"
echo "========================================"
echo ""

cd angular

echo "Instalando dependencias de Angular..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Error al instalar dependencias de Angular"
    cd ..
    exit 1
fi

echo "✅ Dependencias de Angular instaladas correctamente"
echo ""

cd ..

# ====================================================================
# 4. VERIFICAR INSTALACIÓN
# ====================================================================

echo "========================================"
echo "✅ Verificando instalación"
echo "========================================"
echo ""

# Verificar dependencias de Python
echo -n "Verificando dependencias de Python... "
source .venv/bin/activate
PYTHON_TEST=$(python3 -c "import webview; import PIL; import yaml; print('OK')" 2>&1)

if [[ $PYTHON_TEST == *"OK"* ]]; then
    echo "✅"
else
    echo "⚠️  Advertencia: Algunas dependencias pueden faltar"
fi

# Verificar Angular CLI
echo -n "Verificando Angular CLI... "
cd angular
NG_TEST=$(ng version 2>&1)
cd ..

if [ $? -eq 0 ]; then
    echo "✅"
else
    echo "⚠️  Angular CLI no encontrado globalmente"
    echo "   Puedes instalarlo con: npm install -g @angular/cli"
fi

echo ""

# ====================================================================
# 5. RESUMEN FINAL
# ====================================================================

echo "========================================"
echo "  🎉 ¡Instalación Completada!"
echo "========================================"
echo ""
echo "Para ejecutar la aplicación:"
echo ""
echo "  Terminal 1 (Backend):"
echo "    source .venv/bin/activate"
echo "    python3 python/app.py"
echo ""
echo "  Terminal 2 (Frontend):"
echo "    cd angular"
echo "    ng serve"
echo ""
echo "O ejecuta:"
echo "    ./run.sh"
echo ""
echo "========================================"
echo ""
