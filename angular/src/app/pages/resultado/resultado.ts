import { Component, signal, ChangeDetectorRef, NgZone, OnInit, effect, ViewChild, ElementRef } from '@angular/core';
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
import { ProjectService } from '../../services/project.service';
import { Chart, ChartConfiguration, ChartData, registerables } from 'chart.js';

// Registrar componentes de Chart.js
Chart.register(...registerables);

interface TrainingSession {
  id: string;
  name: string;
  label: string;
  value: string;
  model: string;
  date: string;
  epochs: number;
  mAP: number;
  precision: number;
  recall: number;
  path?: string;
  task?: string;
  size?: string;
}

interface ExportFormat {
  label: string;
  value: string;
}

interface MetricItem {
  key: string;
  label: string;
  visible: boolean;
  color: string;
}

@Component({
  selector: 'app-resultado',
  imports: [
    CommonModule,
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
  templateUrl: './resultado.html',
  styleUrl: './resultado.scss'
})
export class Resultado implements OnInit {
  selectedTraining = '';
  activeTab = 'curves';
  exportFormat = 'pytorch';

  // Estados para combobox
  public currentTrainingSession = signal<TrainingSession | undefined>(undefined);
  public trainingComboboxState = signal<'closed' | 'open'>('closed');
  public currentExportFormat = signal<ExportFormat | undefined>(undefined);
  public exportFormatComboboxState = signal<'closed' | 'open'>('closed');

  // Estado de carga de modelos
  modelsLoading = false;
  modelsError = '';

  // Gráfico de entrenamiento
  @ViewChild('trainingChart', { static: false }) trainingChartRef?: ElementRef<HTMLCanvasElement>;
  trainingChart?: Chart;
  chartData: ChartData<'line'> = { labels: [], datasets: [] };
  availableMetrics: MetricItem[] = [];
  chartLoading = false;
  chartError = '';
  // Almacenar datos históricos para evitar recargas
  private historyData: { epochs: number[]; metrics: { [key: string]: number[] } } | null = null;

  // Matrices de confusión
  confusionMatrixNormal = '';
  confusionMatrixNormalized = '';
  confusionMatrixLoading = false;
  confusionMatrixError = '';
  showNormalizedMatrix = false; // Toggle entre normal y normalizada

  trainingSessions: TrainingSession[] = [];

  exportFormats: ExportFormat[] = [
    { label: 'PyTorch (.pt)', value: 'pytorch' },
    { label: 'ONNX (.onnx)', value: 'onnx' },
    { label: 'TensorFlow (.pb)', value: 'tensorflow' },
    { label: 'TensorRT (.trt)', value: 'tensorrt' },
    { label: 'CoreML (.mlmodel)', value: 'coreml' }
  ];

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public projectService: ProjectService
  ) {
    // Inicializar valor por defecto de formato de exportación
    const defaultExportFormat = this.exportFormats.find(f => f.value === this.exportFormat);
    this.currentExportFormat.set(defaultExportFormat);

    // Effect para cargar modelos cuando se abre un proyecto
    effect(() => {
      const project = this.projectService.project();
      if (project && project.root) {
        // Proyecto abierto, cargar modelos automáticamente
        this.loadTrainedModels();
      } else {
        // Proyecto cerrado, limpiar modelos
        this.trainingSessions = [];
        this.currentTrainingSession.set(undefined);
        this.selectedTraining = '';
      }
    });
  }

  ngOnInit(): void {
    // Cargar modelos al inicializar si hay un proyecto abierto
    if (this.projectService.isOpen()) {
      this.loadTrainedModels();
    }
  }

  get currentTraining(): TrainingSession | undefined {
    return this.currentTrainingSession();
  }

  get f1Score(): number {
    if (!this.currentTraining) return 0;
    // F1-Score es la media armónica de precisión y recall
    const precision = this.currentTraining.precision;
    const recall = this.currentTraining.recall;

    // Evitar división por cero
    if (precision + recall === 0) return 0;

    return (2 * precision * recall) / (precision + recall);
  }

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }

  isTabActive(tab: string): boolean {
    return this.activeTab === tab;
  }

  getTabClasses(tab: string): string {
    const baseClasses = 'px-4 py-2 text-sm font-medium rounded-md transition-colors';
    const activeClasses = 'bg-blue-600 text-white';
    const inactiveClasses = 'text-gray-600 hover:text-gray-900 hover:bg-gray-100';

    return `${baseClasses} ${this.isTabActive(tab) ? activeClasses : inactiveClasses}`;
  }

  compareTrainings(): void {
    console.log('Comparar entrenamientos');
  }

  exportModel(): void {
    console.log('Exportar modelo en formato:', this.exportFormat);
  }

  generateReport(): void {
    console.log('Generar reporte');
  }

  // Métodos para combobox
  trainingComboboxStateChanged(state: 'open' | 'closed') {
    this.trainingComboboxState.set(state);
  }

  trainingCommandSelected(training: TrainingSession) {
    this.ngZone.run(() => {
      this.trainingComboboxState.set('closed');
      if (this.currentTrainingSession()?.value === training.value) {
        this.currentTrainingSession.set(undefined);
        this.selectedTraining = '';
        // Limpiar gráfico y datos
        this.destroyChart();
        this.availableMetrics = [];
        this.historyData = null;
        // Limpiar matrices de confusión
        this.confusionMatrixNormal = '';
        this.confusionMatrixNormalized = '';
        this.confusionMatrixError = '';
      } else {
        this.currentTrainingSession.set(training);
        this.selectedTraining = training.value;
        // Cargar datos del gráfico y matrices
        if (training.path) {
          this.loadTrainingHistory(training.path);
          this.loadConfusionMatrices(training.path);
        }
      }
      this.cdr.detectChanges();
    });
  }

  exportFormatComboboxStateChanged(state: 'open' | 'closed') {
    this.exportFormatComboboxState.set(state);
  }

  exportFormatCommandSelected(format: ExportFormat) {
    this.exportFormatComboboxState.set('closed');
    if (this.currentExportFormat()?.value === format.value) {
      this.currentExportFormat.set(undefined);
      this.exportFormat = '';
    } else {
      this.currentExportFormat.set(format);
      this.exportFormat = format.value;
    }
  }

  // Método para cargar modelos entrenados desde el backend
  async loadTrainedModels() {
    try {
      this.modelsLoading = true;
      this.modelsError = '';

      const response = await (window as any).pywebview.api.get_trained_models() as {
        ok?: boolean;
        models?: any[];
        message?: string;
        error?: string;
      };

      this.ngZone.run(() => {
        if (response.ok && response.models) {
          this.trainingSessions = response.models.map((model: any) => ({
            id: model.id,
            name: model.name,
            label: model.label,
            value: model.value,
            model: model.task === 'segment' ? 'Segmentación' : 'Detección',
            date: model.date,
            epochs: model.epochs || 0,
            mAP: model.mAP || 0,
            precision: model.precision || 0,
            recall: model.recall || 0,
            path: model.path,
            task: model.task,
            size: model.size
          }));

          // Auto-seleccionar el modelo más reciente (primero en la lista)
          if (this.trainingSessions.length > 0 && !this.currentTrainingSession()) {
            const latestModel = this.trainingSessions[0];
            this.currentTrainingSession.set(latestModel);
            this.selectedTraining = latestModel.value;
            console.log('Modelo auto-seleccionado:', latestModel.label);
            console.log('Métricas:', {
              mAP: latestModel.mAP,
              precision: latestModel.precision,
              recall: latestModel.recall,
              epochs: latestModel.epochs
            });

            // Cargar historial de entrenamiento para el gráfico
            if (latestModel.path) {
              this.loadTrainingHistory(latestModel.path);
              this.loadConfusionMatrices(latestModel.path);
            }
          }
        } else if (response.message) {
          // No hay modelos aún, pero no es un error
          this.trainingSessions = [];
          console.log(response.message);
        } else {
          this.modelsError = response.error || 'Error desconocido al cargar modelos';
          console.error('Error cargando modelos:', this.modelsError);
        }

        this.modelsLoading = false;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.modelsError = 'Error de conexión con la API';
        this.modelsLoading = false;
        console.error('Error cargando modelos:', error);
        this.cdr.detectChanges();
      });
    }
  }

  // Métodos para el gráfico de entrenamiento
  async loadTrainingHistory(modelPath: string) {
    try {
      this.chartLoading = true;
      this.chartError = '';

      const response = await (window as any).pywebview.api.get_training_history(modelPath) as {
        ok?: boolean;
        epochs?: number[];
        metrics?: { [key: string]: number[] };
        columns?: string[];
        error?: string;
      };

      this.ngZone.run(() => {
        if (response.ok && response.epochs && response.metrics && response.columns) {
          // Almacenar datos para reutilizar
          this.historyData = {
            epochs: response.epochs,
            metrics: response.metrics
          };

          // Generar colores para las métricas
          const colors = this.generateColors(response.columns.length);

          // Crear items de métricas con labels legibles
          this.availableMetrics = response.columns.map((col, index) => ({
            key: col,
            label: this.formatMetricLabel(col),
            visible: this.isDefaultMetric(col), // Solo algunas métricas visibles por defecto
            color: colors[index]
          }));

          // Crear el gráfico
          this.createChart(response.epochs, response.metrics);
        } else {
          this.chartError = response.error || 'Error al cargar historial de entrenamiento';
          console.error('Error:', this.chartError);
        }

        this.chartLoading = false;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.ngZone.run(() => {
        this.chartError = 'Error de conexión con la API';
        this.chartLoading = false;
        console.error('Error cargando historial:', error);
        this.cdr.detectChanges();
      });
    }
  }

  createChart(epochs: number[], metrics: { [key: string]: number[] }) {
    // Destruir gráfico anterior si existe
    this.destroyChart();

    // Esperar a que el canvas esté disponible
    setTimeout(() => {
      if (!this.trainingChartRef) {
        console.error('Canvas no disponible');
        return;
      }

      const ctx = this.trainingChartRef.nativeElement.getContext('2d');
      if (!ctx) return;

      // Crear datasets solo para métricas visibles
      const datasets = this.availableMetrics
        .filter(m => m.visible)
        .map(metric => ({
          label: metric.label,
          data: metrics[metric.key],
          borderColor: metric.color,
          backgroundColor: metric.color + '20', // Transparencia del 20%
          borderWidth: 2,
          tension: 0.3, // Líneas suaves
          pointRadius: 3,
          pointHoverRadius: 5
        }));

      this.trainingChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: epochs.map(e => `Época ${e}`),
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              display: false // Usaremos nuestra propia leyenda con toggles
            },
            title: {
              display: true,
              text: 'Evolución de Métricas por Época',
              font: {
                size: 16,
                weight: 'bold'
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) {
                    label += ': ';
                  }
                  if (context.parsed.y !== null) {
                    label += context.parsed.y.toFixed(4);
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            x: {
              title: {
                display: true,
                text: 'Épocas'
              }
            },
            y: {
              title: {
                display: true,
                text: 'Valor'
              },
              beginAtZero: true
            }
          }
        }
      });

      this.cdr.detectChanges();
    }, 100);
  }

  destroyChart() {
    if (this.trainingChart) {
      this.trainingChart.destroy();
      this.trainingChart = undefined;
    }
  }

  toggleMetric(metric: MetricItem) {
    this.ngZone.run(() => {
      metric.visible = !metric.visible;

      // Actualizar gráfico sin recargar datos
      if (this.historyData) {
        this.createChart(this.historyData.epochs, this.historyData.metrics);
      }

      this.cdr.detectChanges();
    });
  }

  formatMetricLabel(key: string): string {
    // Convertir nombres técnicos a etiquetas legibles
    const labels: { [key: string]: string } = {
      'train/box_loss': 'Box Loss (Train)',
      'train/seg_loss': 'Seg Loss (Train)',
      'train/cls_loss': 'Class Loss (Train)',
      'train/dfl_loss': 'DFL Loss (Train)',
      'metrics/precision(B)': 'Precisión (Box)',
      'metrics/recall(B)': 'Recall (Box)',
      'metrics/mAP50(B)': 'mAP@0.5 (Box)',
      'metrics/mAP50-95(B)': 'mAP@0.5:0.95 (Box)',
      'metrics/precision(M)': 'Precisión (Mask)',
      'metrics/recall(M)': 'Recall (Mask)',
      'metrics/mAP50(M)': 'mAP@0.5 (Mask)',
      'metrics/mAP50-95(M)': 'mAP@0.5:0.95 (Mask)',
      'val/box_loss': 'Box Loss (Val)',
      'val/seg_loss': 'Seg Loss (Val)',
      'val/cls_loss': 'Class Loss (Val)',
      'val/dfl_loss': 'DFL Loss (Val)'
    };

    return labels[key] || key;
  }

  loadConfusionMatrices(modelPath: string): void {
    this.confusionMatrixLoading = true;
    this.confusionMatrixError = '';
    this.confusionMatrixNormal = '';
    this.confusionMatrixNormalized = '';

    (window as any).pywebview.api.get_confusion_matrices(modelPath)
      .then((response: any) => {
        this.ngZone.run(() => {
          if (response.ok && response.matrices) {
            this.confusionMatrixNormal = response.matrices.confusion_matrix || '';
            this.confusionMatrixNormalized = response.matrices.confusion_matrix_normalized || '';

            if (!this.confusionMatrixNormal && !this.confusionMatrixNormalized) {
              this.confusionMatrixError = 'No se encontraron matrices de confusión para este modelo';
            }
          } else {
            this.confusionMatrixError = response.error || 'Error al cargar matrices de confusión';
          }
          this.confusionMatrixLoading = false;
          this.cdr.detectChanges();
        });
      })
      .catch((error: any) => {
        this.ngZone.run(() => {
          this.confusionMatrixError = 'Error al cargar matrices de confusión: ' + error;
          this.confusionMatrixLoading = false;
          this.cdr.detectChanges();
        });
      });
  }

  isDefaultMetric(key: string): boolean {
    // Métricas que se muestran por defecto
    const defaultMetrics = [
      'metrics/mAP50(B)',
      'metrics/mAP50(M)',
      'metrics/precision(B)',
      'metrics/precision(M)',
      'metrics/recall(B)',
      'metrics/recall(M)'
    ];

    return defaultMetrics.includes(key);
  }

  generateColors(count: number): string[] {
    // Paleta de colores predefinida
    const palette = [
      '#3b82f6', // blue
      '#10b981', // green
      '#f59e0b', // amber
      '#ef4444', // red
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#14b8a6', // teal
      '#f97316', // orange
      '#06b6d4', // cyan
      '#84cc16', // lime
      '#6366f1', // indigo
      '#f43f5e'  // rose
    ];

    // Si necesitamos más colores, generarlos dinámicamente
    const colors: string[] = [];
    for (let i = 0; i < count; i++) {
      if (i < palette.length) {
        colors.push(palette[i]);
      } else {
        // Generar color HSL
        const hue = (i * 137.5) % 360; // Ángulo dorado para distribución uniforme
        colors.push(`hsl(${hue}, 70%, 50%)`);
      }
    }

    return colors;
  }
}
