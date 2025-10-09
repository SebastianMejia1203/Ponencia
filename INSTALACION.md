# 📦 Guía de Instalación - YOLO Annotator

Esta guía te ayudará a instalar todas las dependencias necesarias en una nueva computadora.

---

## 📋 Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

1. **Node.js** (versión 18 o superior)
   - Descargar desde: https://nodejs.org/
   - Verificar instalación: `node --version`

2. **Python** (versión 3.10 o superior)
   - Descargar desde: https://www.python.org/downloads/
   - Verificar instalación: `python --version`

3. **Git** (opcional, para clonar el repositorio)
   - Descargar desde: https://git-scm.com/

---

## 🚀 Pasos de Instalación

### 1️⃣ Clonar o Copiar el Proyecto

Si usas Git:
```bash
git clone <URL_DEL_REPOSITORIO>
cd Ponencia
```

Si copias manualmente:
- Copia toda la carpeta `Ponencia` a tu computadora

---

### 2️⃣ Instalar Dependencias del Backend (Python)

#### Paso 2.1: Crear entorno virtual
```powershell
# Navega a la carpeta raíz del proyecto
cd Ponencia

# Crea un entorno virtual
python -m venv .venv
```

#### Paso 2.2: Activar el entorno virtual

**En Windows (PowerShell):**
```powershell
.\.venv\Scripts\Activate.ps1
```

**En Windows (CMD):**
```cmd
.venv\Scripts\activate.bat
```

**En Linux/Mac:**
```bash
source .venv/bin/activate
```

#### Paso 2.3: Instalar dependencias de Python
```powershell
# Asegúrate de estar en la carpeta raíz y con el entorno virtual activado
pip install -r python/requirements.txt
```

Si no existe `requirements.txt`, instala manualmente:
```powershell
pip install pywebview pillow pyyaml
```

---

### 3️⃣ Instalar Dependencias del Frontend (Angular)

#### Paso 3.1: Navega a la carpeta Angular
```powershell
cd angular
```

#### Paso 3.2: Instalar dependencias con npm
```powershell
npm install
```

Este comando instalará todas las dependencias listadas en `package.json`, incluyendo:
- Angular 18+
- Spartan UI components
- Tailwind CSS
- Y todas las demás librerías necesarias

---

## ▶️ Ejecutar la Aplicación

### Opción 1: Ejecutar Backend y Frontend por separado

**Terminal 1 - Backend (Python):**
```powershell
# Desde la carpeta raíz, con entorno virtual activado
cd Ponencia
.\.venv\Scripts\Activate.ps1
python python/app.py
```

**Terminal 2 - Frontend (Angular):**
```powershell
# Desde la carpeta angular
cd Ponencia/angular
ng serve
```

### Opción 2: Usar script de inicio (si existe)

Si hay un script de inicio, ejecuta:
```powershell
npm start
```

---

## 🔧 Verificar Instalación

### Verificar Backend:
```powershell
# Activar entorno virtual
.\.venv\Scripts\Activate.ps1

# Verificar que las librerías están instaladas
python -c "import pywebview; import PIL; import yaml; print('✅ Todas las dependencias de Python instaladas correctamente')"
```

### Verificar Frontend:
```powershell
cd angular
ng version
```

Deberías ver la versión de Angular CLI y todas las dependencias instaladas.

---

## 📝 Generar requirements.txt (Para desarrolladores)

Si no existe `requirements.txt` o necesitas actualizarlo:

```powershell
# Con el entorno virtual activado
pip freeze > python/requirements.txt
```

Esto creará un archivo con todas las dependencias exactas instaladas.

---

## 🐛 Solución de Problemas Comunes

### Problema: "ng: The term 'ng' is not recognized"
**Solución:** Instala Angular CLI globalmente:
```powershell
npm install -g @angular/cli
```

### Problema: "python: command not found"
**Solución:** 
- Asegúrate de que Python esté instalado
- Agrega Python al PATH del sistema
- En Windows, reinstala Python marcando "Add Python to PATH"

### Problema: "Execution of scripts is disabled"
**Solución:** Ejecuta PowerShell como administrador y ejecuta:
```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Problema: "No module named 'pywebview'"
**Solución:** 
```powershell
# Activa el entorno virtual primero
.\.venv\Scripts\Activate.ps1
pip install pywebview pillow pyyaml
```

### Problema: Error de compilación de Angular
**Solución:**
```powershell
# Limpia cache de npm e reinstala
cd angular
rm -rf node_modules
rm package-lock.json
npm install
```

---

## 📦 Estructura de Dependencias

### Backend (Python):
```
pywebview>=4.0       # Interfaz de aplicación de escritorio
Pillow>=10.0         # Procesamiento de imágenes
PyYAML>=6.0          # Lectura/escritura de archivos YAML
```

### Frontend (Angular):
```
@angular/core        # Framework Angular
@spartan-ng/*        # Componentes UI
tailwindcss          # Estilos CSS
typescript           # Lenguaje TypeScript
```

Ver `angular/package.json` para la lista completa.

---

## 🎯 Próximos Pasos

Después de la instalación:

1. ✅ Ejecuta el backend: `python python/app.py`
2. ✅ Ejecuta el frontend: `ng serve`
3. ✅ Abre el navegador en `http://localhost:4200`
4. ✅ Crea tu primer proyecto de anotación

---

## 📞 Soporte

Si encuentras problemas durante la instalación:

1. Verifica que tienes las versiones correctas de Node.js y Python
2. Asegúrate de estar en la carpeta correcta al ejecutar comandos
3. Revisa la sección de "Solución de Problemas" arriba
4. Consulta los logs de error para más detalles

---

**¡Listo para comenzar a anotar! 🎉**
