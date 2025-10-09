# 🎯 YOLO Annotator

Una aplicación de escritorio moderna para anotar imágenes en formato YOLO, diseñada para tareas de **detección de objetos** (bounding boxes) y **segmentación de instancias** (polígonos).

---

## ✨ Características Principales

- 🖼️ **Doble modo de anotación**:
  - Detección de objetos (bounding boxes)
  - Segmentación de instancias (polígonos)
  
- 📁 **Gestión de proyectos**:
  - Crear y abrir proyectos
  - Gestionar clases
  - Cargar y eliminar imágenes
  - Proyectos recientes
  
- 🎨 **Interfaz intuitiva**:
  - Zoom y pan en el área de trabajo
  - Navegación entre imágenes
  - Vista previa de thumbnails
  - Estadísticas del proyecto
  
- 💾 **Formato YOLO nativo**:
  - Compatible con YOLOv8, YOLOv9, YOLOv11
  - Genera automáticamente `data.yaml`
  - División train/val/test configurable
  - Exporta anotaciones en formato .txt y .json

- 📊 **Portabilidad**:
  - Proyectos relocalizables (rutas relativas)
  - Migración automática de proyectos antiguos
  - No depende de rutas absolutas

---

## 🚀 Inicio Rápido

### Requisitos
- Python 3.10+
- Node.js 18+
- npm o yarn

### Instalación

Ver **[INSTALACION.md](./INSTALACION.md)** para instrucciones detalladas.

**Resumen rápido:**

```powershell
# 1. Clonar o copiar el proyecto
cd Ponencia

# 2. Backend (Python)
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r python/requirements.txt

# 3. Frontend (Angular)
cd angular
npm install
```

### Ejecutar

```powershell
# Terminal 1 - Backend
cd Ponencia
.\.venv\Scripts\Activate.ps1
python python/app.py

# Terminal 2 - Frontend
cd Ponencia/angular
ng serve
```

La aplicación se abrirá automáticamente en una ventana de escritorio.

---

## 📖 Uso

### 1. Crear un proyecto nuevo

1. Click en **Archivo → Nuevo Proyecto**
2. Completa los datos:
   - Nombre del proyecto
   - Ubicación
   - Clases (objetos a detectar/segmentar)
   - Modo: Detección o Segmentación
3. Click en **Crear**

### 2. Cargar imágenes

1. **Proyecto → Cargar Imágenes**
2. Selecciona una carpeta con imágenes
3. Las imágenes se copiarán al proyecto

### 3. Anotar imágenes

#### Modo Detección (Bounding Boxes):
1. Selecciona una clase
2. Click y arrastra para crear una caja
3. Suelta para completar

#### Modo Segmentación (Polígonos):
1. Selecciona una clase
2. Click para agregar puntos
3. Click en **Completar Polígono** (mínimo 3 puntos)

### 4. Guardar y exportar

- **Archivo → Guardar Proyecto**: Guarda todas las anotaciones
- Las anotaciones se guardan en:
  - `labels/` - Formato YOLO (.txt)
  - `annotations/` - Formato JSON completo
- `data.yaml` - Configuración YOLO lista para entrenamiento

---

## 📂 Estructura del Proyecto

```
Ponencia/
├── python/                    # Backend Python
│   ├── app.py                # Punto de entrada
│   ├── requirements.txt      # Dependencias Python
│   ├── app_core/
│   │   ├── api.py           # Lógica principal de la API
│   │   └── constants.py     # Constantes del proyecto
│   └── migrate_project_paths.py  # Script de migración
│
├── angular/                   # Frontend Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── pages/       # Páginas de la aplicación
│   │   │   ├── components/  # Componentes reutilizables
│   │   │   └── services/    # Servicios de Angular
│   │   └── assets/          # Recursos estáticos
│   ├── package.json
│   └── angular.json
│
├── INSTALACION.md            # Guía de instalación detallada
└── README.md                 # Este archivo
```

### Estructura de un proyecto YOLO:

```
mi_proyecto/
├── project_config.json       # Configuración del proyecto
├── data.yaml                # Configuración YOLO
├── labels/                  # Anotaciones YOLO (.txt)
│   ├── imagen1.txt
│   └── imagen2.txt
├── annotations/             # Anotaciones JSON completas
│   ├── imagen1.json
│   └── imagen2.json
└── dataset/                 # Dataset organizado
    ├── train/
    │   ├── images/
    │   └── labels/
    ├── val/
    │   ├── images/
    │   └── labels/
    └── test/
        ├── images/
        └── labels/
```

---

## 🛠️ Tecnologías

### Backend
- **Python 3.10+**
- **pywebview** - Interfaz de aplicación de escritorio
- **Pillow** - Procesamiento de imágenes
- **PyYAML** - Lectura/escritura de archivos YAML

### Frontend
- **Angular 18+** - Framework web moderno
- **TypeScript** - Lenguaje tipado
- **Tailwind CSS** - Estilos utility-first
- **Spartan UI** - Componentes UI elegantes

---

## 📝 Formatos de Anotación

### Formato YOLO (.txt)

**Detección (Bounding Box):**
```
<class_id> <x_center> <y_center> <width> <height>
```

**Segmentación (Polígono):**
```
<class_id> <x1> <y1> <x2> <y2> <x3> <y3> ...
```

Todas las coordenadas son **normalizadas** (0.0 - 1.0)

### Formato JSON

Anotaciones completas con metadatos:
```json
{
  "filename": "imagen1.jpg",
  "annotations": [
    {
      "id": 1,
      "className": "perro",
      "x": 100,
      "y": 150,
      "width": 200,
      "height": 180
    }
  ]
}
```

---

## 🔧 Configuración Avanzada

### Cambiar divisiones del dataset

Edita `project_config.json`:
```json
{
  "splits": {
    "train": 70,
    "val": 20,
    "test": 10
  }
}
```

### Migrar proyectos antiguos

Si tienes proyectos con rutas absolutas:
```powershell
python python/migrate_project_paths.py "ruta/al/proyecto"
```

---

## 🐛 Solución de Problemas

Ver **[INSTALACION.md](./INSTALACION.md)** sección "Solución de Problemas".

Problemas comunes:
- ✅ Error "ng not found" → Instala Angular CLI: `npm install -g @angular/cli`
- ✅ Error "pywebview not found" → Activa el entorno virtual y reinstala dependencias
- ✅ Imágenes no se cargan → Verifica permisos de la carpeta del proyecto

---

## 📊 Roadmap

- [ ] Soporte para múltiples formatos de exportación (COCO, Pascal VOC)
- [ ] Integración con YOLO para entrenamiento directo
- [ ] Auto-anotación con modelos pre-entrenados
- [ ] Herramientas de augmentación de datos
- [ ] Exportación a formatos de otros frameworks

---

## 🤝 Contribuir

Contribuciones son bienvenidas. Para cambios mayores:

1. Fork el repositorio
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

---

## 📄 Licencia

Este proyecto es de código abierto. Ver archivo LICENSE para más detalles.

---

## 👨‍💻 Autor

Desarrollado para la ponencia sobre Computer Vision y YOLO.

---

## 📞 Soporte

Si encuentras bugs o tienes sugerencias:
1. Abre un issue en el repositorio
2. Incluye capturas de pantalla si es posible
3. Describe los pasos para reproducir el problema

---

**¡Feliz anotación! 🎉**
