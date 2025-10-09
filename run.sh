#!/bin/bash
# ====================================================================
# Script de Ejecución - YOLO Annotator (Linux/Mac)
# ====================================================================
# 
# Este script ejecuta el backend y frontend automáticamente
#
# USO:
#   chmod +x run.sh
#   ./run.sh
#
# ====================================================================

echo ""
echo "========================================"
echo "  🚀 Iniciando YOLO Annotator"
echo "========================================"
echo ""

# Verificar que estamos en la carpeta correcta
if [ ! -d "./python" ] || [ ! -d "./angular" ]; then
    echo "❌ Error: Ejecuta este script desde la carpeta raíz del proyecto (Ponencia)"
    exit 1
fi

# Verificar que las dependencias están instaladas
if [ ! -d ".venv" ]; then
    echo "❌ Error: Entorno virtual no encontrado"
    echo "Ejecuta primero: ./install.sh"
    exit 1
fi

if [ ! -d "./angular/node_modules" ]; then
    echo "❌ Error: Dependencias de Angular no instaladas"
    echo "Ejecuta primero: ./install.sh"
    exit 1
fi

# ====================================================================
# DETECTAR SISTEMA OPERATIVO
# ====================================================================

OS="$(uname)"
case $OS in
    'Linux')
        TERMINAL='x-terminal-emulator'
        ;;
    'Darwin') 
        TERMINAL='Terminal'
        ;;
    *)
        echo "⚠️  Sistema operativo no soportado: $OS"
        echo "Ejecuta manualmente en dos terminales:"
        echo "  Terminal 1: source .venv/bin/activate && python3 python/app.py"
        echo "  Terminal 2: cd angular && ng serve"
        exit 1
        ;;
esac

# ====================================================================
# INICIAR BACKEND
# ====================================================================

echo "📍 Iniciando Backend (Python)..."

if [ "$OS" = "Darwin" ]; then
    # macOS
    osascript -e "tell application \"Terminal\" to do script \"cd '$(pwd)' && source .venv/bin/activate && python3 python/app.py\""
else
    # Linux
    x-terminal-emulator -e "bash -c 'cd $(pwd) && source .venv/bin/activate && python3 python/app.py; exec bash'" &
fi

echo "✅ Backend iniciado en nueva terminal"
echo ""

# Esperar 3 segundos para que el backend inicie
echo "⏳ Esperando a que el backend inicie (3s)..."
sleep 3

# ====================================================================
# INICIAR FRONTEND
# ====================================================================

echo "📍 Iniciando Frontend (Angular)..."

if [ "$OS" = "Darwin" ]; then
    # macOS
    osascript -e "tell application \"Terminal\" to do script \"cd '$(pwd)/angular' && ng serve\""
else
    # Linux
    x-terminal-emulator -e "bash -c 'cd $(pwd)/angular && ng serve; exec bash'" &
fi

echo "✅ Frontend iniciado en nueva terminal"
echo ""

# ====================================================================
# INFORMACIÓN
# ====================================================================

echo "========================================"
echo "  ✅ Aplicación iniciada"
echo "========================================"
echo ""
echo "Se han abierto 2 terminales:"
echo "  1. Backend (Python + pywebview)"
echo "  2. Frontend (Angular)"
echo ""
echo "La aplicación se abrirá automáticamente."
echo ""
echo "Para detener la aplicación:"
echo "  - Cierra ambas terminales"
echo "  - O presiona Ctrl+C en cada terminal"
echo ""
echo "========================================"
echo ""
