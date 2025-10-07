import { Component, signal, ChangeDetectorRef, NgZone, OnInit, effect } from '@angular/core';
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
export class Prediccion implements OnInit {
  selectedModel = '';
  confidenceThreshold = 0.5;
  iouThreshold = 0.4;
  maxDetections = 100;
  isPredicting = false;
  predictionProgress = 0;
  currentView = 'compare'; // 'original', 'prediction', 'compare'
  exportFormat = 'json';
  selectedImages: any[] = []; // Array de imágenes seleccionadas
  currentImageIndex = 0; // Índice de la imagen actual
  currentModelPath = '';

  // Propiedades para la imagen actual
  get selectedImage(): string {
    return this.selectedImages.length > 0 ? this.selectedImages[this.currentImageIndex]?.image_path || '' : '';
  }

  get selectedImageBase64(): string {
    return this.selectedImages.length > 0 ? this.selectedImages[this.currentImageIndex]?.image_base64 || '' : '';
  }

  get originalImageBase64(): string {
    return this.predictionResults.length > 0 ? this.predictionResults[this.currentImageIndex]?.original_image_base64 || '' : '';
  }

  get predictionImageBase64(): string {
    return this.predictionResults.length > 0 ? this.predictionResults[this.currentImageIndex]?.prediction_image_base64 || '' : '';
  }

  // Array de resultados de predicción para todas las imágenes
  predictionResults: any[] = [];

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

  constructor(
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone,
    public projectService: ProjectService
  ) {
    // Inicializar valores por defecto
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
        this.availableModels = [];
        this.currentModelData.set(undefined);
        this.selectedModel = '';
        this.currentModelPath = '';
      }
    });
  }

  ngOnInit(): void {
    // Cargar modelos al inicializar si hay un proyecto abierto
    if (this.projectService.isOpen()) {
      this.loadTrainedModels();
    }
  }

  predictions: Prediction[] = [];

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

  selectImages(): void {
    this.selectImagesFile();
  }

  selectFolder(): void {
    this.selectFolderImages();
  }

  loadExternalModel(): void {
    // Forzar detección de cambios inmediata para el estado del botón
    this.ngZone.run(() => {
      // Aquí podrías agregar un estado de "cargando" si necesitas feedback visual
      this.loadExternalModelFile();
      this.cdr.detectChanges();
    });
  }

  startPrediction(): void {
    if (!this.hasModelSelected || this.selectedImages.length === 0) {
      console.error('Se requiere un modelo y al menos una imagen seleccionada');
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
    this.ngZone.run(() => {
      this.currentView = view;
      this.cdr.detectChanges();
    });
  }

  isViewActive(view: string): boolean {
    return this.currentView === view;
  }

  // Métodos para navegación de múltiples imágenes
  updateCurrentPredictions(): void {
    if (this.predictionResults.length > 0 && this.currentImageIndex < this.predictionResults.length) {
      const currentResult = this.predictionResults[this.currentImageIndex];
      this.predictions = currentResult.predictions?.map((pred: any) => ({
        class: pred.class,
        confidence: pred.confidence,
        bbox: pred.bbox_string
      })) || [];
    } else {
      this.predictions = [];
    }
  }

  goToNextImage(): void {
    if (this.currentImageIndex < this.selectedImages.length - 1) {
      this.ngZone.run(() => {
        this.currentImageIndex++;
        this.updateCurrentPredictions();
        this.cdr.detectChanges();
      });
    }
  }

  goToPreviousImage(): void {
    if (this.currentImageIndex > 0) {
      this.ngZone.run(() => {
        this.currentImageIndex--;
        this.updateCurrentPredictions();
        this.cdr.detectChanges();
      });
    }
  }

  goToImage(index: number): void {
    if (index >= 0 && index < this.selectedImages.length) {
      this.ngZone.run(() => {
        this.currentImageIndex = index;
        this.updateCurrentPredictions();
        this.cdr.detectChanges();
      });
    }
  }

  removeImage(index: number): void {
    if (index >= 0 && index < this.selectedImages.length) {
      this.ngZone.run(() => {
        this.selectedImages.splice(index, 1);
        if (this.predictionResults.length > index) {
          this.predictionResults.splice(index, 1);
        }

        // Ajustar índice actual si es necesario
        if (this.currentImageIndex >= this.selectedImages.length) {
          this.currentImageIndex = Math.max(0, this.selectedImages.length - 1);
        }

        this.updateCurrentPredictions();
        this.cdr.detectChanges();
      });
    }
  }

  clearAllImages(): void {
    this.ngZone.run(() => {
      this.selectedImages = [];
      this.predictionResults = [];
      this.predictions = [];
      this.currentImageIndex = 0;
      this.cdr.detectChanges();
    });
  }

  // Propiedades auxiliares
  get hasMultipleImages(): boolean {
    return this.selectedImages.length > 1;
  }

  get canGoNext(): boolean {
    return this.currentImageIndex < this.selectedImages.length - 1;
  }

  get canGoPrevious(): boolean {
    return this.currentImageIndex > 0;
  }

  get currentImageName(): string {
    return this.selectedImages.length > 0 ? this.selectedImages[this.currentImageIndex]?.name || '' : '';
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
        message?: string;
        error?: string;
      };

      this.ngZone.run(() => {
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

          // Auto-seleccionar el modelo más reciente (primero en la lista)
          if (this.availableModels.length > 0 && !this.currentModelData()) {
            const latestModel = this.availableModels[0];
            this.currentModelData.set(latestModel);
            this.selectedModel = latestModel.value;
            this.currentModelPath = latestModel.path || '';
            console.log('Modelo auto-seleccionado:', latestModel.label);
          }
        } else if (response.message) {
          // No hay modelos aún, pero no es un error
          this.availableModels = [];
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

  async loadExternalModelFile() {
    try {
      const response = await (window as any).pywebview.api.load_external_model() as {
        ok?: boolean;
        model?: any;
        error?: string;
      };

      // Forzar detección de cambios en zona de Angular
      this.ngZone.run(() => {
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

        // Forzar detección de cambios
        this.cdr.detectChanges();
      });
    } catch (error) {
      console.error('Error cargando modelo externo:', error);
    }
  }

  // Método auxiliar para manejar nombres duplicados
  private generateUniqueImageName(name: string, existingImages: any[]): string {
    const existingNames = existingImages.map(img => img.name);

    if (!existingNames.includes(name)) {
      return name;
    }

    // Obtener nombre base y extensión
    const lastDotIndex = name.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? name.substring(0, lastDotIndex) : name;
    const extension = lastDotIndex > 0 ? name.substring(lastDotIndex) : '';

    // Buscar un número disponible
    let counter = 2;
    let uniqueName = `${baseName} (${counter})${extension}`;

    while (existingNames.includes(uniqueName)) {
      counter++;
      uniqueName = `${baseName} (${counter})${extension}`;
    }

    return uniqueName;
  }

  // Método auxiliar para agregar imágenes evitando duplicados
  private addImagesToSelection(newImages: any[]): void {
    const existingPaths = this.selectedImages.map(img => img.image_path);

    newImages.forEach(image => {
      // Verificar si la imagen ya existe por ruta
      if (!existingPaths.includes(image.image_path)) {
        // Generar nombre único si hay conflicto
        const uniqueName = this.generateUniqueImageName(image.name, this.selectedImages);

        this.selectedImages.push({
          ...image,
          name: uniqueName
        });
      }
    });
  }

  async selectImagesFile() {
    try {
      const response = await (window as any).pywebview.api.select_image_for_prediction(true) as {
        ok?: boolean;
        image_path?: string;
        image_base64?: string;
        images?: any[];
        total_count?: number;
        error?: string;
      };

      if (response.ok) {
        this.ngZone.run(() => {
          if (response.images && response.images.length > 0) {
            // Agregar imágenes seleccionadas a la lista actual
            this.addImagesToSelection(response.images);
            console.log(`${response.images.length} imágenes agregadas. Total: ${this.selectedImages.length}`);
          } else if (response.image_path) {
            // Selección individual (fallback)
            const newImage = {
              image_path: response.image_path,
              image_base64: response.image_base64 || '',
              name: response.image_path.split('\\').pop() || response.image_path.split('/').pop() || 'imagen'
            };
            this.addImagesToSelection([newImage]);
            console.log('Imagen agregada:', response.image_path);
          }

          // Solo limpiar resultados si es la primera vez
          if (this.predictionResults.length === 0) {
            this.predictions = [];
          }

          this.cdr.detectChanges();
        });
      } else {
        console.error('Error:', response.error);
      }
    } catch (error) {
      console.error('Error seleccionando imágenes:', error);
    }
  }

  async selectFolderImages() {
    try {
      const response = await (window as any).pywebview.api.select_folder_images() as {
        ok?: boolean;
        images?: any[];
        total_count?: number;
        folder_path?: string;
        error?: string;
      };

      if (response.ok && response.images) {
        this.ngZone.run(() => {
          // Agregar todas las imágenes de la carpeta
          if (response.images && response.images.length > 0) {
            this.addImagesToSelection(response.images);
            console.log(`${response.images.length} imágenes agregadas de la carpeta. Total: ${this.selectedImages.length}`);
          }

          // Solo limpiar resultados si es la primera vez
          if (this.predictionResults.length === 0) {
            this.predictions = [];
          }

          this.cdr.detectChanges();
        });
      } else {
        console.error('Error:', response.error);
      }
    } catch (error) {
      console.error('Error seleccionando carpeta:', error);
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
      const imagePaths = this.selectedImages.map(img => img.image_path);

      console.log('Iniciando predicción con:', { modelPath, images: imagePaths });

      const response = await (window as any).pywebview.api.predict_multiple_images(
        modelPath,
        imagePaths,
        this.confidenceThreshold,
        this.iouThreshold,
        this.maxDetections
      ) as {
        ok?: boolean;
        results?: any[];
        error?: string;
        total_images?: number;
      };

      // Limpiar intervalo y completar progreso
      clearInterval(progressInterval);

      this.ngZone.run(() => {
        this.predictionProgress = 100;
        this.cdr.detectChanges();
      });

      if (response.ok && response.results) {
        // Actualizar los resultados de predicción
        this.ngZone.run(() => {
          this.predictionResults = response.results!;
          // Mostrar predicciones de la imagen actual
          this.updateCurrentPredictions();
          this.cdr.detectChanges();
        });

        console.log(`Predicción completada: ${response.total_images} imágenes procesadas`);
      } else {
        console.error('Error en predicción:', response.error);
        this.ngZone.run(() => {
          this.predictionResults = [];
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
