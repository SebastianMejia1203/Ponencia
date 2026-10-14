# YOLO Annotation Studio

Herramienta de escritorio para preparar proyectos de visión artificial: gestionar imágenes, editar anotaciones, configurar datasets y ejecutar entrenamiento y predicciones con YOLO.

La interfaz está construida con Angular y se comunica con Python mediante el puente JavaScript de pywebview.

## Funcionalidades

- Creación, apertura y guardado de proyectos.
- Administración de imágenes, clases y anotaciones.
- Selección y verificación de datasets con configuración YAML.
- Inicio y detención de entrenamientos.
- Consulta de métricas, historial y matrices de confusión.
- Predicción sobre imágenes individuales o por lotes.
- Consulta de recursos del sistema y proyectos recientes.

## Tecnologías

Angular 20, TypeScript, Tailwind CSS, spartan/ui, Chart.js, Python, pywebview y utilidades de procesamiento de imágenes.

## Inicio en desarrollo

El lanzador actual utiliza WebView2/Edge Chromium en Windows y carga la interfaz desde `http://localhost:4200`.

1. Instala Node.js y npm compatibles con Angular 20, Python y el runtime WebView2.
2. Desde la raíz, inicia la interfaz:

```bash
cd angular
npm ci
npm start
```

3. En otra terminal, desde la raíz:

```bash
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r python/requirements.txt
python -m pip install ultralytics
python python/app.py
```

El archivo de requisitos del lanzador no incluye Ultralytics. Para entrenamiento e inferencia prepara también PyTorch y, si corresponde, su compatibilidad con GPU.

## Flujo de trabajo

Crea o abre un proyecto, importa imágenes, define clases y revisa las anotaciones. Después selecciona el YAML del dataset, configura el entrenamiento y consulta los resultados desde la interfaz.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `angular/` | Interfaz y componentes |
| `python/app.py` | Lanzador de escritorio |
| `python/app_core/api.py` | API expuesta a Angular |
| `python/app_core/constants.py` | Rutas y constantes |

## Compilación de la interfaz

Ejecuta `npm run build` dentro de `angular/`. El lanzador de desarrollo sigue esperando el servidor local; la compilación no genera por sí sola un instalador de escritorio.
