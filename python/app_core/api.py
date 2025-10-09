import json
import base64
from pathlib import Path
from typing import List, Dict, Any
import threading, time
import subprocess
import sys
import os
import signal
import re
import psutil
import GPUtil
from datetime import datetime

from .constants import PROJECT_STATE_FILE, ANNOTATIONS_DIR, IMAGE_EXTS, ensure_dir
import webview

class Api:
    """API expuesta a la capa web via pywebview.
    Métodos públicos son invocados desde JS y deben ser thread-safe.
    """
    def __init__(self):
        self.current_project: Path | None = None
        self.images: List[Path] = []
        self.annotations_index: Dict[str, Path] = {}
        self._train_thread = None
        self._stop_flag = False
        self._last_params: Dict[str, Any] = {}
        self._yaml_path: Path | None = None
        self._train_process = None
        # Sistema de logs mejorado
        self._last_logs: Dict[int, int] = {}  # Para deduplicación (hash -> count)
        self._training_data = {
            'current_epoch': 0,
            'total_epochs': 0,
            'download_progress': 0,
            'metrics_history': [],
            'model_summary': {},
            'training_status': 'idle'  # idle, downloading, training, validating, completed, error
        }
        # Atributos para el control de logs mostrados
        self._shown_progress: set = set()
        self._shown_validation: set = set()
        self._shown_cache: set = set()
        self._shown_epochs: set = set()

    # --- Utilidades internas ---
    def _ensure_project_open(self):
        if not self.current_project:
            raise RuntimeError('No hay proyecto abierto')

    def _project_dir(self) -> Path:
        self._ensure_project_open()
        return self.current_project  # type: ignore

    def _annotations_dir(self) -> Path:
        d = self._project_dir() / ANNOTATIONS_DIR
        d.mkdir(exist_ok=True)
        return d

    def _read_training_metrics(self, train_dir: Path, task: str) -> Dict[str, float]:
        """Lee las métricas de entrenamiento desde results.csv
        
        Args:
            train_dir: Directorio de entrenamiento (ej: runs/train, runs/detect/train)
            task: Tipo de tarea ('detect' o 'segment')
            
        Returns:
            Dict con métricas: mAP, precision, recall (o valores por defecto si no existe el archivo)
        """
        metrics = {
            'mAP': 0.0,
            'precision': 0.0,
            'recall': 0.0,
            'epochs': 0
        }
        
        try:
            results_csv = train_dir / 'results.csv'
            if not results_csv.exists():
                return metrics
            
            import csv
            
            # Leer el archivo CSV
            with open(results_csv, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                
                if not rows:
                    return metrics
                
                # Tomar la última fila (última época)
                last_row = rows[-1]
                
                # Extraer métricas según el tipo de tarea
                # Para segmentación: usar métricas de máscaras (M)
                # Para detección: usar métricas de boxes (B)
                if task == 'segment':
                    # Métricas de máscaras
                    metrics['mAP'] = float(last_row.get('metrics/mAP50(M)', 0.0))
                    metrics['precision'] = float(last_row.get('metrics/precision(M)', 0.0))
                    metrics['recall'] = float(last_row.get('metrics/recall(M)', 0.0))
                else:
                    # Métricas de boxes (detección)
                    metrics['mAP'] = float(last_row.get('metrics/mAP50(B)', 0.0))
                    metrics['precision'] = float(last_row.get('metrics/precision(B)', 0.0))
                    metrics['recall'] = float(last_row.get('metrics/recall(B)', 0.0))
                
                # Número de épocas (última época registrada)
                metrics['epochs'] = int(last_row.get('epoch', len(rows)))
                
        except Exception as e:
            print(f"[_read_training_metrics] Error leyendo results.csv: {e}")
        
        return metrics

    def _load_images(self):
        """Carga imágenes desde las ubicaciones soportadas.

        Prioridad/orden:
          1. dataset/train/images
          2. dataset/val/images
          3. dataset/test/images

        Todas se listan de forma plana (solo nombres) para mantener compatibilidad actual.
        Si existen duplicados de nombre en diferentes carpetas, se toma la primera aparición
        (conserva correspondencia anotaciones simples por nombre).
        """
        print('[Api._load_images] Iniciando carga de imágenes...')
        print(f'[Api._load_images] Directorio del proyecto: {self._project_dir()}')
        
        roots = [
            self._project_dir() / 'dataset' / 'train' / 'images',
            self._project_dir() / 'dataset' / 'val' / 'images',
            self._project_dir() / 'dataset' / 'test' / 'images',
        ]
        
        print(f'[Api._load_images] Buscando imágenes en {len(roots)} ubicaciones:')
        for root in roots:
            print(f'  - {root} (existe: {root.exists()})')
        
        collected = {}
        for dir_path in roots:
            try:
                if not dir_path.exists():
                    continue
                
                images_in_dir = []
                for p in dir_path.iterdir():
                    if p.suffix.lower() in IMAGE_EXTS and p.name not in collected:
                        collected[p.name] = p
                        images_in_dir.append(p.name)
                
                if images_in_dir:
                    print(f'[Api._load_images] Encontradas {len(images_in_dir)} imágenes en {dir_path}')
            except Exception as e:
                print('[Api._load_images] Error leyendo', dir_path, e)
        
        # Orden alfabético por nombre
        self.images = [collected[k] for k in sorted(collected.keys())]
        print(f'[Api._load_images] Total imágenes cargadas: {len(self.images)}')
        if self.images:
            print(f'[Api._load_images] Primeras 5 imágenes: {[img.name for img in self.images[:5]]}')
        
        # Mapear anotaciones (en carpeta de anotaciones central)
        self.annotations_index = {img.name: self._annotations_dir() / f"{img.stem}.json" for img in self.images}

    # ---------- Utilidad: enviar log al front ----------
    def _push_log(self, msg: str):
        try:
            # Evitar logs duplicados
            msg_hash = hash(msg)
            if msg_hash in self._last_logs:
                self._last_logs[msg_hash] += 1
                if self._last_logs[msg_hash] > 2:  # Mostrar máximo 2 veces
                    return
            else:
                self._last_logs[msg_hash] = 1
            
            # Parsear datos estructurados del log
            parsed_data = self._parse_training_log(msg)
            
            if webview.windows:
                w = webview.windows[0]
                # Enviar tanto el log como datos estructurados
                w.evaluate_js(f"window.__pushLog({repr(msg)})")
                if parsed_data:
                    w.evaluate_js(f"window.__updateTrainingData({repr(parsed_data)})")
            else:
                print(f"[TRAINING LOG] {msg}")
        except Exception as e:
            print(f'[Api._push_log] error: {e} - mensaje: {msg}')
    
    def _parse_training_log(self, msg: str) -> Dict[str, Any] | None:
        """Parsea logs para extraer datos estructurados"""
        import re
        
        # Progreso de descarga
        download_match = re.search(r'Downloading.*?(\d+)%.*?(\d+(?:\.\d+)?[KMGT]?B)/(\d+(?:\.\d+)?[KMGT]?B)', msg)
        if download_match:
            progress = int(download_match.group(1))
            downloaded = download_match.group(2)
            total = download_match.group(3)
            self._training_data['download_progress'] = progress
            self._training_data['training_status'] = 'downloading'
            return {
                'type': 'download_progress',
                'progress': progress,
                'downloaded': downloaded,
                'total': total
            }
        
        # Inicio de entrenamiento con épocas totales
        epoch_start_match = re.search(r'Starting training for (\d+) epochs', msg)
        if epoch_start_match:
            total_epochs = int(epoch_start_match.group(1))
            self._training_data['total_epochs'] = total_epochs
            self._training_data['current_epoch'] = 0
            self._training_data['training_status'] = 'training'
            return {
                'type': 'training_start',
                'total_epochs': total_epochs
            }
        
        # Progreso de época - Segmentación (4 pérdidas: box, seg, cls, dfl)
        epoch_seg_match = re.search(r'(\d+)/(\d+)\s+\d+G\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+):', msg)
        if epoch_seg_match:
            current_epoch = int(epoch_seg_match.group(1))
            total_epochs = int(epoch_seg_match.group(2))
            box_loss = float(epoch_seg_match.group(3))
            seg_loss = float(epoch_seg_match.group(4))
            cls_loss = float(epoch_seg_match.group(5))
            dfl_loss = float(epoch_seg_match.group(6))
            instances = int(epoch_seg_match.group(7))
            img_size = int(epoch_seg_match.group(8))
            
            self._training_data['current_epoch'] = current_epoch
            self._training_data['total_epochs'] = total_epochs
            
            metrics = {
                'epoch': current_epoch,
                'box_loss': box_loss,
                'seg_loss': seg_loss,
                'cls_loss': cls_loss,
                'dfl_loss': dfl_loss,
                'instances': instances,
                'image_size': img_size
            }
            
            self._training_data['metrics_history'].append(metrics)
            
            return {
                'type': 'epoch_progress',
                'current_epoch': current_epoch,
                'total_epochs': total_epochs,
                'metrics': metrics,
                'progress_percent': (current_epoch / total_epochs) * 100
            }
        
        # Progreso de época - Detección (3 pérdidas: box, cls, dfl)
        epoch_det_match = re.search(r'(\d+)/(\d+)\s+\d+G\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\d+):', msg)
        if epoch_det_match:
            current_epoch = int(epoch_det_match.group(1))
            total_epochs = int(epoch_det_match.group(2))
            box_loss = float(epoch_det_match.group(3))
            cls_loss = float(epoch_det_match.group(4))
            dfl_loss = float(epoch_det_match.group(5))
            instances = int(epoch_det_match.group(6))
            img_size = int(epoch_det_match.group(7))
            
            self._training_data['current_epoch'] = current_epoch
            self._training_data['total_epochs'] = total_epochs
            
            metrics = {
                'epoch': current_epoch,
                'box_loss': box_loss,
                'seg_loss': 0,  # No hay seg_loss en detección
                'cls_loss': cls_loss,
                'dfl_loss': dfl_loss,
                'instances': instances,
                'image_size': img_size
            }
            
            self._training_data['metrics_history'].append(metrics)
            
            return {
                'type': 'epoch_progress',
                'current_epoch': current_epoch,
                'total_epochs': total_epochs,
                'metrics': metrics,
                'progress_percent': (current_epoch / total_epochs) * 100
            }
        
        # Resumen del modelo
        summary_match = re.search(r'(YOLO\w+-seg|YOLO\w+) summary.*?(\d+) layers, ([\d,]+) parameters', msg)
        if summary_match:
            model_name = summary_match.group(1)
            layers = int(summary_match.group(2))
            parameters = summary_match.group(3).replace(',', '')
            
            self._training_data['model_summary'] = {
                'name': model_name,
                'layers': layers,
                'parameters': parameters
            }
            
            return {
                'type': 'model_summary',
                'model_name': model_name,
                'layers': layers,
                'parameters': parameters
            }
        
        # Finalización exitosa
        if 'epochs completed' in msg:
            self._training_data['training_status'] = 'completed'
            return {
                'type': 'training_completed',
                'status': 'success'
            }
        
        # Inicio de validación
        if 'Validating' in msg and 'best.pt' in msg:
            self._training_data['training_status'] = 'validating'
            return {
                'type': 'validation_start'
            }
        
        return None

    # ---------- Seleccionar YAML ----------
    def select_dataset_yaml(self):
        try:
            win = webview.windows[0]
            open_type = getattr(webview, 'OPEN_DIALOG', 0)
            # Algunos backends aceptan filtros; usamos fallback simple
            result = win.create_file_dialog(open_type, allow_multiple=False, directory='.')
            if not result:
                return {'ok': False}
            p = Path(result[0]).expanduser().resolve()
            if p.suffix.lower() != '.yaml' and p.suffix.lower() != '.yml':
                return {'ok': False, 'error': 'Selecciona un archivo .yaml'}
            self._yaml_path = p
            return {'ok': True, 'path': str(p)}
        except Exception as e:
            return {'ok': False, 'error': str(e)}
    
    def set_dataset_yaml_path(self, yaml_path: str):
        """Establece la ruta del dataset YAML (usado cuando se carga automáticamente desde un proyecto)"""
        try:
            print(f"[set_dataset_yaml_path] Recibiendo ruta: {yaml_path}")
            
            # Normalizar la ruta para Windows
            if os.name == 'nt':
                yaml_path = yaml_path.replace('/', '\\')
            
            p = Path(yaml_path).expanduser().resolve()
            print(f"[set_dataset_yaml_path] Ruta resuelta: {p}")
            print(f"[set_dataset_yaml_path] Existe: {p.exists()}")
            
            if not p.exists():
                error_msg = f'Archivo YAML no encontrado en: {p}'
                print(f"[set_dataset_yaml_path] ERROR: {error_msg}")
                return {'ok': False, 'error': error_msg}
            
            if p.suffix.lower() not in ('.yaml', '.yml'):
                return {'ok': False, 'error': 'El archivo debe ser .yaml o .yml'}
            
            self._yaml_path = p
            print(f"[set_dataset_yaml_path] Ruta del dataset establecida correctamente: {self._yaml_path}")
            return {'ok': True, 'path': str(p)}
        except Exception as e:
            print(f"[set_dataset_yaml_path] Error: {e}")
            return {'ok': False, 'error': str(e)}
    
    def verify_dataset(self, yaml_path: str):
        """Verifica un dataset YOLO y retorna información sobre imágenes y clases"""
        import yaml
        try:
            # Log de depuración
            print(f"[verify_dataset] Recibido yaml_path: {yaml_path}")
            print(f"[verify_dataset] Tipo: {type(yaml_path)}")
            
            # Normalizar la ruta para Windows
            # Reemplazar barras diagonales por backslash en Windows
            if os.name == 'nt':
                yaml_path = yaml_path.replace('/', '\\')
            
            yaml_file = Path(yaml_path).expanduser().resolve()
            print(f"[verify_dataset] Ruta resuelta: {yaml_file}")
            print(f"[verify_dataset] Existe: {yaml_file.exists()}")
            
            if not yaml_file.exists():
                error_msg = f'Archivo YAML no encontrado en: {yaml_file}'
                print(f"[verify_dataset] ERROR: {error_msg}")
                return {'ok': False, 'error': error_msg}
                
            with open(yaml_file, 'r', encoding='utf-8') as f:
                dataset_config = yaml.safe_load(f)
            
            # Obtener rutas de datasets
            dataset_root = yaml_file.parent
            if 'path' in dataset_config and dataset_config['path'] != '.':
                # Si hay un path específico en el YAML, usarlo
                dataset_root = Path(dataset_config['path'])
                if not dataset_root.is_absolute():
                    dataset_root = yaml_file.parent / dataset_config['path']
            
            # Rutas de imágenes
            train_path = dataset_root / dataset_config.get('train', 'train/images')
            val_path = dataset_root / dataset_config.get('val', 'val/images') 
            test_path = dataset_root / dataset_config.get('test', 'test/images')
            
            # Contar imágenes
            def count_images(path: Path) -> int:
                if not path.exists():
                    return 0
                # Usar un set para evitar contar archivos duplicados con diferentes extensiones
                image_files = set()
                for ext in ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif']:
                    # Buscar archivos con extensión en minúsculas y mayúsculas
                    # pero usar el nombre completo en minúsculas para evitar duplicados
                    for file in path.glob(f'*{ext}'):
                        image_files.add(file.name.lower())
                    for file in path.glob(f'*{ext.upper()}'):
                        image_files.add(file.name.lower())
                return len(image_files)
            
            train_images = count_images(train_path)
            val_images = count_images(val_path)
            test_images = count_images(test_path) if test_path != val_path else 0
            
            # Obtener información de clases
            class_names = []
            total_classes = 0
            
            if 'names' in dataset_config:
                if isinstance(dataset_config['names'], dict):
                    # Formato: {0: 'clase1', 1: 'clase2'}
                    class_names = [dataset_config['names'][i] for i in sorted(dataset_config['names'].keys())]
                elif isinstance(dataset_config['names'], list):
                    # Formato: ['clase1', 'clase2']
                    class_names = dataset_config['names']
                total_classes = len(class_names)
            elif 'nc' in dataset_config:
                # Solo número de clases sin nombres
                total_classes = dataset_config['nc']
                class_names = [f'clase_{i}' for i in range(total_classes)]
            
            return {
                'ok': True,
                'data': {
                    'train_images': train_images,
                    'val_images': val_images,
                    'test_images': test_images,
                    'total_classes': total_classes,
                    'class_names': class_names,
                    'dataset_path': str(dataset_root),
                    'train_path': str(train_path),
                    'val_path': str(val_path),
                    'test_path': str(test_path) if test_path != val_path else None
                }
            }
            
        except yaml.YAMLError as e:
            return {'ok': False, 'error': f'Error leyendo archivo YAML: {e}'}
        except Exception as e:
            return {'ok': False, 'error': f'Error verificando dataset: {e}'}
        
    # ---------- Iniciar / detener entrenamiento ----------
    def start_training(self, task: str, params: Dict[str, Any]):
        """
        task: 'detect' | 'segment'
        params: dict con llaves de YOLO (model, epochs, batch, imgsz, lr0, device, name, project, etc.)
        """
        self._push_log(f'🔍 DEBUG: Recibido task="{task}", params={params}')
        
        if task not in ('detect', 'segment'):
            return {'ok': False, 'error': "task debe ser 'detect' o 'segment'"}
        if not self._yaml_path:
            return {'ok': False, 'error': 'Primero selecciona el dataset .yaml'}

        if self._train_thread and self._train_thread.is_alive():
            return {'ok': False, 'error': 'Ya hay un entrenamiento corriendo'}

        # Guarda y normaliza params
        self._last_params = dict(params or {})
        # Alias convenientes desde tu UI
        if 'learningRate' in self._last_params and 'lr0' not in self._last_params:
            self._last_params['lr0'] = float(self._last_params['learningRate'])
        if 'epochs' in self._last_params:
            self._last_params['epochs'] = int(self._last_params['epochs'])
        if 'batch' in self._last_params:
            self._last_params['batch'] = int(self._last_params['batch'])
        if 'imgsz' in self._last_params:
            self._last_params['imgsz'] = int(self._last_params['imgsz'])

        # Reiniciar datos de entrenamiento
        self.reset_training_data()
        self._training_data['total_epochs'] = int(self._last_params.get('epochs', 10))

        self._stop_flag = False
        self._train_thread = threading.Thread(target=self._train_worker, args=(task,), daemon=True)
        self._train_thread.start()
        return {'ok': True}

    def stop_training(self):
        self._push_log('🛑 Iniciando detención del entrenamiento...')
        self._stop_flag = True
        if self._train_process and self._train_process.poll() is None:
            try:
                self._train_process.terminate()
                self._push_log('📡 Señal de terminación enviada al proceso')
            except Exception as e:
                self._push_log(f'❌ Error terminando proceso: {e}')
        else:
            self._push_log('ℹ️ No hay proceso activo para detener')
        return {'ok': True}

    # ---------- Worker de entrenamiento ----------
    def _train_worker(self, task: str):
        self._push_log('== Entrenamiento iniciado ==')
        
        # Primero intentar con subprocess, si falla usar método directo
        success = self._train_with_subprocess(task)
        if not success and not self._stop_flag:
            # Solo usar método directo si falló Y no fue detenido por el usuario
            self._push_log('Subprocess falló, intentando método directo...')
            self._train_with_direct_yolo(task)
        elif self._stop_flag:
            self._push_log('✅ Entrenamiento detenido por el usuario')
    
    def _train_with_subprocess(self, task: str) -> bool:
        """Intenta entrenar usando subprocess. Retorna True si es exitoso."""
        try:
            # Construir el comando para ejecutar YOLO en un proceso separado
            model_path = self._last_params.get('model') or self._last_params.get('weights') or (
                'yolo11n.pt' if task == 'detect' else 'yolo11n-seg.pt'
            )
            
            self._push_log(f'🎯 Tarea: {task}')
            self._push_log(f'🤖 Modelo original: {self._last_params.get("model", "no especificado")}')
            self._push_log(f'🔧 Modelo final: {model_path}')
            self._push_log(f'📊 Dataset: {self._yaml_path}')
            self._push_log('⚙️ Preparando comando de entrenamiento...')
            
            # Obtener la ruta del ejecutable yolo en el entorno virtual
            venv_path = Path(sys.executable).parent
            yolo_executable = venv_path / 'yolo.exe' if os.name == 'nt' else venv_path / 'yolo'
            
            # Verificar que el ejecutable existe
            if not yolo_executable.exists():
                self._push_log(f'ERROR: No se encontró el ejecutable yolo en {yolo_executable}')
                self._push_log('Intenta reinstalar ultralytics: pip install ultralytics')
                return False
            
            self._push_log(f'Usando ejecutable: {yolo_executable}')
            
            # Construir comando yolo con la sintaxis correcta
            # Formato: yolo train task=segment args... (para segmentación)
            # Formato: yolo train args... (para detección - por defecto)
            cmd = [str(yolo_executable), 'train']
            
            self._push_log(f'🎯 Tarea seleccionada: {task}')
            
            # Agregar parámetros en formato key=value
            cmd.append(f'data={self._yaml_path}')
            cmd.append(f'model={model_path}')
            
            # Mapear parámetros desde la UI evitando duplicaciones
            params_added = set()
            
            # Mapear parámetros desde la UI
            param_mapping = {
                'epochs': 'epochs',
                'batch': 'batch',
                'imgsz': 'imgsz', 
                'device': 'device',
                'name': 'name',
                'project': 'project'
            }
            
            # Agregar parámetros básicos
            for ui_param, yolo_param in param_mapping.items():
                if ui_param in self._last_params and yolo_param not in params_added:
                    value = self._last_params[ui_param]
                    cmd.append(f'{yolo_param}={value}')
                    params_added.add(yolo_param)
            
            # Si hay un proyecto abierto y no se especificó 'project', usar el directorio runs del proyecto
            if self.current_project and 'project' not in params_added:
                project_runs_dir = self.current_project / 'runs'
                cmd.append(f'project={project_runs_dir}')
                params_added.add('project')
                self._push_log(f'📁 Resultados se guardarán en: {project_runs_dir}')
            
            # Manejar learning rate (prioridad: lr0 > learningRate)
            if 'lr0' in self._last_params and 'lr0' not in params_added:
                cmd.append(f'lr0={self._last_params["lr0"]}')
                params_added.add('lr0')
            elif 'learningRate' in self._last_params and 'lr0' not in params_added:
                cmd.append(f'lr0={self._last_params["learningRate"]}')
                params_added.add('lr0')
            
            # Agregar parámetros adicionales si existen
            additional_params = ['optimizer', 'seed', 'deterministic', 'single_cls', 
                               'rect', 'multi_scale', 'cos_lr', 'resume', 'amp', 'fraction', 'workers']
            
            for param in additional_params:
                if param in self._last_params and param not in params_added:
                    cmd.append(f'{param}={self._last_params[param]}')
                    params_added.add(param)
            
            # IMPORTANTE: Agregar task=segment al final si es segmentación
            if task == 'segment':
                cmd.append('task=segment')
                self._push_log('📝 Agregando task=segment al comando')
            else:
                self._push_log('📝 Usando detección por defecto (task=detect)')
            
            self._push_log(f'Comando: {" ".join(cmd)}')
            self._push_log('Iniciando proceso de entrenamiento...')
            
            # IMPORTANTE: Usar el directorio del data.yaml como working directory
            # Esto permite que YOLO resuelva las rutas relativas correctamente
            # Si el data.yaml tiene path: . entonces las rutas son relativas a su ubicación
            if self._yaml_path:
                working_dir = self._yaml_path.parent
                self._push_log(f'📂 Directorio de trabajo: {working_dir}')
            else:
                working_dir = Path.cwd()
                self._push_log(f'⚠️ Sin data.yaml, usando directorio actual: {working_dir}')
            
            # Iniciar el proceso con variables de entorno apropiadas
            env = os.environ.copy()
            env['PYTHONUNBUFFERED'] = '1'  # Para forzar salida sin buffer
            env['PYTHONIOENCODING'] = 'utf-8'  # Forzar encoding UTF-8
            
            self._train_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,  # Combinar stderr con stdout
                text=True,
                bufsize=0,  # Sin buffer para salida inmediata
                universal_newlines=True,
                encoding='utf-8',  # Especificar encoding explícitamente
                errors='replace',  # Reemplazar caracteres problemáticos
                cwd=working_dir,
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
            )
            
            self._push_log('Proceso iniciado correctamente. Leyendo salida...')
            
            # Leer la salida línea por línea en tiempo real
            while self._train_process and self._train_process.stdout:
                if self._stop_flag:
                    self._push_log('🛑 Solicitando detención del entrenamiento...')
                    try:
                        # Primero intentar terminación suave
                        self._train_process.terminate()
                        
                        # Esperar a que termine gracefully
                        try:
                            self._train_process.wait(timeout=10)
                            self._push_log('✅ Entrenamiento detenido correctamente')
                        except subprocess.TimeoutExpired:
                            self._push_log('⏰ Timeout esperando, forzando terminación...')
                            self._train_process.kill()
                            try:
                                self._train_process.wait(timeout=5)
                                self._push_log('🔸 Entrenamiento terminado forzosamente')
                            except subprocess.TimeoutExpired:
                                self._push_log('⚠️ No se pudo terminar el proceso completamente')
                    except Exception as e:
                        self._push_log(f'❌ Error deteniendo proceso: {e}')
                    break
                
                # Verificar si el proceso aún está corriendo
                if self._train_process.poll() is not None:
                    self._push_log('Proceso terminado, leyendo salida restante...')
                    # Leer cualquier salida restante
                    remaining_output = self._train_process.stdout.read()
                    if remaining_output:
                        for line in remaining_output.split('\n'):
                            line = line.strip()
                            if line:
                                clean_line = self._clean_output_line(line)
                                if clean_line and self._is_useful_log_line(clean_line):
                                    self._push_log(clean_line)
                    break
                
                try:
                    # Leer línea por línea con manejo mejorado de encoding
                    output = self._train_process.stdout.readline()
                    
                    if output:
                        line = output.strip()
                        if line:
                            # Limpiar caracteres de control y de escape ANSI
                            clean_line = self._clean_output_line(line)
                            if clean_line and self._is_useful_log_line(clean_line):
                                self._push_log(clean_line)
                    else:
                        # Si no hay salida, esperar un poco antes de continuar
                        time.sleep(0.1)
                    
                except UnicodeDecodeError as e:
                    self._push_log(f'Error de encoding en salida (ignorando): línea con caracteres especiales')
                    continue
                except Exception as e:
                    self._push_log(f'Error leyendo salida: {e}')
                    break
            
            # Verificar código de salida
            return_code = self._train_process.poll()
            if return_code == 0:
                self._push_log('== Entrenamiento completado exitosamente ==')
                return True
            elif self._stop_flag:
                # Si fue detenido por el usuario, considerarlo como éxito
                self._push_log('== Entrenamiento detenido por el usuario ==')
                return True
            else:
                self._push_log(f'== Entrenamiento terminó con código: {return_code} ==')
                return False
                
        except Exception as e:
            self._push_log(f'ERROR en subprocess: {e}')
            return False
        finally:
            if self._train_process:
                try:
                    if self._train_process.poll() is None:
                        self._train_process.terminate()
                        self._train_process.wait(timeout=5)
                except Exception as e:
                    self._push_log(f'Error cerrando proceso: {e}')
                self._train_process = None
            
            # Notificar al frontend que el entrenamiento terminó
            if webview.windows:
                w = webview.windows[0]
                w.evaluate_js("window.__trainingFinished && window.__trainingFinished()")
            
            self._stop_flag = False
    
    def _train_with_direct_yolo(self, task: str):
        """Método de fallback usando importación directa de YOLO."""
        try:
            from ultralytics import YOLO
            
            # Seleccionar modelo correcto según la tarea
            if task == 'segment':
                # Para segmentación usar modelo -seg
                model_path = self._last_params.get('model', 'yolo11n-seg.pt')
                if not model_path.endswith('-seg.pt'):
                    # Si el usuario especificó un modelo que no es de segmentación, convertirlo
                    base_model = model_path.replace('.pt', '')
                    model_path = f"{base_model}-seg.pt"
            else:
                # Para detección usar modelo normal
                model_path = self._last_params.get('model', 'yolo11n.pt')
                if model_path.endswith('-seg.pt'):
                    # Si el usuario especificó un modelo de segmentación para detección, convertirlo
                    model_path = model_path.replace('-seg.pt', '.pt')
            
            self._push_log(f'Tarea: {task}')
            self._push_log(f'Cargando modelo: {model_path}')
            self._push_log(f'Dataset: {self._yaml_path}')
            
            # Cargar modelo
            model = YOLO(model_path)
            
            # Preparar parámetros para YOLO
            yolo_kwargs = {
                'data': str(self._yaml_path),
                'epochs': self._last_params.get('epochs', 100),
                'imgsz': self._last_params.get('imgsz', 640),
                'batch': self._last_params.get('batch', 16)
            }
            
            # Agregar parámetros opcionales si están definidos
            optional_params = {
                'lr0': self._last_params.get('lr0') or self._last_params.get('learningRate'),
                'device': self._last_params.get('device'),
                'name': self._last_params.get('name'),
                'project': self._last_params.get('project'),
                'optimizer': self._last_params.get('optimizer'),
                'seed': self._last_params.get('seed'),
                'workers': self._last_params.get('workers')
            }
            
            for param, value in optional_params.items():
                if value is not None:
                    yolo_kwargs[param] = value
            
            self._push_log('Parámetros de entrenamiento:')
            for key, value in yolo_kwargs.items():
                if key != 'data':  # No mostrar la ruta completa del dataset
                    self._push_log(f'  {key}: {value}')
            
            self._push_log('Iniciando entrenamiento...')
            
            # Ejecutar entrenamiento (esto mostrará logs en terminal)
            results = model.train(**yolo_kwargs)
            
            self._push_log('== Entrenamiento completado exitosamente ==')
            
            # Intentar mostrar métricas finales
            try:
                if hasattr(results, 'results_dict'):
                    metrics = results.results_dict
                    self._push_log('Métricas finales:')
                    for key, value in metrics.items():
                        if isinstance(value, (int, float)):
                            self._push_log(f'  {key}: {value:.4f}')
                elif hasattr(results, 'metrics'):
                    self._push_log('Entrenamiento completado - métricas disponibles en results.metrics')
                
                # Mostrar ruta de los pesos guardados
                if hasattr(results, 'save_dir'):
                    self._push_log(f'Modelo guardado en: {results.save_dir}')
                    
            except Exception as e:
                self._push_log(f'No se pudieron obtener métricas: {e}')
                
        except ImportError:
            self._push_log('ERROR: Ultralytics no está instalado. Ejecute: pip install ultralytics')
        except Exception as e:
            self._push_log(f'ERROR en entrenamiento: {e}')
            import traceback
            self._push_log(f'Detalles del error: {traceback.format_exc()}')
    
    def _clean_output_line(self, line: str) -> str:
        """Limpia la línea de salida de caracteres problemáticos"""
        # Remover códigos de escape ANSI
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        cleaned = ansi_escape.sub('', line)
        
        # Remover caracteres de control excepto espacios, tabuladores y nueva línea
        cleaned = ''.join(char for char in cleaned if ord(char) >= 32 or char in '\t\n\r')
        
        return cleaned.strip()

    def _is_useful_log_line(self, line: str) -> bool:
        """Filtra líneas útiles para mostrar en el frontend"""
        line_lower = line.lower()
        
        # Filtrar códigos de escape ANSI (ya limpiados por _clean_output_line, pero por si acaso)
        if line.startswith('\x1b') or '\x1b[' in line:
            return False
        
        # Filtrar líneas muy largas que probablemente sean spam
        if len(line) > 800:
            return False
        
        # Patrones de métricas de época - SIEMPRE mostrar estas líneas importantes
        # Segmentación: epoch/total GPU box seg cls dfl instances size
        epoch_seg_pattern = re.search(r'^(\d+)/(\d+)\s+\d+G\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+\d+\s+\d+:', line)
        # Detección: epoch/total GPU box cls dfl instances size
        epoch_det_pattern = re.search(r'^(\d+)/(\d+)\s+\d+G\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+\d+\s+\d+:', line)
        if epoch_seg_pattern or epoch_det_pattern:
            # Siempre mostrar las métricas de época
            return True
        
        # Progreso de entrenamiento - mostrar líneas de progreso importantes
        if re.search(r'\d+/\d+.*?:\s+\d+%.*?━+.*?\d+/\d+.*?it/s', line):
            # Mostrar progreso al 100% (fin de época)
            if '100%' in line:
                return True
            # También mostrar progreso intermedio cada cierto % para dar sensación de actividad
            progress_match = re.search(r'(\d+)%', line)
            if progress_match:
                progress = int(progress_match.group(1))
                # Mostrar cada 25% del progreso
                if progress % 25 == 0:
                    return True
        
        # Validación - mostrar líneas de validación importantes  
        if re.search(r'Class Images Instances.*?Box\(P R mAP50', line) or 'Validating' in line:
            return True
        
        # Filtrar líneas de scanning cache repetidas pero permitir la primera
        if 'Scanning' in line and '.cache' in line:
            cache_type = 'train' if 'train' in line else 'val'
            cache_key = f"cache_{cache_type}"
            if hasattr(self, '_shown_cache') and cache_key in self._shown_cache:
                return False
            if not hasattr(self, '_shown_cache'):
                self._shown_cache = set()
            self._shown_cache.add(cache_key)
            return True
        
        # Palabras clave que indican información útil
        useful_keywords = [
            'downloading', 'ultralytics', 'overriding', 'summary', 'transferred',
            'freezing', 'optimizer', 'plotting', 'starting training', 'train:',
            'epochs completed', 'validating', 'results saved', 'speed:', 'new',
            'best', 'map50', 'precision', 'recall', 'fitness', 'epoch'
        ]
        
        # Patrones específicos importantes
        important_patterns = [
            # Mensajes de inicio importantes
            line.startswith(('Ultralytics', 'YOLO11n', 'Transferred', 'Freezing')),
            # Información del optimizador y modelo
            line.startswith('optimizer:') or line.startswith('Model summary:'),
            # Inicio y fin de entrenamiento
            'Starting training for' in line or 'training complete' in line,
            'epochs completed' in line or 'Training complete' in line,
            # Progreso de descarga
            'Downloading' in line and '%' in line,
            # Validación y resultados
            line.startswith('Validating') or 'Results saved' in line or line.startswith('Speed:'),
            # Configuración importante
            'Overriding' in line or 'Plotting labels' in line,
            # Nuevos mejores resultados
            'New best' in line or 'best.pt' in line,
            # Métricas importantes
            'mAP50' in line or 'Precision' in line or 'Recall' in line,
        ]
        
        # Aplicar filtros
        return any(important_patterns) or any(keyword in line_lower for keyword in useful_keywords)

    # --- Métodos expuestos ---
    def hello(self, name: str):
        print("Python recibió:", name)
        return f"Hola {name}, desde Python!"

    def get_training_data(self):
        """Obtiene los datos estructurados del entrenamiento actual"""
        return {
            'ok': True,
            'data': self._training_data.copy()
        }
    
    def reset_training_data(self):
        """Reinicia los datos de entrenamiento para una nueva sesión"""
        self._training_data = {
            'current_epoch': 0,
            'total_epochs': 0,
            'download_progress': 0,
            'metrics_history': [],
            'model_summary': {},
            'training_status': 'idle'
        }
        # Limpiar caches de deduplicación
        if hasattr(self, '_shown_progress'):
            self._shown_progress.clear()
        if hasattr(self, '_shown_validation'):
            self._shown_validation.clear()
        if hasattr(self, '_shown_cache'):
            self._shown_cache.clear()
        if hasattr(self, '_shown_epochs'):
            self._shown_epochs.clear()
        self._last_logs.clear()
        return {'ok': True}

    def test_subprocess(self):
        """Método de prueba para verificar que el subprocess funciona"""
        try:
            # Obtener la ruta del ejecutable yolo en el entorno virtual
            venv_path = Path(sys.executable).parent
            yolo_executable = venv_path / 'yolo.exe' if os.name == 'nt' else venv_path / 'yolo'
            
            self._push_log(f'Probando ejecutable en: {yolo_executable}')
            
            if not yolo_executable.exists():
                return {'ok': False, 'error': f'Ejecutable yolo no encontrado en {yolo_executable}'}
            
            # Comando simple de prueba
            cmd = [str(yolo_executable), 'version']
            
            self._push_log(f'Ejecutando comando de prueba: {" ".join(cmd)}')
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=10
            )
            
            self._push_log(f'Código de retorno: {result.returncode}')
            self._push_log(f'Salida: {result.stdout}')
            if result.stderr:
                self._push_log(f'Error: {result.stderr}')
            
            return {
                'ok': result.returncode == 0,
                'returncode': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            }
            
        except Exception as e:
            error_msg = f'Error en test_subprocess: {e}'
            self._push_log(error_msg)
            return {'ok': False, 'error': error_msg}

    def create_project(self, path: str, name: str, classes: List[str] | None = None, task: str = 'detect', meta: Dict[str, Any] | None = None):
        """Crear un nuevo proyecto con estructura de dataset YOLO.

        Args:
            path: Ruta destino (carpeta o nueva) del proyecto.
            name: Nombre lógico del proyecto.
            classes: Lista opcional de clases iniciales. Si no se provee, se crean placeholder.
            task: Tipo de tarea ('detect' o 'segment').
        """
        if task not in ('detect', 'segment'):
            raise ValueError("task debe ser 'detect' o 'segment'")

        meta = meta or {}
        description = meta.get('description', '')
        yolo_model = meta.get('model') or meta.get('yoloModel') or ''
        segmentation_type = meta.get('segmentationType', 'instance' if task == 'segment' else '')
        image_size = int(meta.get('imageSize', 640))
        splits = meta.get('splits', {}) or {}
        train_split = int(splits.get('train', 70))
        val_split = int(splits.get('val', 20))
        test_split = int(splits.get('test', 10))
        augmentation = bool(meta.get('augmentation', False))

        base_dir = Path(path).expanduser().resolve()
        ensure_dir(base_dir)

        # Crear subcarpeta única basada en 'name'
        safe_name = name.strip().replace(' ', '_') or 'proyecto'
        candidate = base_dir / safe_name
        idx = 1
        while candidate.exists():
            candidate = base_dir / f"{safe_name}_{idx}"
            idx += 1
        p = candidate
        ensure_dir(p)

        # Carpetas base
        folders = [
            'labels',
            'dataset/train/images', 'dataset/train/labels',
            'dataset/val/images', 'dataset/val/labels',
            'dataset/test/images', 'dataset/test/labels'
        ]
        for f in folders:
            ensure_dir(p / f)

        # Clases por defecto
        if not classes or len(classes) == 0:
            classes = ['clase_0']

        # Configuración del proyecto
        from datetime import datetime
        config = {
            'name': name,
            # NO guardar rutas absolutas - se calculan dinámicamente al abrir el proyecto
            # 'root': str(p),  # ❌ REMOVIDO - ruta absoluta
            # 'baseDir': str(base_dir),  # ❌ REMOVIDO - ruta absoluta
            'folderName': p.name,
            'createdAt': datetime.utcnow().isoformat(),
            'classes': classes,
            'task': task,
            'version': '1.0',
            'description': description,
            'model': yolo_model,
            'segmentationType': segmentation_type,
            'imageSize': image_size,
            # 'dataYamlPath': str(p / 'data.yaml'),  # ❌ REMOVIDO - siempre es relativo: ./data.yaml
            'splits': {
                'train': train_split,
                'val': val_split,
                'test': test_split
            },
            'augmentation': augmentation
        }

        # Guardar project_config.json
        with open(p / PROJECT_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        # Generar data.yaml siguiendo formato YOLO estándar
        # IMPORTANTE: data.yaml solo debe contener campos estándar de YOLO
        # Los campos adicionales (task, splits, augmentation, etc.) van en project_config.json
        dataset_yaml = {
            'path': '.',  # relativo al root del proyecto
            'train': 'dataset/train/images',
            'val': 'dataset/val/images',
            'test': 'dataset/test/images',
            'names': {i: cls for i, cls in enumerate(classes)}
        }

        # Escribir data.yaml
        try:
            import yaml  # type: ignore
            with open(p / 'data.yaml', 'w', encoding='utf-8') as f:
                yaml.safe_dump(dataset_yaml, f, allow_unicode=True, sort_keys=False)
        except Exception:  # ImportError o safe_dump error
            with open(p / 'data.yaml', 'w', encoding='utf-8') as f:
                f.write('path: .\n')
                f.write('train: dataset/train/images\n')
                f.write('val: dataset/val/images\n')
                f.write('test: dataset/test/images\n')
                f.write('names:\n')
                for i, cls in enumerate(classes):
                    f.write(f"  {i}: {cls}\n")

        self.current_project = p
        self._load_images()
        
        # Agregar configPath para que el frontend pueda registrar en recientes
        config['configPath'] = str(p / PROJECT_STATE_FILE)
        
        return {'ok': True, 'project': config, 'images': [img.name for img in self.images]}

    def open_project(self, path: str):
        """Abre un proyecto existente.
        
        Las rutas absolutas se calculan dinámicamente basándose en la ubicación
        del project_config.json, lo que permite mover proyectos entre carpetas.
        
        Args:
            path: Ruta a la carpeta del proyecto o al archivo project_config.json
            
        Returns:
            dict: {'ok': True, 'project': config, 'images': [...]}
        """
        p = Path(path).expanduser().resolve()
        if p.is_dir():
            cfg_path = p / PROJECT_STATE_FILE
        else:
            cfg_path = p
            p = p.parent
        
        if not cfg_path.exists():
            raise FileNotFoundError('No se encontró project_config.json')
        
        with open(cfg_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # Calcular rutas dinámicamente basadas en la ubicación actual del proyecto
        config['root'] = str(p)  # Ruta absoluta actual del proyecto
        config['baseDir'] = str(p.parent)  # Ruta absoluta del directorio padre
        config['dataYamlPath'] = str(p / 'data.yaml')  # Ruta absoluta al data.yaml
        
        # Verificar que data.yaml existe
        data_yaml_path = p / 'data.yaml'
        if not data_yaml_path.exists():
            print(f'⚠️ [open_project] Advertencia: data.yaml no encontrado en {data_yaml_path}')
        
        self.current_project = p
        self._load_images()
        
        # Agregar configPath para que el frontend pueda registrar en recientes
        config['configPath'] = str(cfg_path)
        
        print(f'✅ [open_project] Proyecto abierto: {config["name"]}')
        print(f'   📁 Ubicación: {p}')
        print(f'   📊 Imágenes: {len(self.images)}')
        
        return {'ok': True, 'project': config, 'images': [img.name for img in self.images]}

    def close_project(self):
        self.current_project = None
        self.images = []
        self.annotations_index = {}
        return {'ok': True}

    def save_project(self, classes=None):
        """Guarda el estado actual del proyecto actualizando project_config.json y data.yaml
        
        Args:
            classes: Lista opcional de clases a guardar. Si se proporciona, se actualizará data.yaml
        """
        try:
            self._ensure_project_open()
            p = self._project_dir()
            
            # Leer configuración actual
            cfg_path = p / PROJECT_STATE_FILE
            if not cfg_path.exists():
                return {'ok': False, 'error': 'No se encontró project_config.json'}
            
            with open(cfg_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            # Determinar las clases a usar
            if classes is not None:
                # Si se proporcionan clases, usarlas directamente
                current_classes = classes if isinstance(classes, list) else []
                print(f"[save_project] Clases recibidas del frontend: {current_classes}")
            else:
                # Obtener clases desde data.yaml (es la fuente de verdad para las clases)
                data_yaml_path = p / 'data.yaml'
                current_classes = config.get('classes', [])
                
                if data_yaml_path.exists():
                    try:
                        import yaml
                        with open(data_yaml_path, 'r', encoding='utf-8') as f:
                            data_yaml = yaml.safe_load(f)
                        
                        if data_yaml and 'names' in data_yaml:
                            # Convertir dict {0: 'clase1', 1: 'clase2'} a lista ['clase1', 'clase2']
                            if isinstance(data_yaml['names'], dict):
                                max_idx = max(data_yaml['names'].keys()) if data_yaml['names'] else -1
                                current_classes = [data_yaml['names'].get(i, f'clase_{i}') for i in range(max_idx + 1)]
                            elif isinstance(data_yaml['names'], list):
                                current_classes = data_yaml['names']
                    except Exception as e:
                        print(f"[save_project] Error leyendo data.yaml: {e}")
            
            # Actualizar clases en config
            config['classes'] = current_classes
            
            # Actualizar timestamp de última modificación
            from datetime import datetime
            config['lastModified'] = datetime.utcnow().isoformat()
            
            # Contar imágenes actuales por split
            train_images = list((p / 'dataset' / 'train' / 'images').glob('*'))
            val_images = list((p / 'dataset' / 'val' / 'images').glob('*'))
            test_images = list((p / 'dataset' / 'test' / 'images').glob('*'))
            
            # Filtrar solo archivos de imagen
            image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff'}
            train_images = [f for f in train_images if f.suffix.lower() in image_extensions]
            val_images = [f for f in val_images if f.suffix.lower() in image_extensions]
            test_images = [f for f in test_images if f.suffix.lower() in image_extensions]
            
            # Actualizar estadísticas
            config['stats'] = {
                'totalImages': len(train_images) + len(val_images) + len(test_images),
                'trainImages': len(train_images),
                'valImages': len(val_images),
                'testImages': len(test_images),
                'classes': len(current_classes)
            }
            
            # Crear una copia del config para guardar (sin rutas absolutas)
            config_to_save = config.copy()
            # Remover campos con rutas absolutas antes de guardar
            config_to_save.pop('root', None)
            config_to_save.pop('baseDir', None)
            config_to_save.pop('dataYamlPath', None)
            
            # Guardar project_config.json actualizado (sin rutas absolutas)
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(config_to_save, f, ensure_ascii=False, indent=2)
            
            # Agregar rutas dinámicas para la respuesta (solo en memoria)
            config['root'] = str(p)
            config['baseDir'] = str(p.parent)
            config['dataYamlPath'] = str(p / 'data.yaml')
            
            # Actualizar data.yaml con las clases actuales
            data_yaml_path = p / 'data.yaml'
            dataset_yaml = {
                'path': '.',
                'train': 'dataset/train/images',
                'val': 'dataset/val/images',
                'test': 'dataset/test/images',
                'names': {i: cls for i, cls in enumerate(current_classes)}
            }
            
            try:
                import yaml
                with open(data_yaml_path, 'w', encoding='utf-8') as f:
                    yaml.safe_dump(dataset_yaml, f, allow_unicode=True, sort_keys=False)
            except Exception:
                # Fallback manual
                with open(data_yaml_path, 'w', encoding='utf-8') as f:
                    f.write('path: .\n')
                    f.write('train: dataset/train/images\n')
                    f.write('val: dataset/val/images\n')
                    f.write('test: dataset/test/images\n')
                    f.write('names:\n')
                    for i, cls in enumerate(current_classes):
                        f.write(f"  {i}: {cls}\n")
            
            print(f'[save_project] ✅ Proyecto guardado correctamente: {config["name"]}')
            print(f'[save_project]    - Clases: {len(current_classes)}')
            print(f'[save_project]    - Imágenes: {config["stats"]["totalImages"]} (train: {len(train_images)}, val: {len(val_images)}, test: {len(test_images)})')
            
            return {
                'ok': True,
                'project': config,
                'stats': config['stats']
            }
            
        except Exception as e:
            error_msg = f'Error guardando proyecto: {str(e)}'
            print(f'[save_project] ❌ {error_msg}')
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': error_msg}

    def list_images(self):
        self._ensure_project_open()
        image_names = [img.name for img in self.images]
        print(f'[Api.list_images] Devolviendo {len(image_names)} imágenes:', image_names[:5] if len(image_names) > 5 else image_names)
        print(f'[Api.list_images] Total self.images: {len(self.images)}')
        print(f'[Api.list_images] current_project: {self.current_project}')
        return image_names

    def get_image_base64(self, filename: str):
        """Devuelve {'ok':True,'dataUrl':...} o {'ok':False,'error':...}"""
        try:
            self._ensure_project_open()
            match = next((img for img in self.images if img.name == filename), None)
            if not match:
                return {'ok': False, 'error': 'Imagen no encontrada'}
            with open(match, 'rb') as f:
                b64data = base64.b64encode(f.read()).decode('ascii')
            return {
                'ok': True,
                'dataUrl': f"data:image/{match.suffix.lstrip('.')};base64,{b64data}",
                'filename': match.name
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def load_annotations(self, filename: str):
        self._ensure_project_open()
        ann_path = self.annotations_index.get(filename)
        if not ann_path or not ann_path.exists():
            return []
        with open(ann_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_annotations(self, filename: str, annotations: Any):
        self._ensure_project_open()
        ann_path = self.annotations_index.get(filename)
        if not ann_path:
            ann_path = self._annotations_dir() / f"{Path(filename).stem}.json"
            self.annotations_index[filename] = ann_path
        with open(ann_path, 'w', encoding='utf-8') as f:
            json.dump(annotations, f, ensure_ascii=False, indent=2)
        return {'ok': True}

    # --- Carga de imágenes al proyecto ---
    def add_images(self, images: List[Dict[str, Any]]):
        """Agregar imágenes al proyecto.

        Parámetro images: lista de objetos { 'name': str, 'dataUrl': str }
        donde dataUrl es un data URI (data:image/xxx;base64,....)
        """
        self._ensure_project_open()
        if not images:
            return {'ok': True, 'added': 0}
        import re, base64 as b64
        target_dir = self._project_dir() / 'dataset' / 'train' / 'images'
        target_dir.mkdir(parents=True, exist_ok=True)
        added = 0
        data_uri_re = re.compile(r'^data:image/(png|jpe?g|bmp|tiff?);base64,(.+)$', re.IGNORECASE)
        for item in images:
            name = item.get('name') or f'img_{added}.png'
            data_url = item.get('dataUrl') or ''
            m = data_uri_re.match(data_url)
            if not m:
                continue
            ext = m.group(1)
            raw_b64 = m.group(2)
            # Normalizar extensión
            if ext in ('jpeg',):
                ext = 'jpg'
            out_path = target_dir / name
            if not out_path.suffix:
                out_path = out_path.with_suffix('.' + ext)
            try:
                with open(out_path, 'wb') as f:
                    f.write(b64.b64decode(raw_b64))
                added += 1
            except Exception as e:
                print('[Api.add_images] Error guardando', name, e)
        # Refrescar listado
        self._load_images()
        return {'ok': True, 'added': added, 'images': [img.name for img in self.images]}

    def select_images_dialog(self, title: str = 'Seleccionar imágenes'):
        """Diálogo nativo multi-selección de imágenes.

        Retorna {'ok': True, 'paths': [...]} o {'ok': False}
        """
        try:
            window = webview.windows[0] if webview.windows else None
            if not window:
                return {'ok': False, 'error': 'No window context'}
            open_type = getattr(webview, 'OPEN_DIALOG', 0)
            # Algunos backends aceptan allow_multiple
            result = window.create_file_dialog(open_type, allow_multiple=True, directory='.')
            if not result:
                return {'ok': False}
            # Filtrar a extensiones válidas
            valid = []
            for r in result:
                p = Path(r)
                if p.suffix.lower() in IMAGE_EXTS:
                    valid.append(str(p))
            return {'ok': True, 'paths': valid}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def copy_image_paths(self, paths: List[str]):
        """Copia archivos de imagen existentes al directorio dataset/train/images del proyecto.

        paths: lista de rutas absolutas de imágenes.
        """
        self._ensure_project_open()
        if not paths:
            return {'ok': True, 'copied': 0, 'images': [img.name for img in self.images]}
        target_dir = self._project_dir() / 'dataset' / 'train' / 'images'
        target_dir.mkdir(parents=True, exist_ok=True)
        copied = 0
        from shutil import copy2
        import time
        started = time.time()
        for p_str in paths:
            src = Path(p_str)
            if not src.exists() or src.suffix.lower() not in IMAGE_EXTS:
                continue
            dest = target_dir / src.name
            # Evitar sobrescritura accidental: si existe, generar nombre único
            if dest.exists():
                base = dest.stem
                ext = dest.suffix
                idx = 1
                while True:
                    alt = target_dir / f"{base}_{idx}{ext}"
                    if not alt.exists():
                        dest = alt
                        break
                    idx += 1
            try:
                copy2(src, dest)
                copied += 1
            except Exception as e:
                print('[Api.copy_image_paths] Error copiando', src, e)
        self._load_images()
        elapsed = time.time() - started
        # Nota: el evento JS custom lo dispararemos desde frontend tras recibir respuesta.
        return {'ok': True, 'copied': copied, 'images': [img.name for img in self.images], 'elapsed': elapsed}

    def get_image_stats(self, filename: str):
        """Obtiene información detallada de una imagen específica.
        
        Returns: {'ok': True, 'stats': {...}} o {'ok': False, 'error': '...'}
        """
        try:
            self._ensure_project_open()
            
            # Buscar la imagen en el listado
            match = next((img for img in self.images if img.name == filename), None)
            if not match:
                return {'ok': False, 'error': f'Imagen {filename} no encontrada'}
            
            # Obtener información del archivo
            file_stats = match.stat()
            
            # Verificar si tiene anotaciones
            ann_path = self.annotations_index.get(filename)
            has_annotations = ann_path and ann_path.exists()
            
            # Intentar obtener dimensiones de la imagen
            dimensions = None
            try:
                from PIL import Image
                with Image.open(match) as img:
                    dimensions = {'width': img.width, 'height': img.height}
            except Exception as e:
                print(f'[get_image_stats] No se pudieron obtener dimensiones de {filename}: {e}')
            
            return {
                'ok': True,
                'stats': {
                    'filename': filename,
                    'path': str(match),
                    'size': file_stats.st_size,
                    'dimensions': dimensions,
                    'hasAnnotations': has_annotations,
                    'modified': file_stats.st_mtime
                }
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def delete_image(self, filename: str):
        """Elimina una imagen y sus anotaciones asociadas del proyecto.
        
        Elimina tanto el archivo de imagen como los archivos de anotaciones en formato:
        - .json (formato interno de la aplicación)
        - .txt (formato YOLO)
        
        Returns: {'ok': True, 'images': [...]} o {'ok': False, 'error': '...'}
        """
        try:
            self._ensure_project_open()
            
            # Buscar la imagen
            match = next((img for img in self.images if img.name == filename), None)
            if not match:
                return {'ok': False, 'error': f'Imagen {filename} no encontrada'}
            
            # Eliminar archivo de imagen
            if match.exists():
                match.unlink()
                print(f'[delete_image] Imagen eliminada: {match}')
            
            # Eliminar archivo de anotaciones JSON si existe
            ann_path = self.annotations_index.get(filename)
            if ann_path and ann_path.exists():
                ann_path.unlink()
                print(f'[delete_image] Anotaciones JSON eliminadas: {ann_path}')
            
            # Eliminar archivo de anotaciones YOLO (.txt) si existe
            # YOLO guarda las anotaciones en labels/ con el mismo nombre base
            labels_dir = self._project_dir() / 'labels'
            txt_ann_path = labels_dir / f"{match.stem}.txt"
            if txt_ann_path.exists():
                txt_ann_path.unlink()
                print(f'[delete_image] Anotaciones YOLO (.txt) eliminadas: {txt_ann_path}')
            
            # Recargar lista de imágenes
            self._load_images()
            
            return {
                'ok': True,
                'images': [img.name for img in self.images],
                'deleted': filename
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def check_image_annotations(self, filename: str):
        """Verifica si una imagen tiene anotaciones.
        
        Returns: {'ok': True, 'hasAnnotations': bool, 'count': int} o {'ok': False, 'error': '...'}
        """
        try:
            self._ensure_project_open()
            
            ann_path = self.annotations_index.get(filename)
            
            if not ann_path or not ann_path.exists():
                return {'ok': True, 'hasAnnotations': False, 'count': 0}
            
            # Contar anotaciones en el archivo
            try:
                with open(ann_path, 'r', encoding='utf-8') as f:
                    annotations = json.load(f)
                    count = len(annotations) if isinstance(annotations, list) else 0
            except Exception:
                count = 0
            
            return {
                'ok': True,
                'hasAnnotations': count > 0,
                'count': count
            }
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def select_folder_dialog(self, title: str = 'Seleccionar carpeta'):
        """Abre un diálogo para seleccionar una carpeta.
        
        Returns: {'ok': True, 'path': '...'} o {'ok': False}
        """
        try:
            window = webview.windows[0] if webview.windows else None
            if not window:
                return {'ok': False, 'error': 'No window context'}
            
            folder_type = getattr(webview, 'FOLDER_DIALOG', 2)
            result = window.create_file_dialog(folder_type, directory='.')
            
            if not result:
                return {'ok': False}
            
            # result puede ser una lista o una cadena
            folder_path = result[0] if isinstance(result, (list, tuple)) else result
            
            return {'ok': True, 'path': str(folder_path)}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def exit_app(self):
        """Cierra la aplicación pywebview.

        Intenta destruir la ventana activa y retornar {'ok': True}. Si hay error lo reporta.
        """
        try:
            if webview.windows:
                for w in list(webview.windows):
                    try:
                        w.destroy()
                    except Exception:
                        pass
            return {'ok': True}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    # --- Utilidades de UI (pywebview) ---
    def select_directory(self, title: str = 'Seleccionar carpeta de proyecto'):
        """Abre un diálogo nativo para seleccionar carpeta y retorna la ruta.

        Retorna {'ok': True, 'path': str} o {'ok': False} si se cancela.
        """
        try:
            window = webview.windows[0] if webview.windows else None
            if not window:
                return {'ok': False, 'error': 'No window context'}
            # Algunas versiones exponen webview.FOLDER_DIALOG como proxy; asegurar entero
            dialog_type = getattr(webview, 'FOLDER_DIALOG', 0)
            result = window.create_file_dialog(dialog_type, allow_multiple=False, directory='.')
            if not result:
                return {'ok': False}
            # result es lista de rutas
            return {'ok': True, 'path': result[0]}
        except Exception as e:
            return {'ok': False, 'error': str(e)}



    def select_project_config(self, title: str = 'Abrir project_config.json'):
        """Abre un diálogo nativo para escoger directamente el archivo project_config.json.

        Retorna {'ok': True, 'path': str} con la ruta al archivo o {'ok': False} si se cancela.
        """
        try:
            window = webview.windows[0] if webview.windows else None
            if not window:
                print('[Api.select_project_config] No window context disponible')
                return {'ok': False, 'error': 'No window context'}
            # TYPE_OPEN es normalmente 1 en pywebview; usar getattr para robustez
            open_type = getattr(webview, 'OPEN_DIALOG', 0)
            print('[Api.select_project_config] Abriendo diálogo de archivo (sin filtro inicial)...')
            # Algunos backends (WinForms) son estrictos con el formato de filtros. Primero intentamos sin filtros.
            try:
                result = window.create_file_dialog(open_type, directory='.', allow_multiple=False)
            except Exception as fe:
                print('[Api.select_project_config] Primer intento sin filtros falló:', fe)
                # Intento alternativo usando formato clásico Windows "Descripción|patrón" si backend lo soporta
                try:
                    result = window.create_file_dialog(open_type, directory='.', allow_multiple=False,
                                                       file_types=['Archivos JSON (*.json)|*.json','Todos los archivos (*.*)|*.*'])
                except Exception as fe2:
                    print('[Api.select_project_config] Segundo intento con filtros también falló:', fe2)
                    return {'ok': False, 'error': f'No se pudo abrir el diálogo de archivo: {fe2}'}
            print('[Api.select_project_config] Resultado raw:', result)
            if not result:
                # Usuario canceló la selección
                print('[Api.select_project_config] Usuario canceló la selección')
                return {'ok': False}
            
            path = Path(result[0]).expanduser().resolve()
            if path.name != PROJECT_STATE_FILE:
                # Si usuario eligió otra cosa, intentar detectar si es carpeta con el config dentro
                if path.is_dir():
                    candidate = path / PROJECT_STATE_FILE
                    if candidate.exists():
                        print('[Api.select_project_config] Usuario eligió carpeta, se detectó config dentro')
                        return {'ok': True, 'path': str(candidate)}
                # Forzar error amigable
                print(f'[Api.select_project_config] Archivo inválido seleccionado: {path.name}')
                return {'ok': False, 'error': f'Selecciona el archivo {PROJECT_STATE_FILE}'}
            return {'ok': True, 'path': str(path)}
        except Exception as e:
            print('[Api.select_project_config] Error:', e)
            return {'ok': False, 'error': str(e)}

    def get_system_resources(self):
        """Obtiene información en tiempo real de los recursos del sistema"""
        try:
            # Información de CPU
            cpu_percent = psutil.cpu_percent(interval=0.1)
            cpu_count = psutil.cpu_count()
            
            # Información de memoria RAM
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_used_gb = memory.used / (1024**3)  # Convertir a GB
            memory_total_gb = memory.total / (1024**3)
            
            # Información de GPU
            gpu_info = {
                'gpu_available': False,
                'gpu_name': '',
                'gpu_memory_used_gb': 0,
                'gpu_memory_total_gb': 0,
                'gpu_utilization': 0,
                'gpu_memory_percent': 0,
                'gpu_temperature': 0
            }
            
            try:
                gpus = GPUtil.getGPUs()
                if gpus:
                    gpu = gpus[0]  # Usar primera GPU encontrada
                    gpu_info.update({
                        'gpu_available': True,
                        'gpu_name': gpu.name,
                        'gpu_memory_used_gb': gpu.memoryUsed / 1024,  # MB to GB
                        'gpu_memory_total_gb': gpu.memoryTotal / 1024,
                        'gpu_utilization': round(gpu.load * 100, 1),
                        'gpu_memory_percent': round((gpu.memoryUsed / gpu.memoryTotal) * 100, 1),
                        'gpu_temperature': gpu.temperature if gpu.temperature is not None else 0
                    })
            except Exception as e:
                print(f"[get_system_resources] Error obteniendo info GPU: {e}")
            
            # Información de disco
            disk_usage = psutil.disk_usage('/')
            disk_percent = (disk_usage.used / disk_usage.total) * 100
            
            # Información del proceso Python actual (útil para ver uso del entrenamiento)
            current_process = psutil.Process()
            process_memory_mb = current_process.memory_info().rss / (1024**2)
            process_cpu_percent = current_process.cpu_percent()
            
            return {
                'cpu': {
                    'percent': round(cpu_percent, 1),
                    'count': cpu_count
                },
                'memory': {
                    'percent': round(memory_percent, 1),
                    'used_gb': round(memory_used_gb, 2),
                    'total_gb': round(memory_total_gb, 2)
                },
                'gpu': gpu_info,
                'disk': {
                    'percent': round(disk_percent, 1)
                },
                'process': {
                    'memory_mb': round(process_memory_mb, 1),
                    'cpu_percent': round(process_cpu_percent, 1)
                }
            }
        except Exception as e:
            print(f"[get_system_resources] Error: {e}")
            return {
                'error': str(e),
                'cpu': {'percent': 0, 'count': 0},
                'memory': {'percent': 0, 'used_gb': 0, 'total_gb': 0},
                'gpu': {
                    'gpu_available': False,
                    'gpu_name': '',
                    'gpu_memory_used_gb': 0,
                    'gpu_memory_total_gb': 0,
                    'gpu_utilization': 0,
                    'gpu_memory_percent': 0,
                    'gpu_temperature': 0
                },
                'disk': {'percent': 0},
                'process': {'memory_mb': 0, 'cpu_percent': 0}
            }

    def get_trained_models(self):
        """Obtiene la lista de modelos entrenados del proyecto actual, ordenados del más reciente al más antiguo"""
        try:
            if not self.current_project:
                return {'ok': False, 'models': [], 'error': 'No hay proyecto abierto'}
            
            # Buscar modelos en runs/train* directamente (nueva estructura)
            # También buscar en runs/detect/train* y runs/segment/train* (estructura antigua)
            runs_dir = Path(self.current_project) / 'runs'
            models = []
            
            if not runs_dir.exists():
                return {'ok': True, 'models': [], 'message': 'No hay modelos entrenados aún'}
            
            # Buscar entrenamientos directos en runs/train*
            for train_dir in runs_dir.glob('train*'):
                if train_dir.is_dir():
                    weights_dir = train_dir / 'weights'
                    if weights_dir.exists():
                        best_model = weights_dir / 'best.pt'
                        
                        if best_model.exists():
                            stat = best_model.stat()
                            
                            # Intentar determinar el tipo de tarea del archivo args.yaml
                            task = 'detect'  # Por defecto
                            args_file = train_dir / 'args.yaml'
                            if args_file.exists():
                                try:
                                    import yaml
                                    with open(args_file, 'r') as f:
                                        args = yaml.safe_load(f)
                                        task = args.get('task', 'detect')
                                except:
                                    pass
                            
                            # Leer métricas desde results.csv
                            training_metrics = self._read_training_metrics(train_dir, task)
                            
                            task_label = 'Detección' if task == 'detect' else 'Segmentación'
                            
                            models.append({
                                'id': f'{task}_{train_dir.name}',
                                'name': f'YOLO11_{task}_{train_dir.name}',
                                'label': f'YOLO11 {task_label} ({train_dir.name})',
                                'value': f'{task}_{train_dir.name}',
                                'path': str(best_model),
                                'task': task,
                                'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M'),
                                'size': f'{stat.st_size / 1024 / 1024:.1f} MB',
                                'accuracy': training_metrics['mAP'],
                                'mAP': training_metrics['mAP'],
                                'precision': training_metrics['precision'],
                                'recall': training_metrics['recall'],
                                'epochs': training_metrics['epochs'],
                                'timestamp': stat.st_mtime  # Para ordenar
                            })
            
            # Buscar entrenamientos de detección (estructura antigua)
            detect_dir = runs_dir / 'detect'
            if detect_dir.exists():
                for train_dir in detect_dir.glob('train*'):
                    weights_dir = train_dir / 'weights'
                    if weights_dir.exists():
                        best_model = weights_dir / 'best.pt'
                        
                        if best_model.exists():
                            stat = best_model.stat()
                            
                            # Leer métricas desde results.csv
                            training_metrics = self._read_training_metrics(train_dir, 'detect')
                            
                            models.append({
                                'id': f'detect_{train_dir.name}',
                                'name': f'YOLO11_detect_{train_dir.name}',
                                'label': f'YOLO11 Detección ({train_dir.name})',
                                'value': f'detect_{train_dir.name}',
                                'path': str(best_model),
                                'task': 'detect',
                                'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M'),
                                'size': f'{stat.st_size / 1024 / 1024:.1f} MB',
                                'accuracy': training_metrics['mAP'],
                                'mAP': training_metrics['mAP'],
                                'precision': training_metrics['precision'],
                                'recall': training_metrics['recall'],
                                'epochs': training_metrics['epochs'],
                                'timestamp': stat.st_mtime
                            })
            
            # Buscar entrenamientos de segmentación (estructura antigua)
            segment_dir = runs_dir / 'segment'
            if segment_dir.exists():
                for train_dir in segment_dir.glob('train*'):
                    weights_dir = train_dir / 'weights'
                    if weights_dir.exists():
                        best_model = weights_dir / 'best.pt'
                        
                        if best_model.exists():
                            stat = best_model.stat()
                            
                            # Leer métricas desde results.csv
                            training_metrics = self._read_training_metrics(train_dir, 'segment')
                            
                            models.append({
                                'id': f'segment_{train_dir.name}',
                                'name': f'YOLO11_segment_{train_dir.name}',
                                'label': f'YOLO11 Segmentación ({train_dir.name})',
                                'value': f'segment_{train_dir.name}',
                                'path': str(best_model),
                                'task': 'segment',
                                'date': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M'),
                                'size': f'{stat.st_size / 1024 / 1024:.1f} MB',
                                'accuracy': training_metrics['mAP'],
                                'mAP': training_metrics['mAP'],
                                'precision': training_metrics['precision'],
                                'recall': training_metrics['recall'],
                                'epochs': training_metrics['epochs'],
                                'timestamp': stat.st_mtime
                            })
            
            # Ordenar modelos del más reciente al más antiguo
            models.sort(key=lambda x: x['timestamp'], reverse=True)
            
            # Remover el campo timestamp antes de enviar
            for model in models:
                del model['timestamp']
            
            return {'ok': True, 'models': models}
            
        except Exception as e:
            print(f"[get_trained_models] Error: {e}")
            return {'models': [], 'error': str(e)}
    
    def get_training_history(self, model_path: str):
        """Obtiene el historial completo de entrenamiento desde results.csv
        
        Args:
            model_path: Ruta al modelo best.pt o last.pt
            
        Returns:
            Dict con epochs (lista de números) y metrics (dict con listas de valores por métrica)
        """
        try:
            # Obtener el directorio de entrenamiento desde la ruta del modelo
            model_path_obj = Path(model_path)
            train_dir = model_path_obj.parent.parent  # weights/best.pt -> weights -> train_dir
            
            results_csv = train_dir / 'results.csv'
            if not results_csv.exists():
                return {'ok': False, 'error': 'No se encontró el archivo results.csv'}
            
            import csv
            
            # Leer el archivo CSV completo
            with open(results_csv, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
            
            if not rows:
                return {'ok': False, 'error': 'El archivo results.csv está vacío'}
            
            # Obtener todas las columnas disponibles (excluyendo 'epoch' y 'time')
            all_columns = list(rows[0].keys())
            metric_columns = [col for col in all_columns if col not in ['epoch', 'time']]
            
            # Construir estructura de datos
            epochs = []
            metrics = {col: [] for col in metric_columns}
            
            for row in rows:
                try:
                    epochs.append(int(row['epoch']))
                    for col in metric_columns:
                        value = float(row.get(col, 0))
                        metrics[col].append(value)
                except (ValueError, KeyError) as e:
                    print(f"[get_training_history] Error procesando fila: {e}")
                    continue
            
            return {
                'ok': True,
                'epochs': epochs,
                'metrics': metrics,
                'columns': metric_columns
            }
            
        except Exception as e:
            print(f"[get_training_history] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': str(e)}
    
    def get_confusion_matrices(self, model_path: str):
        """Obtiene las matrices de confusión generadas por YOLO
        
        Args:
            model_path: Ruta al modelo best.pt o last.pt
            
        Returns:
            Dict con las imágenes de las matrices en base64
        """
        try:
            # Obtener el directorio de entrenamiento desde la ruta del modelo
            model_path_obj = Path(model_path)
            train_dir = model_path_obj.parent.parent  # weights/best.pt -> weights -> train_dir
            
            matrices = {}
            
            # Buscar matriz de confusión normal
            confusion_matrix_path = train_dir / 'confusion_matrix.png'
            if confusion_matrix_path.exists():
                with open(confusion_matrix_path, 'rb') as f:
                    matrices['confusion_matrix'] = base64.b64encode(f.read()).decode('utf-8')
            
            # Buscar matriz de confusión normalizada
            confusion_matrix_normalized_path = train_dir / 'confusion_matrix_normalized.png'
            if confusion_matrix_normalized_path.exists():
                with open(confusion_matrix_normalized_path, 'rb') as f:
                    matrices['confusion_matrix_normalized'] = base64.b64encode(f.read()).decode('utf-8')
            
            if not matrices:
                return {
                    'ok': False, 
                    'error': 'No se encontraron matrices de confusión. Es posible que el modelo no haya sido entrenado con validación.'
                }
            
            return {
                'ok': True,
                'matrices': matrices
            }
            
        except Exception as e:
            print(f"[get_confusion_matrices] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': str(e)}
    
    def load_external_model(self):
        """Permite seleccionar y cargar un modelo externo (.pt)"""
        try:
            # Usar tkinter para seleccionar archivo
            import tkinter as tk
            from tkinter import filedialog
            
            # Crear ventana raíz temporal (oculta)
            root = tk.Tk()
            root.withdraw()
            
            # Abrir diálogo de selección de archivo
            file_path = filedialog.askopenfilename(
                title="Seleccionar modelo YOLO (.pt)",
                filetypes=[
                    ("Modelos YOLO", "*.pt"),
                    ("Todos los archivos", "*.*")
                ]
            )
            
            root.destroy()
            
            if not file_path:
                return {'ok': False, 'error': 'No se seleccionó ningún archivo'}
            
            # Verificar que el archivo existe
            model_path = Path(file_path)
            if not model_path.exists():
                return {'ok': False, 'error': 'El archivo seleccionado no existe'}
            
            # Obtener información del modelo
            stat = model_path.stat()
            
            # Crear información del modelo externo
            model_info = {
                'id': f'external_{model_path.stem}',
                'name': model_path.name,
                'label': f'Modelo Externo ({model_path.name})',
                'value': f'external_{model_path.stem}',
                'path': str(model_path),
                'task': 'unknown',  # No sabemos el tipo hasta cargarlo
                'date': str(datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d')),
                'size': f'{stat.st_size / 1024 / 1024:.1f} MB',
                'accuracy': 0.0,
                'external': True
            }
            
            return {'model': model_info, 'ok': True}
            
        except Exception as e:
            print(f"[load_external_model] Error: {e}")
            return {'ok': False, 'error': str(e)}
    
    def select_image_for_prediction(self, multiple: bool = False):
        """Permite seleccionar una o múltiples imágenes para predicción"""
        try:
            # Usar pywebview para seleccionar archivo(s)
            if not webview.windows:
                return {'ok': False, 'error': 'No hay ventanas disponibles'}
            
            win = webview.windows[0]
            
            # Usar OPEN_DIALOG del módulo webview
            open_type = getattr(webview, 'OPEN_DIALOG', 0)
            
            # Tipos de archivo para el diálogo
            file_types = ('Imágenes (*.jpg;*.jpeg;*.png;*.bmp;*.tiff;*.tif)', 'Todos los archivos (*.*)')
            
            # Seleccionar archivo(s)
            result = win.create_file_dialog(
                open_type,
                allow_multiple=multiple,
                file_types=file_types,
                directory='.'
            )
            
            if not result:
                return {'ok': False, 'error': 'No se seleccionaron archivos'}
            
            # result puede ser una tupla/lista o un string individual
            if isinstance(result, (list, tuple)):
                file_paths = [str(p) for p in result]
            else:
                file_paths = [str(result)]
            
            if multiple:
                # Procesar múltiples imágenes
                images_data = []
                for file_path in file_paths:
                    image_path = Path(file_path)
                    if not image_path.exists():
                        continue
                    
                    # Convertir imagen a base64
                    image_base64 = None
                    try:
                        import base64
                        with open(image_path, 'rb') as image_file:
                            image_data = image_file.read()
                            image_base64 = base64.b64encode(image_data).decode('utf-8')
                    except Exception as e:
                        print(f"[select_image_for_prediction] Error convirtiendo a base64: {e}")
                        # Continuar sin base64 si hay error
                    
                    images_data.append({
                        'image_path': str(image_path),
                        'image_base64': image_base64,
                        'name': image_path.name
                    })
                
                return {
                    'images': images_data,
                    'total_count': len(images_data),
                    'ok': True
                }
            else:
                # Selección individual
                image_path = Path(file_paths[0])
                if not image_path.exists():
                    return {'ok': False, 'error': 'El archivo seleccionado no existe'}
                
                # Convertir imagen a base64
                image_base64 = None
                try:
                    import base64
                    with open(image_path, 'rb') as image_file:
                        image_data = image_file.read()
                        image_base64 = base64.b64encode(image_data).decode('utf-8')
                except Exception as e:
                    print(f"[select_image_for_prediction] Error convirtiendo a base64: {e}")
                    # Continuar sin base64 si hay error
                
                return {
                    'image_path': str(image_path), 
                    'image_base64': image_base64,
                    'ok': True
                }
            
        except Exception as e:
            print(f"[select_image_for_prediction] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': str(e)}

    def select_folder_images(self):
        """Selecciona todas las imágenes de una carpeta"""
        try:
            # Usar pywebview para seleccionar carpeta
            if not webview.windows:
                return {'ok': False, 'error': 'No hay ventanas disponibles'}
            
            win = webview.windows[0]
            
            # Usar FOLDER_DIALOG del módulo webview
            folder_type = getattr(webview, 'FOLDER_DIALOG', 2)
            
            # Seleccionar carpeta
            result = win.create_file_dialog(
                folder_type,
                directory='.'
            )
            
            if not result:
                return {'ok': False, 'error': 'No se seleccionó ninguna carpeta'}
            
            # Obtener la ruta de la carpeta
            folder_path = result[0] if isinstance(result, (list, tuple)) else result
            folder = Path(str(folder_path))
            
            if not folder.exists():
                return {'ok': False, 'error': 'La carpeta seleccionada no existe'}
            
            # Extensiones de imagen soportadas
            image_extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'}
            
            # Buscar archivos de imagen
            images_data = []
            for file_path in folder.iterdir():
                if file_path.is_file() and file_path.suffix.lower() in image_extensions:
                    # Convertir imagen a base64
                    image_base64 = None
                    try:
                        import base64
                        with open(file_path, 'rb') as image_file:
                            image_data = image_file.read()
                            image_base64 = base64.b64encode(image_data).decode('utf-8')
                    except Exception as e:
                        print(f"[select_folder_images] Error convirtiendo a base64: {e}")
                        # Continuar sin base64 si hay error
                    
                    images_data.append({
                        'image_path': str(file_path),
                        'image_base64': image_base64,
                        'name': file_path.name
                    })
            
            if not images_data:
                return {'ok': False, 'error': 'No se encontraron imágenes en la carpeta seleccionada'}
            
            # Ordenar por nombre
            images_data.sort(key=lambda x: x['name'])
            
            return {
                'images': images_data,
                'total_count': len(images_data),
                'folder_path': str(folder),
                'ok': True
            }
            
        except Exception as e:
            print(f"[select_folder_images] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': str(e)}
    
    def predict_image(self, model_path: str, image_path: str, confidence: float = 0.5, iou: float = 0.4, max_det: int = 100):
        """Realiza predicción en una imagen usando un modelo YOLO"""
        try:
            import time
            import threading
            
            # Verificar que los archivos existen
            model_file = Path(model_path)
            image_file = Path(image_path)
            
            if not model_file.exists():
                return {'ok': False, 'error': f'Modelo no encontrado: {model_path}'}
            
            if not image_file.exists():
                return {'ok': False, 'error': f'Imagen no encontrada: {image_path}'}
            
            print(f"[predict_image] Iniciando predicción")
            print(f"[predict_image] Modelo: {model_path}")
            print(f"[predict_image] Imagen: {image_path}")
            
            # Importar YOLO
            from ultralytics import YOLO
            
            # Variable para almacenar el resultado
            result_container = {'result': None, 'error': None, 'completed': False}
            
            def run_prediction():
                try:
                    # Cargar el modelo con configuración optimizada
                    print(f"[predict_image] Cargando modelo...")
                    model = YOLO(model_path)
                    
                    print(f"[predict_image] Procesando imagen...")
                    
                    # Realizar predicción con configuración optimizada
                    results = model.predict(
                        source=image_path,
                        conf=confidence,
                        iou=iou,
                        max_det=max_det,
                        save=False,
                        show=False,
                        verbose=False,
                        stream=False  # No usar streaming para una sola imagen
                    )
                    
                    print(f"[predict_image] Predicción completada, procesando resultados...")
                    
                    # Procesar resultados
                    predictions = []
                    if results and len(results) > 0:
                        result = results[0]  # Solo una imagen
                        
                        # Obtener nombres de clases
                        class_names = model.names if hasattr(model, 'names') else {}
                        
                        # Procesar detecciones
                        if hasattr(result, 'boxes') and result.boxes is not None:
                            boxes = result.boxes
                            num_boxes = len(boxes) if boxes is not None else 0
                            print(f"[predict_image] Procesando {num_boxes} detecciones...")
                            
                            for i in range(num_boxes):
                                try:
                                    # Obtener datos de la caja
                                    box = boxes.xyxy[i].cpu().numpy()  # [x1, y1, x2, y2]
                                    conf = float(boxes.conf[i].cpu().item())  # confianza
                                    cls = int(boxes.cls[i].cpu().item())  # clase
                                    
                                    # Nombre de la clase
                                    class_name = class_names.get(cls, f'clase_{cls}')
                                    
                                    predictions.append({
                                        'class': class_name,
                                        'class_id': cls,
                                        'confidence': conf,
                                        'bbox': [float(box[0]), float(box[1]), float(box[2]), float(box[3])],  # [x1, y1, x2, y2]
                                        'bbox_string': f"{int(box[0])},{int(box[1])},{int(box[2])},{int(box[3])}"
                                    })
                                except Exception as box_error:
                                    print(f"[predict_image] Error procesando caja {i}: {box_error}")
                                    continue
                        
                        # Si es segmentación, también procesar máscaras
                        if hasattr(result, 'masks') and result.masks is not None:
                            print(f"[predict_image] Procesando máscaras de segmentación...")
                            try:
                                masks = result.masks
                                for i, mask in enumerate(masks.xy):  # Obtener coordenadas de los polígonos
                                    if i < len(predictions):
                                        # Convertir puntos de máscara a lista
                                        mask_points = mask.tolist() if hasattr(mask, 'tolist') else []
                                        predictions[i]['mask'] = mask_points
                            except Exception as mask_error:
                                print(f"[predict_image] Error procesando máscaras: {mask_error}")
                    
                    print(f"[predict_image] Completado. {len(predictions)} detecciones encontradas")
                    
                    # Generar imagen con predicciones y guardar en carpeta correcta
                    prediction_image_base64 = None
                    original_image_base64 = None
                    try:
                        print(f"[predict_image] Generando imagen resultado...")
                        import cv2
                        import base64
                        from datetime import datetime
                        
                        # Crear carpeta predicts basada en la ruta del modelo
                        model_dir = Path(model_path).parent.parent  # Subir dos niveles desde weights
                        predicts_dir = model_dir / "predicts"
                        predicts_dir.mkdir(exist_ok=True)
                        
                        # Generar nombres únicos para las imágenes
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        image_name = Path(image_path).stem
                        
                        # Paths para guardar las imágenes
                        original_save_path = predicts_dir / f"{image_name}_{timestamp}_original.jpg"
                        prediction_save_path = predicts_dir / f"{image_name}_{timestamp}_prediction.jpg"
                        
                        print(f"[predict_image] Guardando en: {predicts_dir}")
                        
                        # Cargar imagen original y convertir a base64
                        original_img = cv2.imread(image_path)
                        if original_img is not None:
                            # Guardar copia de imagen original
                            cv2.imwrite(str(original_save_path), original_img)
                            
                            # Convertir imagen original a base64
                            _, buffer = cv2.imencode('.jpg', original_img)
                            original_image_base64 = base64.b64encode(buffer).decode('utf-8')
                        
                        # Usar el método plot de ultralytics para generar imagen con detecciones
                        if results and len(results) > 0:
                            result_img = results[0].plot()  # Genera imagen con cajas y etiquetas
                            
                            # Guardar la imagen con predicciones
                            cv2.imwrite(str(prediction_save_path), result_img)
                            
                            # Convertir imagen de predicción a base64
                            _, buffer = cv2.imencode('.jpg', result_img)
                            prediction_image_base64 = base64.b64encode(buffer).decode('utf-8')
                            
                            print(f"[predict_image] Imágenes guardadas exitosamente")
                            print(f"[predict_image] Original: {original_save_path}")
                            print(f"[predict_image] Predicción: {prediction_save_path}")
                        
                    except Exception as img_error:
                        print(f"[predict_image] Error generando imagen resultado: {img_error}")
                        import traceback
                        traceback.print_exc()
                        # Continuar sin imagen si hay error
                    
                    result_container['result'] = {
                        'ok': True,
                        'predictions': predictions,
                        'image_path': image_path,
                        'model_path': model_path,
                        'total_detections': len(predictions),
                        'original_image_base64': original_image_base64,
                        'prediction_image_base64': prediction_image_base64
                    }
                    result_container['completed'] = True
                    
                except Exception as e:
                    print(f"[predict_image] Error en thread: {e}")
                    import traceback
                    traceback.print_exc()
                    result_container['error'] = str(e)
                    result_container['completed'] = True
            
            # Ejecutar predicción en un thread separado
            thread = threading.Thread(target=run_prediction)
            thread.daemon = True
            thread.start()
            
            # Esperar hasta 60 segundos
            timeout = 60
            start_time = time.time()
            while not result_container['completed'] and (time.time() - start_time) < timeout:
                time.sleep(0.1)
            
            if not result_container['completed']:
                return {'ok': False, 'error': 'Predicción timeout (60s). El modelo puede ser muy pesado o la imagen muy grande.'}
            
            if result_container['error']:
                return {'ok': False, 'error': f'Error en predicción: {result_container["error"]}'}
            
            return result_container['result']
            
        except Exception as e:
            print(f"[predict_image] Error general: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': f'Error en predicción: {str(e)}'}

    def predict_multiple_images(self, model_path: str, image_paths: List[str], confidence: float = 0.5, iou: float = 0.4, max_det: int = 100):
        """Realiza predicción en múltiples imágenes usando un modelo YOLO"""
        try:
            print(f"[predict_multiple_images] Iniciando predicción de {len(image_paths)} imágenes")
            print(f"[predict_multiple_images] Modelo: {model_path}")
            
            # Verificar que el modelo existe
            model_file = Path(model_path)
            if not model_file.exists():
                return {'ok': False, 'error': f'Modelo no encontrado: {model_path}'}
            
            # Verificar imágenes
            valid_images = []
            for img_path in image_paths:
                if Path(img_path).exists():
                    valid_images.append(img_path)
                else:
                    print(f"[predict_multiple_images] Imagen no encontrada: {img_path}")
            
            if not valid_images:
                return {'ok': False, 'error': 'No se encontraron imágenes válidas'}
            
            # Variable para almacenar los resultados
            results_container = {'results': [], 'error': None, 'completed': False, 'current_index': 0}
            
            def run_batch_prediction():
                try:
                    # Importar YOLO
                    from ultralytics import YOLO
                    
                    # Cargar el modelo una sola vez
                    print(f"[predict_multiple_images] Cargando modelo...")
                    model = YOLO(model_path)
                    
                    # Crear carpeta predicts
                    model_dir = Path(model_path).parent.parent
                    predicts_dir = model_dir / "predicts"
                    predicts_dir.mkdir(exist_ok=True)
                    
                    results = []
                    
                    for idx, image_path in enumerate(valid_images):
                        try:
                            print(f"[predict_multiple_images] Procesando imagen {idx + 1}/{len(valid_images)}: {Path(image_path).name}")
                            results_container['current_index'] = idx
                            
                            # Realizar predicción
                            pred_results = model.predict(
                                source=image_path,
                                conf=confidence,
                                iou=iou,
                                max_det=max_det,
                                save=False,
                                show=False,
                                verbose=False,
                                stream=False
                            )
                            
                            # Procesar resultados para esta imagen
                            predictions = []
                            original_image_base64 = None
                            prediction_image_base64 = None
                            
                            if pred_results and len(pred_results) > 0:
                                result = pred_results[0]
                                
                                # Obtener nombres de clases
                                class_names = model.names if hasattr(model, 'names') else {}
                                
                                # Procesar detecciones
                                if hasattr(result, 'boxes') and result.boxes is not None:
                                    boxes = result.boxes
                                    num_boxes = len(boxes) if boxes is not None else 0
                                    
                                    for i in range(num_boxes):
                                        try:
                                            box = boxes.xyxy[i].cpu().numpy()
                                            conf = float(boxes.conf[i].cpu().item())
                                            cls = int(boxes.cls[i].cpu().item())
                                            
                                            class_name = class_names.get(cls, f'clase_{cls}')
                                            
                                            predictions.append({
                                                'class': class_name,
                                                'class_id': cls,
                                                'confidence': conf,
                                                'bbox': [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
                                                'bbox_string': f"{int(box[0])},{int(box[1])},{int(box[2])},{int(box[3])}"
                                            })
                                        except Exception as box_error:
                                            print(f"[predict_multiple_images] Error procesando caja {i}: {box_error}")
                                            continue
                                
                                # Procesar máscaras si es segmentación
                                if hasattr(result, 'masks') and result.masks is not None:
                                    try:
                                        masks = result.masks
                                        for i, mask in enumerate(masks.xy):
                                            if i < len(predictions):
                                                mask_points = mask.tolist() if hasattr(mask, 'tolist') else []
                                                predictions[i]['mask'] = mask_points
                                    except Exception as mask_error:
                                        print(f"[predict_multiple_images] Error procesando máscaras: {mask_error}")
                            
                            # Generar imágenes
                            try:
                                import cv2
                                import base64
                                from datetime import datetime
                                
                                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                                image_name = Path(image_path).stem
                                
                                original_save_path = predicts_dir / f"{image_name}_{timestamp}_original.jpg"
                                prediction_save_path = predicts_dir / f"{image_name}_{timestamp}_prediction.jpg"
                                
                                # Cargar imagen original
                                original_img = cv2.imread(image_path)
                                if original_img is not None:
                                    cv2.imwrite(str(original_save_path), original_img)
                                    _, buffer = cv2.imencode('.jpg', original_img)
                                    original_image_base64 = base64.b64encode(buffer).decode('utf-8')
                                
                                # Generar imagen con predicciones
                                if pred_results and len(pred_results) > 0:
                                    result_img = pred_results[0].plot()
                                    cv2.imwrite(str(prediction_save_path), result_img)
                                    _, buffer = cv2.imencode('.jpg', result_img)
                                    prediction_image_base64 = base64.b64encode(buffer).decode('utf-8')
                                
                            except Exception as img_error:
                                print(f"[predict_multiple_images] Error generando imágenes para {image_path}: {img_error}")
                            
                            # Agregar resultado
                            results.append({
                                'image_path': image_path,
                                'image_name': Path(image_path).name,
                                'predictions': predictions,
                                'total_detections': len(predictions),
                                'original_image_base64': original_image_base64,
                                'prediction_image_base64': prediction_image_base64,
                                'index': idx
                            })
                            
                        except Exception as img_error:
                            print(f"[predict_multiple_images] Error procesando imagen {image_path}: {img_error}")
                            # Agregar resultado con error
                            results.append({
                                'image_path': image_path,
                                'image_name': Path(image_path).name,
                                'predictions': [],
                                'total_detections': 0,
                                'original_image_base64': None,
                                'prediction_image_base64': None,
                                'index': idx,
                                'error': str(img_error)
                            })
                            continue
                    
                    results_container['results'] = results
                    results_container['completed'] = True
                    print(f"[predict_multiple_images] Completado. Procesadas {len(results)} imágenes")
                    
                except Exception as e:
                    print(f"[predict_multiple_images] Error en thread: {e}")
                    import traceback
                    traceback.print_exc()
                    results_container['error'] = str(e)
                    results_container['completed'] = True
            
            # Ejecutar predicción en un thread separado
            import threading
            thread = threading.Thread(target=run_batch_prediction)
            thread.daemon = True
            thread.start()
            
            # Esperar hasta 300 segundos (5 minutos) para múltiples imágenes
            timeout = 300
            start_time = time.time()
            while not results_container['completed'] and (time.time() - start_time) < timeout:
                time.sleep(0.1)
            
            if not results_container['completed']:
                return {'ok': False, 'error': f'Predicción timeout ({timeout}s). El proceso puede ser muy lento.'}
            
            if results_container['error']:
                return {'ok': False, 'error': f'Error en predicción: {results_container["error"]}'}
            
            return {
                'ok': True,
                'results': results_container['results'],
                'total_images': len(results_container['results']),
                'model_path': model_path
            }
            
        except Exception as e:
            print(f"[predict_multiple_images] Error general: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': f'Error en predicción múltiple: {str(e)}'}

    # --- Gestión de proyectos recientes ---
    def _get_recents_file(self) -> Path:
        """Obtiene la ruta del archivo de proyectos recientes"""
        # Guardar en el directorio del usuario
        home = Path.home()
        app_data = home / '.yolo_annotator'
        ensure_dir(app_data)
        return app_data / 'recent_projects.json'

    def get_recent_projects(self) -> Dict[str, Any]:
        """Obtiene la lista de proyectos recientes"""
        try:
            recents_file = self._get_recents_file()
            if not recents_file.exists():
                return {'ok': True, 'projects': []}
            
            with open(recents_file, 'r', encoding='utf-8') as f:
                projects = json.load(f)
            
            # Validar que los proyectos todavía existen
            valid_projects = []
            for project in projects:
                config_path = Path(project.get('configPath', ''))
                if config_path.exists():
                    valid_projects.append(project)
            
            # Si hubo cambios, guardar la lista actualizada
            if len(valid_projects) != len(projects):
                with open(recents_file, 'w', encoding='utf-8') as f:
                    json.dump(valid_projects, f, ensure_ascii=False, indent=2)
            
            return {'ok': True, 'projects': valid_projects}
        except Exception as e:
            print(f"[get_recent_projects] Error: {e}")
            return {'ok': False, 'error': str(e), 'projects': []}

    def add_recent_project(self, name: str, config_path: str) -> Dict[str, Any]:
        """Agrega un proyecto a la lista de recientes"""
        try:
            recents_file = self._get_recents_file()
            
            # Cargar proyectos existentes
            projects = []
            if recents_file.exists():
                with open(recents_file, 'r', encoding='utf-8') as f:
                    projects = json.load(f)
            
            # Eliminar el proyecto si ya existe (para moverlo al inicio)
            projects = [p for p in projects if p.get('configPath') != config_path]
            
            # Agregar al inicio
            projects.insert(0, {
                'name': name,
                'configPath': config_path,
                'openedAt': int(time.time() * 1000)  # timestamp en milisegundos
            })
            
            # Mantener solo los últimos 10
            projects = projects[:10]
            
            # Guardar
            with open(recents_file, 'w', encoding='utf-8') as f:
                json.dump(projects, f, ensure_ascii=False, indent=2)
            
            return {'ok': True, 'projects': projects}
        except Exception as e:
            print(f"[add_recent_project] Error: {e}")
            return {'ok': False, 'error': str(e)}

    def clear_recent_projects(self) -> Dict[str, Any]:
        """Limpia la lista de proyectos recientes"""
        try:
            recents_file = self._get_recents_file()
            if recents_file.exists():
                recents_file.unlink()
            return {'ok': True}
        except Exception as e:
            print(f"[clear_recent_projects] Error: {e}")
            return {'ok': False, 'error': str(e)}

    def open_user_manual(self) -> Dict[str, Any]:
        """Abre el manual de usuario en PDF con el visor predeterminado del sistema"""
        try:
            # Obtener la ruta del manual
            # El manual está en angular/public/manual.pdf
            # Desde api.py, necesitamos subir al directorio raíz del proyecto
            current_file = Path(__file__).resolve()  # .../python/app_core/api.py
            project_root = current_file.parent.parent.parent  # Subir 3 niveles
            manual_path = project_root / 'angular' / 'public' / 'manual.pdf'
            
            print(f"[open_user_manual] Buscando manual en: {manual_path}")
            
            if not manual_path.exists():
                error_msg = f'Manual no encontrado en: {manual_path}'
                print(f"[open_user_manual] ERROR: {error_msg}")
                return {'ok': False, 'error': error_msg}
            
            # Abrir el PDF con el visor predeterminado del sistema
            import platform
            system = platform.system()
            
            if system == 'Windows':
                os.startfile(str(manual_path))
            elif system == 'Darwin':  # macOS
                subprocess.run(['open', str(manual_path)])
            else:  # Linux
                subprocess.run(['xdg-open', str(manual_path)])
            
            print(f"[open_user_manual] Manual abierto correctamente")
            return {'ok': True, 'path': str(manual_path)}
            
        except Exception as e:
            print(f"[open_user_manual] Error: {e}")
            import traceback
            traceback.print_exc()
            return {'ok': False, 'error': str(e)}
