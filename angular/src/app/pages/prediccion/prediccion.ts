import { Component, signal, ChangeDetectorRef, NgZone } from '@angular/core';
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

interface ModelData {
  id: string;
  name: string;
  label: string;
  value: string;
  accuracy: number;
  date: string;
  size: string;
  path?: string;
  task?: string;
}

interface ExportFormat {
  label: string;
  value: string;
}

interface Prediction {
  class: string;
  confidence: number;
  bbox: string;
}

@Component({
  selector: 'app-prediccion',
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
  templateUrl: './prediccion.html',
  styleUrl: './prediccion.scss'
})
export class Prediccion {
  selectedModel = '';
  confidenceThreshold = 0.5;
  iouThreshold = 0.4;
  maxDetections = 100;
  isPredicting = false;
  predictionProgress = 0;
  currentView = 'compare'; // 'original', 'prediction', 'compare'
  exportFormat = 'json';
  selectedImage = '';
  currentModelPath = '';
  selectedImageBase64 = '';
  predictionImageBase64 = '';

  // Estados para combobox
  public currentModelData = signal<ModelData | undefined>(undefined);
  public modelComboboxState = signal<'closed' | 'open'>('closed');
  public currentExportFormat = signal<ExportFormat | undefined>(undefined);
  public exportFormatComboboxState = signal<'closed' | 'open'>('closed');

  // Estado de carga
  modelsLoading = false;
  modelsError = '';

  availableModels: ModelData[] = [];

  exportFormats: ExportFormat[] = [
    { label: 'JSON', value: 'json' },
    { label: 'CSV', value: 'csv' },
    { label: 'TXT', value: 'txt' },
    { label: 'XML', value: 'xml' },
    { label: 'YOLO Format', value: 'yolo' }
  ];

  constructor(private cdr: ChangeDetectorRef, private ngZone: NgZone) {
    // Inicializar valores por defecto
    const defaultExportFormat = this.exportFormats.find(f => f.value === this.exportFormat);
    this.currentExportFormat.set(defaultExportFormat);
    
    // Cargar modelos entrenados del proyecto
    this.loadTrainedModels();
  }

  predictions: Prediction[] = [
    { class: 'persona', confidence: 0.89, bbox: '145,230,280,450' },
    { class: 'vehiculo', confidence: 0.76, bbox: '320,180,520,350' },
    { class: 'persona', confidence: 0.82, bbox: '580,240,690,480' }
  ];

  get selectedModelData(): ModelData | undefined {
    return this.currentModelData();
  }

  get hasModelSelected(): boolean {
    return this.selectedModel !== '';
  }

  get confidencePercent(): number {
    return Math.round(this.confidenceThreshold * 100);
  }

  get iouPercent(): number {
    return Math.round(this.iouThreshold * 100);
  }

  selectImage(): void {
    this.selectImageFile();
  }

  loadExternalModel(): void {
    this.loadExternalModelFile();
  }

  startPrediction(): void {
    if (!this.hasModelSelected || !this.selectedImage) {
      console.error('Se requiere un modelo y una imagen seleccionada');
      return;
    }

    this.predictSelectedImage();
  }

  private simulatePrediction(): void {
    const interval = setInterval(() => {
      this.predictionProgress += 10;
      if (this.predictionProgress >= 100) {
        clearInterval(interval);
        this.isPredicting = false;
        this.predictionProgress = 0;
      }
    }, 200);
  }

  predictFolder(): void {
    if (!this.hasModelSelected) return;

    console.log('Predecir carpeta');
    this.isPredicting = true;
    this.predictionProgress = 45; // Simular progreso parcial
  }

  setView(view: string): void {
    this.currentView = view;
  }

  isViewActive(view: string): boolean {
    return this.currentView === view;
  }

  exportResults(): void {
    console.log('Exportar resultados en formato:', this.exportFormat);
  }

  getConfidenceBadgeClass(confidence: number): string {
    return confidence > 0.8
      ? 'bg-blue-600 text-white'
      : 'bg-gray-200 text-gray-700';
  }

  onConfidenceChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.confidenceThreshold = parseFloat(target.value);
  }

  onIouChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.iouThreshold = parseFloat(target.value);
  }

  // Métodos para combobox
  modelComboboxStateChanged(state: 'open' | 'closed') {
    this.modelComboboxState.set(state);
  }

  modelCommandSelected(model: ModelData) {
    this.ngZone.run(() => {
      this.modelComboboxState.set('closed');
      if (this.currentModelData()?.value === model.value) {
        this.currentModelData.set(undefined);
        this.selectedModel = '';
        this.currentModelPath = '';
      } else {
        this.currentModelData.set(model);
        this.selectedModel = model.value;
        this.currentModelPath = model.path || '';
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

  // Métodos de conexión con API

  async loadTrainedModels() {
    try {
      this.modelsLoading = true;
      this.modelsError = '';
      
      const response = await (window as any).pywebview.api.get_trained_models() as {
        ok?: boolean;
        models?: any[];
        error?: string;
      };
      
      if (response.ok && response.models) {
        this.availableModels = response.models.map((model: any) => ({
          id: model.id,
          name: model.name,
          label: model.label,
          value: model.value,
          accuracy: model.accuracy || 0,
          date: model.date,
          size: model.size,
          path: model.path,
          task: model.task
        }));
      } else {
        this.modelsError = response.error || 'Error desconocido al cargar modelos';
        console.error('Error cargando modelos:', this.modelsError);
      }
    } catch (error) {
      this.modelsError = 'Error de conexión con la API';
      console.error('Error cargando modelos:', error);
    } finally {
      this.ngZone.run(() => {
        this.modelsLoading = false;
        this.cdr.detectChanges();
      });
    }
  }

  async loadExternalModelFile() {
    try {
      const response = await (window as any).pywebview.api.load_external_model() as {
        ok?: boolean;
        model?: any;
        error?: string;
      };
      
      if (response.ok && response.model) {
        // Agregar modelo externo a la lista
        const externalModel: ModelData = {
          id: response.model.id,
          name: response.model.name,
          label: response.model.label,
          value: response.model.value,
          accuracy: response.model.accuracy || 0,
          date: response.model.date,
          size: response.model.size
        };
        
        // Si ya existe un modelo externo, reemplazarlo
        const existingIndex = this.availableModels.findIndex(m => m.id.startsWith('external_'));
        if (existingIndex >= 0) {
          this.availableModels[existingIndex] = externalModel;
        } else {
          this.availableModels.push(externalModel);
        }
        
        // Seleccionar automáticamente el modelo externo
        this.currentModelData.set(externalModel);
        this.selectedModel = externalModel.value;
        this.currentModelPath = response.model.path;
        
        console.log('Modelo externo cargado:', externalModel);
      } else {
        const errorMsg = response.error || 'Error desconocido al cargar modelo externo';
        console.error('Error:', errorMsg);
        // Podrías mostrar una notificación aquí
      }
    } catch (error) {
      console.error('Error cargando modelo externo:', error);
    }
  }

  async selectImageFile() {
    try {
      const response = await (window as any).pywebview.api.select_image_for_prediction() as {
        ok?: boolean;
        image_path?: string;
        image_base64?: string;
        error?: string;
      };
      
      if (response.ok && response.image_path) {
        this.ngZone.run(() => {
          this.selectedImage = response.image_path!;
          this.selectedImageBase64 = response.image_base64 || '';
          console.log('Imagen seleccionada:', this.selectedImage);
          this.cdr.detectChanges();
        });
      } else {
        console.error('Error:', response.error);
      }
    } catch (error) {
      console.error('Error seleccionando imagen:', error);
    }
  }

  async predictSelectedImage() {
    if (!this.hasModelSelected || !this.selectedImage) {
      console.error('Se requiere un modelo y una imagen seleccionada');
      return;
    }

    try {
      // Inicializar estado de predicción
      this.ngZone.run(() => {
        this.isPredicting = true;
        this.predictionProgress = 0;
        this.cdr.detectChanges();
      });

      // Simular progreso mientras se ejecuta la predicción
      const progressInterval = setInterval(() => {
        this.ngZone.run(() => {
          if (this.predictionProgress < 90) {
            this.predictionProgress += 15;
            this.cdr.detectChanges();
          }
        });
      }, 200);

      const selectedModel = this.availableModels.find(m => m.value === this.selectedModel);
      const modelPath = selectedModel?.path || this.currentModelPath;

      console.log('Iniciando predicción con:', { modelPath, image: this.selectedImage });

      const response = await (window as any).pywebview.api.predict_image(
        modelPath,
        this.selectedImage,
        this.confidenceThreshold,
        this.iouThreshold,
        this.maxDetections
      ) as {
        ok?: boolean;
        predictions?: any[];
        error?: string;
        total_detections?: number;
      };

      // Limpiar intervalo y completar progreso
      clearInterval(progressInterval);
      
      this.ngZone.run(() => {
        this.predictionProgress = 100;
        this.cdr.detectChanges();
      });

      if (response.ok && response.predictions) {
        // Actualizar las predicciones con los resultados reales
        this.ngZone.run(() => {
          this.predictions = response.predictions!.map((pred: any) => ({
            class: pred.class,
            confidence: pred.confidence,
            bbox: pred.bbox_string
          }));
          this.predictionImageBase64 = (response as any).prediction_image_base64 || '';
          this.cdr.detectChanges();
        });
        
        console.log(`Predicción completada: ${response.total_detections} detecciones`);
      } else {
        console.error('Error en predicción:', response.error);
        this.ngZone.run(() => {
          this.predictions = [];
          this.cdr.detectChanges();
        });
      }
    } catch (error) {
      console.error('Error realizando predicción:', error);
      this.ngZone.run(() => {
        this.predictions = [];
        this.cdr.detectChanges();
      });
    } finally {
      // Finalizar estado de predicción
      this.ngZone.run(() => {
        this.isPredicting = false;
        this.cdr.detectChanges();
        
        // Resetear progreso después de mostrar resultado
        setTimeout(() => {
          this.predictionProgress = 0;
          this.cdr.detectChanges();
        }, 2000);
      });
    }
  }
}
