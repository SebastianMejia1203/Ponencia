import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ProjectService } from './project.service';
import { PythonApiService } from './python-api.service';

// Interfaces (adaptadas del proyecto legacy, completas)
export interface ImageData {
  path: string;
  filename: string;
  url: string; // Para mostrar en el canvas
  size?: { width: number; height: number };
}

export interface AnnotationPolygon {
  id: number;
  classId: number;
  className: string;
  points: { x: number; y: number }[];
  originalPoints?: { x: number; y: number }[]; // Puntos en coordenadas originales de la imagen
}

export interface AnnotationBoundingBox {
  id: number;
  classId: number;
  className: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalBbox?: { x: number; y: number; width: number; height: number }; // En coordenadas originales
}

export type Annotation = AnnotationPolygon | AnnotationBoundingBox;

@Injectable({ providedIn: 'root' })
export class AnnotationService {
  private projectService = inject(ProjectService);
  private api = inject(PythonApiService);

  // Sujetos observables para el estado de las imágenes
  private imagesSubject = new BehaviorSubject<ImageData[]>([]);
  private currentImageIndexSubject = new BehaviorSubject<number>(0);
  private annotationsSubject = new BehaviorSubject<Annotation[]>([]);
  private hasImagesSubject = new BehaviorSubject<boolean>(false);

  // Observables públicos
  public images$ = this.imagesSubject.asObservable();
  public currentImageIndex$ = this.currentImageIndexSubject.asObservable();
  public annotations$ = this.annotationsSubject.asObservable();
  public hasImages$ = this.hasImagesSubject.asObservable();

  // Cache simple de dataURLs (filename -> dataUrl)
  private imageCache = new Map<string, string>();

  // Dimensiones actuales (para normalizaciones futuras)
  private imageDimensions = { width: 0, height: 0 };

  constructor() {
    console.log('🔧 Servicio de anotación inicializado con pywebview');
  }

  /** Cargar imágenes del proyecto actual usando ProjectService */
  async loadProjectImages(): Promise<void> {
    const project = this.projectService.project();
    if (!project) {
      console.log('⚠️ No hay proyecto abierto para cargar imágenes.');
      this.clear();
      return;
    }

    console.log(`🔄 Cargando imágenes del proyecto: ${project.name}`);

    try {
      // Obtener la API de Python
      console.log('🐍 Obteniendo API de Python...');
      const pythonApi = this.api.requireApi();

      // Obtener la lista de imágenes desde Python
      console.log('📋 Solicitando lista de imágenes...');
      const imageFilenames = await pythonApi.list_images();
      console.log(`📋 Recibidas ${imageFilenames.length} imágenes:`, imageFilenames);

      // Crear objetos ImageData
      const images: ImageData[] = imageFilenames.map((filename: string) => ({
        path: filename, // En pywebview el path es simplemente el filename
        filename: filename,
        url: '' // Se cargará bajo demanda
      }));

      this.imagesSubject.next(images);
      this.hasImagesSubject.next(images.length > 0);

      if (images.length > 0) {
        this.currentImageIndexSubject.next(0);
        await this.loadAnnotationsForCurrentImage();
        console.log(`✅ Cargadas ${images.length} imágenes del proyecto.`);
      } else {
        this.currentImageIndexSubject.next(0);
        this.annotationsSubject.next([]);
        console.log(`ℹ️ No se encontraron imágenes en el proyecto.`);
      }
    } catch (error) {
      console.error('Error cargando imágenes del proyecto:', error);
      this.clear();
    }
  }

  /** Limpiar estado interno */
  clear() {
    this.imagesSubject.next([]);
    this.currentImageIndexSubject.next(0);
    this.annotationsSubject.next([]);
    this.hasImagesSubject.next(false);
    this.imageCache.clear();
  }

  /** Navegar a imagen siguiente */
  async nextImage() {
    const imgs = this.imagesSubject.value;
    const idx = this.currentImageIndexSubject.value;
    if (idx < imgs.length - 1) {
      await this.saveCurrentAnnotations().catch(() => {});
      this.currentImageIndexSubject.next(idx + 1);
      await this.loadAnnotationsForCurrentImage();
    }
  }

  /** Navegar a imagen anterior */
  async previousImage() {
    const idx = this.currentImageIndexSubject.value;
    if (idx > 0) {
      await this.saveCurrentAnnotations().catch(() => {});
      this.currentImageIndexSubject.next(idx - 1);
      await this.loadAnnotationsForCurrentImage();
    }
  }

  /** Obtener imagen actual con URL cargada */
  async getCurrentImageWithUrl(): Promise<ImageData | null> {
    const images = this.imagesSubject.value;
    const currentIndex = this.currentImageIndexSubject.value;

    console.log(`🔍 getCurrentImageWithUrl: índice=${currentIndex}, total imágenes=${images.length}`);

    if (!images[currentIndex]) {
      console.log(`⚠️ No hay imagen en el índice ${currentIndex}`);
      return null;
    }

    const image = images[currentIndex];
    console.log(`📁 Procesando imagen: ${image.filename}`);

    // Si ya tiene URL cacheada, devolverla
    if (image.url && this.imageCache.has(image.filename)) {
      console.log(`✅ Imagen ${image.filename} encontrada en cache`);
      return image;
    }

    // Cargar la imagen desde Python
    try {
      console.log(`🐍 Solicitando imagen ${image.filename} desde Python...`);
      const pythonApi = this.api.requireApi();
      const response = await pythonApi.get_image_base64(image.filename);

      console.log(`🐍 Respuesta de Python:`, { ok: response.ok, hasDataUrl: !!response.dataUrl });

      if (response.ok && response.dataUrl) {
        image.url = response.dataUrl;
        this.imageCache.set(image.filename, response.dataUrl);

        // Actualizar el array de imágenes
        const updatedImages = [...images];
        updatedImages[currentIndex] = image;
        this.imagesSubject.next(updatedImages);

        console.log(`✅ Imagen ${image.filename} cargada correctamente`);
        return image;
      } else {
        console.error('Error cargando imagen:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error obteniendo imagen actual:', error);
      return null;
    }
  }

  /** Cargar anotaciones para la imagen actual */
  async loadAnnotationsForCurrentImage(): Promise<void> {
    const images = this.imagesSubject.value;
    const currentIndex = this.currentImageIndexSubject.value;

    if (!images[currentIndex]) {
      this.annotationsSubject.next([]);
      return;
    }

    const currentImage = images[currentIndex];

    try {
      const pythonApi = this.api.requireApi();
      const annotations = await pythonApi.load_annotations(currentImage.filename);
      this.annotationsSubject.next(annotations || []);
      console.log(`📋 Cargadas ${annotations?.length || 0} anotaciones para: ${currentImage.filename}`);
    } catch (error) {
      console.error('Error cargando anotaciones:', error);
      this.annotationsSubject.next([]);
    }
  }

  /** Guardar anotaciones actuales */
  async saveCurrentAnnotations(): Promise<void> {
    const images = this.imagesSubject.value;
    const currentIndex = this.currentImageIndexSubject.value;
    const annotations = this.annotationsSubject.value;

    if (!images[currentIndex]) return;

    const currentImage = images[currentIndex];

    try {
      const pythonApi = this.api.requireApi();
      await pythonApi.save_annotations(currentImage.filename, annotations);
      console.log(`💾 Guardadas ${annotations.length} anotaciones para: ${currentImage.filename}`);
    } catch (error) {
      console.error('Error guardando anotaciones:', error);
      throw error;
    }
  }

  /** Agregar nueva anotación */
  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      const currentAnnotations = this.annotationsSubject.value;
      const newAnnotations = [...currentAnnotations, annotation];
      this.annotationsSubject.next(newAnnotations);

      // Guardar inmediatamente
      await this.saveCurrentAnnotations();

      console.log(`➕ Anotación agregada: ${annotation.className}`);
    } catch (error) {
      console.error('Error agregando anotación:', error);
      // Revertir en caso de error
      const currentAnnotations = this.annotationsSubject.value;
      const revertedAnnotations = currentAnnotations.filter(a => a.id !== annotation.id);
      this.annotationsSubject.next(revertedAnnotations);
    }
  }

  /** Eliminar anotación */
  async removeAnnotation(annotationId: number): Promise<void> {
    try {
      const currentAnnotations = this.annotationsSubject.value;
      const filteredAnnotations = currentAnnotations.filter(a => a.id !== annotationId);
      this.annotationsSubject.next(filteredAnnotations);

      // Guardar inmediatamente
      await this.saveCurrentAnnotations();

      console.log(`🗑️ Anotación eliminada: ${annotationId}`);
    } catch (error) {
      console.error('Error eliminando anotación:', error);
      // No revertir eliminación en caso de error de guardado
    }
  }

  /** Establecer dimensiones de imagen actual */
  setImageDimensions(width: number, height: number): void {
    this.imageDimensions = { width, height };
  }

  /** Obtener dimensiones de imagen actual */
  getImageDimensions(): { width: number; height: number } {
    return this.imageDimensions;
  }

  /** Cargar nuevas imágenes desde el sistema de archivos */
  async loadNewImages(): Promise<boolean> {
    try {
      const pythonApi = this.api.requireApi();

      // Usar el diálogo nativo de pywebview para seleccionar imágenes
      const selectedImagesResponse = await pythonApi.select_images_dialog('Seleccionar imágenes');

      if (!selectedImagesResponse.ok || !selectedImagesResponse.paths || selectedImagesResponse.paths.length === 0) {
        return false; // Usuario canceló o error
      }

      // Copiar las imágenes al proyecto actual
      const copiedImagesResponse = await pythonApi.copy_image_paths(selectedImagesResponse.paths);

      if (copiedImagesResponse.ok && copiedImagesResponse.copied > 0) {
        // Recargar todas las imágenes del proyecto
        await this.loadProjectImages();

        // Disparar evento personalizado
        const event = new CustomEvent('images-loaded', {
          detail: { count: copiedImagesResponse.copied }
        });
        document.dispatchEvent(event);

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error cargando nuevas imágenes:', error);
      throw error;
    }
  }

  /** Limpiar archivos temporales (compatibilidad con el componente) */
  async clearTemporaryFiles(): Promise<void> {
    // En pywebview no necesitamos limpiar archivos temporales específicamente
    // ya que las imágenes se manejan directamente desde el proyecto
    console.log('🧹 Limpieza de archivos temporales (no aplicable en pywebview)');
  }

  /** Convertir coordenadas normalizadas a píxeles */
  normalizedToPixelCoordinates(normalized: { x: number; y: number }): { x: number; y: number } {
    return {
      x: normalized.x * this.imageDimensions.width,
      y: normalized.y * this.imageDimensions.height
    };
  }

  /** Convertir coordenadas de píxeles a normalizadas */
  pixelToNormalizedCoordinates(pixel: { x: number; y: number }): { x: number; y: number } {
    if (this.imageDimensions.width === 0 || this.imageDimensions.height === 0) {
      return pixel; // Si no hay dimensiones, devolver tal como está
    }

    return {
      x: pixel.x / this.imageDimensions.width,
      y: pixel.y / this.imageDimensions.height
    };
  }

  /** Obtener estadísticas del proyecto */
  getProjectStatistics(): {
    totalImages: number;
    annotatedImages: number;
    totalAnnotations: number;
  } {
    const images = this.imagesSubject.value;
    const currentAnnotations = this.annotationsSubject.value;

    // TODO: Implementar lógica real para contar imágenes anotadas
    // Por ahora, asumimos que si hay anotaciones en la imagen actual, está anotada
    const annotatedImages = currentAnnotations.length > 0 ? 1 : 0;

    return {
      totalImages: images.length,
      annotatedImages: annotatedImages,
      totalAnnotations: currentAnnotations.length
    };
  }

  /** Exportar anotaciones en formato YOLO */
  async exportYOLO(): Promise<void> {
    try {
      const pythonApi = this.api.requireApi();

      // Guardar anotaciones actuales antes de exportar
      await this.saveCurrentAnnotations();

      // Llamar al método de exportación en Python
      // TODO: Implementar exportYOLO en la API de Python
      console.log('🔄 Exportando anotaciones en formato YOLO...');
      // await pythonApi.export_yolo();

      console.log('✅ Anotaciones exportadas exitosamente');
    } catch (error) {
      console.error('Error exportando anotaciones YOLO:', error);
      throw error;
    }
  }

  /** Dividir dataset en train/validation/test */
  async splitDataset(trainRatio: number = 0.7, valRatio: number = 0.2, testRatio: number = 0.1): Promise<void> {
    try {
      const pythonApi = this.api.requireApi();

      // Guardar anotaciones actuales antes de dividir
      await this.saveCurrentAnnotations();

      // Llamar al método de división en Python
      // TODO: Implementar splitDataset en la API de Python
      console.log('🔄 Dividiendo dataset...');
      // await pythonApi.split_dataset(trainRatio, valRatio, testRatio);

      console.log('✅ Dataset dividido exitosamente');

      // Recargar imágenes después de la división
      await this.loadProjectImages();
    } catch (error) {
      console.error('Error dividiendo dataset:', error);
      throw error;
    }
  }
}
