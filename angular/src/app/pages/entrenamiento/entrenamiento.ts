import { Component, signal, inject, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ChangeDetectionStrategy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronsUpDown, lucideSearch } from '@ng-icons/lucide';
import { BrnCommandImports } from '@spartan-ng/brain/command';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { ProjectService } from '../../services/project.service';
import { PythonApiService } from '../../services/python-api.service';

// Declaraciones globales para funciones Python
declare global {
  interface Window {
    __pushLog?: (msg: string) => void;
    __updateTrainingData?: (data: any) => void;
    __trainingFinished?: () => void;
  }
}

interface Model {
  id: string;
  name: string;
  label: string;
  value: string;
  category: string;
  description: string;
  size: string;
  speed: string;
  accuracy: number;
  parameters: string;
  isOfficial: boolean;
  tags: string[];
}

interface ImageSize {
  label: string;
  value: string;
}

interface Training {
  id: number;
  date: string;
  model: string;
  epochs: number;
  mAP: number;
}

@Component({
  selector: 'app-entrenamiento',
  imports: [
    CommonModule,
    BrnSelectImports,
    HlmSelectImports,
    FormsModule,
    BrnCommandImports,
    HlmCommandImports,
    NgIcon,
    HlmIcon,
    HlmButton,
    BrnPopover,
    BrnPopoverTrigger,
    HlmPopoverContent,
    BrnPopoverContent,
  ],
  providers: [provideIcons({ lucideChevronsUpDown, lucideSearch, lucideCheck })],
  templateUrl: './entrenamiento.html',
  styleUrl: './entrenamiento.scss',
  changeDetection: ChangeDetectionStrategy.Default,
})
export class Entrenamiento implements OnInit, OnDestroy {
  // ====== estado UI (coinciden con tu entrenamiento.html) ======
  trainingLogs: string[] = [];
  isTraining = false;

  selectedTask: 'detect' | 'segment' = 'detect';
  isTaskLocked = false; // Se bloquea cuando hay un proyecto abierto
  selectedModel = 'yolo11n.pt'; // para segmentación: 'yolo11n-seg.pt'
  batchSize = 16;
  learningRate = 0.01;
  imageSize = 640;

  datasetYamlPath: string | null = null;

  trainingProgress = 0;
  currentEpoch = 0;
  totalEpochs = 10;
  isModelModalOpen = false;

  // Nuevas propiedades para visualización
  downloadProgress = 0;
  trainingStatus: 'idle' | 'downloading' | 'training' | 'validating' | 'completed' | 'error' = 'idle';
  metricsHistory: any[] = [];
  currentMetrics = {
    box_loss: 0,
    seg_loss: 0,
    cls_loss: 0,
    dfl_loss: 0,
    instances: 0
  };
  modelSummary: any = {};

  // Datos de verificación del dataset
  datasetInfo = {
    train_images: 0,
    val_images: 0,
    test_images: 0,
    total_classes: 0,
    class_names: [] as string[],
    is_loaded: false,
    loading: false,
    error: null as string | null
  };

  // Datos de recursos del sistema
  systemResources = {
    cpu: {
      percent: 0,
      count: 0
    },
    memory: {
      percent: 0,
      used_gb: 0,
      total_gb: 0
    },
    gpu: {
      gpu_available: false,
      gpu_name: '',
      gpu_memory_used_gb: 0,
      gpu_memory_total_gb: 0,
      gpu_utilization: 0,
      gpu_memory_percent: 0,
      gpu_temperature: 0
    },
    disk: {
      percent: 0
    },
    process: {
      memory_mb: 0,
      cpu_percent: 0
    },
    loading: true,
    error: null as string | null
  };

  private resourcesInterval: any = null;

  // Estados de acordeones
  isDatasetExpanded = true;
  isResourcesExpanded = false;

  // Estados para combobox
  public currentModelData = signal<Model | undefined>(undefined);
  public modelComboboxState = signal<'closed' | 'open'>('closed');
  public currentImageSize = signal<ImageSize | undefined>(undefined);
  public imageSizeComboboxState = signal<'closed' | 'open'>('closed');

  // Datos para combobox
  availableModels: Model[] = [
    // Modelos de Detección
    {
      id: 'yolo11n',
      name: 'YOLO11n',
      label: 'YOLO11n (Detección - Nano)',
      value: 'yolo11n.pt',
      category: 'detection',
      description: 'Modelo más liviano para detección',
      size: '2.6 MB',
      speed: 'Fast',
      accuracy: 85,
      parameters: '2.6M',
      isOfficial: true,
      tags: ['nano', 'fast', 'detection'],
    },
    {
      id: 'yolo11s',
      name: 'YOLO11s',
      label: 'YOLO11s (Detección - Small)',
      value: 'yolo11s.pt',
      category: 'detection',
      description: 'Balance entre velocidad y precisión',
      size: '9.4 MB',
      speed: 'Medium',
      accuracy: 88,
      parameters: '9.4M',
      isOfficial: true,
      tags: ['small', 'balanced', 'detection'],
    },
    {
      id: 'yolo11m',
      name: 'YOLO11m',
      label: 'YOLO11m (Detección - Medium)',
      value: 'yolo11m.pt',
      category: 'detection',
      description: 'Buena precisión',
      size: '20.1 MB',
      speed: 'Medium',
      accuracy: 91,
      parameters: '20.1M',
      isOfficial: true,
      tags: ['medium', 'accurate', 'detection'],
    },
    {
      id: 'yolo11l',
      name: 'YOLO11l',
      label: 'YOLO11l (Detección - Large)',
      value: 'yolo11l.pt',
      category: 'detection',
      description: 'Alta precisión',
      size: '25.3 MB',
      speed: 'Slow',
      accuracy: 93,
      parameters: '25.3M',
      isOfficial: true,
      tags: ['large', 'accurate', 'detection'],
    },
    {
      id: 'yolo11x',
      name: 'YOLO11x',
      label: 'YOLO11x (Detección - Extra Large)',
      value: 'yolo11x.pt',
      category: 'detection',
      description: 'Máxima precisión',
      size: '56.9 MB',
      speed: 'Very Slow',
      accuracy: 95,
      parameters: '56.9M',
      isOfficial: true,
      tags: ['xlarge', 'best', 'detection'],
    },
    // Modelos de Segmentación
    {
      id: 'yolo11n-seg',
      name: 'YOLO11n-seg',
      label: 'YOLO11n-seg (Segmentación - Nano)',
      value: 'yolo11n-seg.pt',
      category: 'segmentation',
      description: 'Modelo más liviano para segmentación',
      size: '2.9 MB',
      speed: 'Fast',
      accuracy: 82,
      parameters: '2.9M',
      isOfficial: true,
      tags: ['nano', 'fast', 'segmentation'],
    },
    {
      id: 'yolo11s-seg',
      name: 'YOLO11s-seg',
      label: 'YOLO11s-seg (Segmentación - Small)',
      value: 'yolo11s-seg.pt',
      category: 'segmentation',
      description: 'Balance para segmentación',
      size: '10.1 MB',
      speed: 'Medium',
      accuracy: 85,
      parameters: '10.1M',
      isOfficial: true,
      tags: ['small', 'balanced', 'segmentation'],
    },
    {
      id: 'yolo11m-seg',
      name: 'YOLO11m-seg',
      label: 'YOLO11m-seg (Segmentación - Medium)',
      value: 'yolo11m-seg.pt',
      category: 'segmentation',
      description: 'Buena precisión para segmentación',
      size: '22.4 MB',
      speed: 'Medium',
      accuracy: 88,
      parameters: '22.4M',
      isOfficial: true,
      tags: ['medium', 'accurate', 'segmentation'],
    },
    {
      id: 'yolo11l-seg',
      name: 'YOLO11l-seg',
      label: 'YOLO11l-seg (Segmentación - Large)',
      value: 'yolo11l-seg.pt',
      category: 'segmentation',
      description: 'Alta precisión para segmentación',
      size: '27.6 MB',
      speed: 'Slow',
      accuracy: 90,
      parameters: '27.6M',
      isOfficial: true,
      tags: ['large', 'accurate', 'segmentation'],
    },
    {
      id: 'yolo11x-seg',
      name: 'YOLO11x-seg',
      label: 'YOLO11x-seg (Segmentación - Extra Large)',
      value: 'yolo11x-seg.pt',
      category: 'segmentation',
      description: 'Máxima precisión para segmentación',
      size: '62.1 MB',
      speed: 'Very Slow',
      accuracy: 92,
      parameters: '62.1M',
      isOfficial: true,
      tags: ['xlarge', 'best', 'segmentation'],
    },
  ];

  imageSizes: ImageSize[] = [
    { label: '320x320', value: '320' },
    { label: '416x416', value: '416' },
    { label: '512x512', value: '512' },
    { label: '640x640 (Recomendado)', value: '640' },
    { label: '736x736', value: '736' },
    { label: '832x832', value: '832' },
    { label: '1024x1024', value: '1024' },
  ];

  previousTrainings: Training[] = [];

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public projectService: ProjectService,
    private pythonApi: PythonApiService
  ) {
    // Efecto para cargar automáticamente el data.yaml cuando se abre un proyecto
    effect(() => {
      const project = this.projectService.project();
      if (project && project.root) {
        // Cargar el data.yaml del proyecto automáticamente
        this.loadProjectDataYaml(project);

        // Establecer la tarea del proyecto y bloquearla
        if (project.task) {
          this.selectedTask = project.task as 'detect' | 'segment';
          this.isTaskLocked = true;

          // Ajustar el modelo según la tarea del proyecto
          this.onTaskChange(this.selectedTask);

          this.addLog(`🔒 Tarea del proyecto: ${project.task === 'detect' ? 'Detección' : 'Segmentación'}`);
        }
      } else {
        // Si no hay proyecto, limpiar el dataset y desbloquear la tarea
        this.datasetYamlPath = null;
        this.isTaskLocked = false;
        this.resetDatasetInfo();
      }
    });
  }

  ngOnInit(): void {
    // Inicializar valores por defecto para combobox
    const defaultModel = this.availableModels.find(m => m.value === this.selectedModel);
    if (defaultModel) {
      this.currentModelData.set(defaultModel);
    }

    const defaultImageSize = this.imageSizes.find(s => s.value === this.imageSize.toString());
    if (defaultImageSize) {
      this.currentImageSize.set(defaultImageSize);
    }

    // función global para recibir logs desde Python
    window.__pushLog = (msg: string) => {
      this.ngZone.run(() => {
        this.trainingLogs.push(msg);
        // Forzar detección de cambios
        this.cdr.detectChanges();
        // Scroll automático al final del contenedor de logs
        setTimeout(() => {
          const logContainer = document.querySelector('.bg-gray-900');
          if (logContainer) {
            logContainer.scrollTop = logContainer.scrollHeight;
          }
        }, 50);
      });
    };

    // Función para recibir datos estructurados de entrenamiento
    window.__updateTrainingData = (data: any) => {
      this.ngZone.run(() => {
        this.updateTrainingData(data);
        this.cdr.detectChanges();
      });
    };

    // Función para manejar el final del entrenamiento
    window.__trainingFinished = () => {
      this.ngZone.run(() => {
        this.isTraining = false;
        this.trainingStatus = 'completed';
        this.cdr.detectChanges();
      });
    };

    // Iniciar monitoreo de recursos del sistema
    this.startResourcesMonitoring();

    // Escuchar cuando se cierra un proyecto
    const projectClosedListener = () => {
      this.resetComponentState();
    };
    document.addEventListener('project-closed', projectClosedListener);

    // Forzar detección inicial de cambios
    this.cdr.detectChanges();
  }

  ngOnDestroy(): void {
    // Limpieza si hiciera falta
    window.__pushLog = undefined;
    window.__updateTrainingData = undefined;
    window.__trainingFinished = undefined;
    // Detener monitoreo de recursos
    this.stopResourcesMonitoring();
  }

  /**
   * Resetea completamente el estado del componente al cerrar un proyecto
   */
  private resetComponentState(): void {
    this.ngZone.run(() => {
      // Limpiar logs
      this.trainingLogs = [];

      // Resetear estado de entrenamiento
      this.isTraining = false;
      this.trainingProgress = 0;
      this.currentEpoch = 0;
      this.totalEpochs = 10;
      this.trainingStatus = 'idle';
      this.downloadProgress = 0;

      // Limpiar métricas
      this.metricsHistory = [];
      this.currentMetrics = {
        box_loss: 0,
        seg_loss: 0,
        cls_loss: 0,
        dfl_loss: 0,
        instances: 0
      };
      this.modelSummary = {};

      // Resetear dataset
      this.datasetYamlPath = null;
      this.resetDatasetInfo();

      // Desbloquear tarea
      this.isTaskLocked = false;

      // Forzar detección de cambios
      this.cdr.detectChanges();

      console.log('✅ [ENTRENAMIENTO] Estado del componente reseteado');
    });
  }

  updateTrainingData(data: any) {
    switch (data.type) {
      case 'download_progress':
        this.downloadProgress = data.progress;
        this.trainingStatus = 'downloading';
        break;

      case 'training_start':
        this.totalEpochs = data.total_epochs;
        this.currentEpoch = 0;
        this.trainingStatus = 'training';
        break;

      case 'epoch_progress':
        this.currentEpoch = data.current_epoch;
        this.totalEpochs = data.total_epochs;
        this.trainingProgress = data.progress_percent;
        this.currentMetrics = data.metrics;
        this.metricsHistory.push(data.metrics);
        this.trainingStatus = 'training';
        break;

      case 'model_summary':
        this.modelSummary = {
          name: data.model_name,
          layers: data.layers,
          parameters: data.parameters
        };
        break;

      case 'validation_start':
        this.trainingStatus = 'validating';
        break;

      case 'training_completed':
        this.trainingStatus = 'completed';
        break;
    }
  }

  // Métodos para obtener nombres amigables de las métricas
  getMetricDisplayName(metric: string): string {
    const displayNames: {[key: string]: string} = {
      'box_loss': 'Pérdida de Caja',
      'seg_loss': 'Pérdida de Segmentación',
      'cls_loss': 'Pérdida de Clase',
      'dfl_loss': 'Pérdida DFL',
      'instances': 'Instancias'
    };
    return displayNames[metric] || metric;
  }

  getTrainingStatusMessage(): string {
    switch (this.trainingStatus) {
      case 'downloading': return 'Descargando modelo...';
      case 'training': return 'Entrenando...';
      case 'validating': return 'Validando...';
      case 'completed': return 'Completado';
      case 'error': return 'Error';
      default: return 'Inactivo';
    }
  }

  getLatestMetric(metricName: string): string {
    if (this.metricsHistory.length === 0) return '0.0000';
    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    return latest[metricName]?.toFixed(4) || '0.0000';
  }

  // Métodos para acordeones
  toggleDataset(): void {
    this.isDatasetExpanded = !this.isDatasetExpanded;
  }

  toggleResources(): void {
    this.isResourcesExpanded = !this.isResourcesExpanded;
  }

  // Método para cargar el data.yaml del proyecto automáticamente
  private async loadProjectDataYaml(project: any) {
    try {
      // Construir la ruta al data.yaml
      // Prioridad: 1) dataYamlPath en project config, 2) data.yaml en root del proyecto
      let dataYamlPath = project.dataYamlPath || `${project.root}\\data.yaml`;

      // Normalizar la ruta para Windows (reemplazar / por \)
      dataYamlPath = dataYamlPath.replace(/\//g, '\\');

      // Asegurarse de que no haya dobles barras invertidas consecutivas
      while (dataYamlPath.includes('\\\\')) {
        dataYamlPath = dataYamlPath.replace(/\\\\/g, '\\');
      }

      this.datasetYamlPath = dataYamlPath;

      // Establecer la ruta del dataset en el backend de Python
      const setPathResult = await (window.pywebview?.api as any)?.set_dataset_yaml_path(dataYamlPath);
      if (setPathResult && !setPathResult.ok) {
        this.addLog(`⚠️ Advertencia al establecer ruta: ${setPathResult.error}`);
      }

      // Verificar el dataset automáticamente
      await this.verificarDataset();
    } catch (error) {
      console.error('Error cargando data.yaml del proyecto:', error);
      this.datasetInfo.error = 'Error al cargar el dataset del proyecto';
      this.addLog(`❌ Error: ${error}`);
    }
  }

  getMetricBarHeight(metricName: string, value: number): number {
    if (this.metricsHistory.length === 0) return 0;

    // Calcular el rango para normalizar la altura de las barras
    const allValues = this.metricsHistory.map(m => m[metricName]).filter(v => v !== undefined);
    if (allValues.length === 0) return 0;

    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = maxValue - minValue;

    if (range === 0) return 50; // Si todos los valores son iguales

    // Normalizar entre 10% y 100% para mejor visualización
    const normalized = (value - minValue) / range;
    return 10 + (normalized * 90);
  }

  // Métodos para verificación del dataset
  getDatasetStatusIcon(count: number, type: 'train' | 'val' | 'test'): string {
    const thresholds = {
      train: { good: 1000, warning: 100 },
      val: { good: 200, warning: 50 },
      test: { good: 100, warning: 20 }
    };

    const threshold = thresholds[type];

    if (count >= threshold.good) {
      return 'w-4 h-4 text-green-500';
    } else if (count >= threshold.warning) {
      return 'w-4 h-4 text-yellow-500';
    } else {
      return 'w-4 h-4 text-red-500';
    }
  }

  getDatasetRecommendationClass(): string {
    const total = this.datasetInfo.train_images + this.datasetInfo.val_images + this.datasetInfo.test_images;

    if (total >= 5000) {
      return 'bg-green-50 border border-green-200 text-green-800';
    } else if (total >= 1000) {
      return 'bg-yellow-50 border border-yellow-200 text-yellow-800';
    } else {
      return 'bg-red-50 border border-red-200 text-red-800';
    }
  }

  getDatasetRecommendationIconClass(): string {
    const total = this.datasetInfo.train_images + this.datasetInfo.val_images + this.datasetInfo.test_images;

    if (total >= 5000) {
      return 'text-green-600';
    } else if (total >= 1000) {
      return 'text-yellow-600';
    } else {
      return 'text-red-600';
    }
  }

  getDatasetRecommendationIcon(): string {
    const total = this.datasetInfo.train_images + this.datasetInfo.val_images + this.datasetInfo.test_images;

    if (total >= 5000) {
      // Check icon
      return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
    } else if (total >= 1000) {
      // Warning icon
      return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z';
    } else {
      // X icon
      return 'M6 18L18 6M6 6l12 12';
    }
  }

  getDatasetRecommendationMessage(): string {
    const total = this.datasetInfo.train_images + this.datasetInfo.val_images + this.datasetInfo.test_images;

    if (total >= 5000) {
      return `Excelente: ${total.toLocaleString()} imágenes totales. Dataset ideal para entrenamiento.`;
    } else if (total >= 1000) {
      return `Aceptable: ${total.toLocaleString()} imágenes. Considera agregar más para mejores resultados.`;
    } else {
      return `Pequeño: ${total.toLocaleString()} imágenes. Recomendado: +1000 imágenes para mejores resultados.`;
    }
  }

  addLog(msg: string) {
    this.ngZone.run(() => {
      this.trainingLogs.push(msg);
      // Forzar detección de cambios para el log
      this.cdr.detectChanges();
      // Scroll automático al final del contenedor de logs
      setTimeout(() => {
        const logContainer = document.querySelector('.bg-gray-900');
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }, 50);
    });
  }

  // ====== acciones UI ======

  async seleccionarYaml() {
    try {
      this.addLog('🔍 Abriendo selector de archivo...');
      const res = await window.pywebview?.api?.select_dataset_yaml();

      // Ejecutar dentro de la zona de Angular para asegurar detección de cambios
      this.ngZone.run(() => {
        if (res?.ok && res.path) {
          this.datasetYamlPath = res.path;
          this.addLog(`✅ YAML seleccionado: ${res.path}`);

          // Verificar el dataset automáticamente
          this.verificarDataset();

          // Múltiples formas de asegurar la actualización de la UI
          this.cdr.detectChanges();
          this.cdr.markForCheck();

          // También forzar una actualización después de un pequeño delay
          setTimeout(() => {
            this.cdr.detectChanges();
          }, 100);
        } else {
          this.addLog(`❌ ${res?.error || 'Selección cancelada o archivo no válido'}`);
          this.datasetYamlPath = null;
          this.cdr.detectChanges();
        }
      });
    } catch (e: any) {
      this.ngZone.run(() => {
        this.addLog('❌ Error seleccionando YAML: ' + (e?.message || e));
        this.datasetYamlPath = null;
        this.cdr.detectChanges();
      });
    }
  }

  limpiarDataset() {
    this.ngZone.run(() => {
      this.datasetYamlPath = null;
      this.resetDatasetInfo();
      this.addLog('🗑️ Dataset deseleccionado');
      this.cdr.detectChanges();
    });
  }

  resetDatasetInfo() {
    this.datasetInfo = {
      train_images: 0,
      val_images: 0,
      test_images: 0,
      total_classes: 0,
      class_names: [],
      is_loaded: false,
      loading: false,
      error: null
    };
  }

  async verificarDataset() {
    if (!this.datasetYamlPath) {
      this.resetDatasetInfo();
      return;
    }

    this.ngZone.run(() => {
      this.datasetInfo.loading = true;
      this.datasetInfo.error = null;
      this.addLog('🔍 Verificando dataset...');
      this.addLog(`📍 Ruta del dataset: ${this.datasetYamlPath}`);
    });

    try {
      const result = await (window.pywebview?.api as any)?.verify_dataset(this.datasetYamlPath);

      this.ngZone.run(() => {
        this.datasetInfo.loading = false;

        if (result?.ok) {
          this.datasetInfo = {
            ...result.data,
            is_loaded: true,
            loading: false,
            error: null
          };

          this.addLog(`✅ Dataset verificado: ${result.data.train_images} train, ${result.data.val_images} val, ${result.data.test_images} test`);
          this.addLog(`📋 Clases encontradas: ${result.data.total_classes} (${result.data.class_names.join(', ')})`);
        } else {
          this.datasetInfo.error = result?.error || 'Error verificando dataset';
          this.addLog(`❌ Error verificando dataset: ${this.datasetInfo.error}`);
        }

        this.cdr.detectChanges();
      });
    } catch (error: any) {
      this.ngZone.run(() => {
        this.datasetInfo.loading = false;
        this.datasetInfo.error = error?.message || 'Error desconocido';
        this.addLog(`❌ Error verificando dataset: ${this.datasetInfo.error}`);
        this.cdr.detectChanges();
      });
    }
  }

  async iniciarEntrenamiento() {
    // Ejecutar todo dentro de la zona de Angular
    this.ngZone.run(() => {
      // Verificar que hay un dataset seleccionado
      if (!this.datasetYamlPath) {
        this.addLog('❌ Primero selecciona el dataset .yaml');
        return;
      }

      // Limpiar logs anteriores y datos de entrenamiento
      this.trainingLogs = [];
      this.metricsHistory = [];
      this.currentEpoch = 0;
      this.trainingProgress = 0;
      this.downloadProgress = 0;
      this.trainingStatus = 'idle';
      this.currentMetrics = {
        box_loss: 0,
        seg_loss: 0,
        cls_loss: 0,
        dfl_loss: 0,
        instances: 0
      };

      // Mostrar configuración inicial inmediatamente
      this.addLog('🚀 Iniciando configuración de entrenamiento...');
      this.addLog(`📋 Tarea: ${this.selectedTask === 'detect' ? 'Detección' : 'Segmentación'}`);

      // Forzar actualización de la vista
      this.cdr.detectChanges();
    });

    // Validar y ajustar modelo según la tarea
    let modelToUse = this.selectedModel;

    this.addLog(`🔍 DEBUG: Tarea seleccionada: ${this.selectedTask}`);
    this.addLog(`🔍 DEBUG: Modelo inicial: ${modelToUse}`);

    if (this.selectedTask === 'segment') {
      if (!modelToUse || !modelToUse.endsWith('-seg.pt')) {
        // Para segmentación, asegurar que usa modelo -seg
        const baseModel = modelToUse?.replace('-seg.pt', '').replace('.pt', '') || 'yolo11n';
        modelToUse = `${baseModel}-seg.pt`;
        this.selectedModel = modelToUse;
        this.addLog(`🔧 Ajustando a modelo de segmentación: ${modelToUse}`);
      }
    } else if (this.selectedTask === 'detect') {
      if (!modelToUse || modelToUse.endsWith('-seg.pt')) {
        // Para detección, usar modelo normal
        const baseModel = modelToUse?.replace('-seg.pt', '') || 'yolo11n.pt';
        modelToUse = baseModel.endsWith('.pt') ? baseModel : `${baseModel}.pt`;
        this.selectedModel = modelToUse;
        this.addLog(`🔧 Ajustando a modelo de detección: ${modelToUse}`);
      }
    }

    this.addLog(`🔍 DEBUG: Modelo final: ${modelToUse}`);

    try {
      this.ngZone.run(() => {
        this.isTraining = true;

        // Mostrar más configuración
        this.addLog(`🤖 Modelo: ${modelToUse}`);
        this.addLog(`📊 Dataset: ${this.datasetYamlPath?.split('/').pop() || this.datasetYamlPath?.split('\\').pop()}`);
        this.addLog(`⚙️ Épocas: ${this.totalEpochs}, Batch: ${this.batchSize}, Imagen: ${this.imageSize}px`);
        this.addLog('📡 Enviando solicitud al backend...');
      });

      const params = {
        model: modelToUse,
        epochs: this.totalEpochs,
        batch: this.batchSize,
        imgsz: this.imageSize,
        learningRate: this.learningRate,
        // device: 'auto', // Permitir que YOLO detecte automáticamente GPU/CPU
        // name: `${this.selectedTask}_${Date.now()}`, // Nombre único del experimento
      };

      const res = await window.pywebview?.api?.start_training(this.selectedTask, params);

      this.ngZone.run(() => {
        if (!res?.ok) {
          this.isTraining = false;
          this.addLog('❌ No se pudo iniciar el entrenamiento: ' + (res?.error || 'error desconocido'));
        } else {
          this.addLog('✅ Entrenamiento iniciado correctamente');
        }
      });
    } catch (e: any) {
      this.ngZone.run(() => {
        this.isTraining = false;
        this.addLog('❌ Error al iniciar entrenamiento: ' + (e?.message || e));
      });
    }
  }

  async detenerEntrenamiento() {
    try {
      this.addLog('🛑 Solicitando detener entrenamiento...');
      const res = await window.pywebview?.api?.stop_training();

      this.ngZone.run(() => {
        this.addLog(res?.ok ? '✅ Solicitud de detención enviada' : '❌ Error: ' + (res?.error || ''));
        this.isTraining = false;
      });
    } catch (e: any) {
      this.ngZone.run(() => {
        this.addLog('❌ Error deteniendo entrenamiento: ' + (e?.message || e));
        this.isTraining = false;
      });
    }
  }

  onTaskChange(task: 'detect' | 'segment') {
    this.selectedTask = task;

    // Limpiar selección de modelo actual
    this.currentModelData.set(undefined);

    // Ajuste automático de modelo según la tarea
    if (task === 'segment') {
      this.selectedModel = 'yolo11n-seg.pt';
      // Buscar el modelo por defecto en la lista
      const defaultModel = this.availableModels.find(m => m.value === 'yolo11n-seg.pt');
      if (defaultModel) {
        this.currentModelData.set(defaultModel);
      }
    } else if (task === 'detect') {
      this.selectedModel = 'yolo11n.pt';
      // Buscar el modelo por defecto en la lista
      const defaultModel = this.availableModels.find(m => m.value === 'yolo11n.pt');
      if (defaultModel) {
        this.currentModelData.set(defaultModel);
      }
    }
  }

  // Filtrar modelos según la tarea seleccionada
  get filteredModels(): Model[] {
    if (this.selectedTask === 'segment') {
      return this.availableModels.filter(m => m.category === 'segmentation');
    } else {
      return this.availableModels.filter(m => m.category === 'detection');
    }
  }

  // Métodos para combobox
  modelComboboxStateChanged(state: 'open' | 'closed') {
    this.modelComboboxState.set(state);
  }

  modelCommandSelected(model: Model) {
    this.modelComboboxState.set('closed');
    if (this.currentModelData()?.value === model.value) {
      this.currentModelData.set(undefined);
      this.selectedModel = '';
    } else {
      this.currentModelData.set(model);
      this.selectedModel = model.value;
    }
  }

  imageSizeComboboxStateChanged(state: 'open' | 'closed') {
    this.imageSizeComboboxState.set(state);
  }

  imageSizeCommandSelected(imageSize: ImageSize) {
    this.imageSizeComboboxState.set('closed');
    if (this.currentImageSize()?.value === imageSize.value) {
      this.currentImageSize.set(undefined);
      this.imageSize = 0;
    } else {
      this.currentImageSize.set(imageSize);
      this.imageSize = +imageSize.value;
    }
  }

  // Métodos para monitoreo de recursos del sistema
  startResourcesMonitoring() {
    // Obtener datos iniciales
    this.updateSystemResources();

    // Configurar actualización automática cada 2 segundos
    this.resourcesInterval = setInterval(() => {
      this.updateSystemResources();
    }, 2000);
  }

  stopResourcesMonitoring() {
    if (this.resourcesInterval) {
      clearInterval(this.resourcesInterval);
      this.resourcesInterval = null;
    }
  }

  async updateSystemResources() {
    // Solo intentar obtener recursos si la API está lista
    if (!this.pythonApi.apiReady()) {
      return;
    }

    try {
      const api = this.pythonApi.requireApi();
      const resources = await api.get_system_resources();

      this.systemResources = {
        ...resources,
        loading: false,
        error: null
      };

      this.cdr.detectChanges();
    } catch (error) {
      // Solo mostrar error si realmente falla, no si la API no está lista
      if (this.pythonApi.apiReady()) {
        console.error('[ENTRENAMIENTO] Error obteniendo recursos del sistema:', error);
        this.systemResources.error = 'Error al obtener recursos del sistema';
        this.systemResources.loading = false;
        this.cdr.detectChanges();
      }
    }
  }

  // Métodos auxiliares para la UI de recursos
  getResourceStatusColor(percent: number, type: 'cpu' | 'memory' | 'gpu' | 'disk' = 'cpu'): string {
    // Diferentes umbrales según el tipo de recurso
    let warningThreshold = 70;
    let dangerThreshold = 85;

    if (type === 'gpu') {
      warningThreshold = 80;
      dangerThreshold = 95;
    } else if (type === 'memory') {
      warningThreshold = 75;
      dangerThreshold = 90;
    }

    if (percent >= dangerThreshold) return 'bg-red-600';
    if (percent >= warningThreshold) return 'bg-yellow-500';
    return 'bg-blue-600';
  }

  getResourceStatusIcon(percent: number): string {
    if (percent >= 85) return 'w-4 h-4 text-red-500';
    if (percent >= 70) return 'w-4 h-4 text-yellow-500';
    return 'w-4 h-4 text-green-500';
  }

  formatBytes(bytes: number, decimals: number = 1): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}
