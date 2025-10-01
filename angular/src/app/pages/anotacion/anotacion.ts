import { Component, signal, OnInit, OnDestroy, inject, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
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
import { AnnotationService, ImageData, Annotation, AnnotationBoundingBox, AnnotationPolygon } from '../../services/annotation.service';
import { ManageClassesDialogComponent } from '../../components/manage-classes-dialog/manage-classes-dialog.component';
import { Subscription } from 'rxjs';

type AnnotationMode = 'instance' | 'bounding-box';

interface ClassData {
  label: string;
  value: string;
  color: string;
}

// Eliminar interfaces duplicadas ya que están en el servicio

@Component({
  selector: 'app-anotacion',
  standalone: true,
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
    ManageClassesDialogComponent,
  ],
  providers: [provideIcons({ lucideChevronsUpDown, lucideSearch, lucideCheck })],
  templateUrl: './anotacion.html',
  styleUrl: './anotacion.scss'
})
export class Anotacion implements OnInit, OnDestroy {
  private projectService = inject(ProjectService);
  private annotationService = inject(AnnotationService);
  private cdr = inject(ChangeDetectorRef);
  private eventListeners: Array<() => void> = [];
  private subscriptions: Subscription[] = [];

  @ViewChild('workArea', { static: false }) workArea!: ElementRef<HTMLDivElement>;
  @ViewChild('imageElement', { static: false }) imageElement!: ElementRef<HTMLImageElement>;
  @ViewChild('manageClassesDialog', { static: false }) manageClassesDialog!: ManageClassesDialogComponent;

  // Estados de imagen y navegación
  currentImageData: ImageData | null = null;
  currentImage = 0;
  totalImages = 0;
  currentImageUrl = '';
  imageWidth = 0;
  imageHeight = 0;
  imageLoaded = false;

  // Estados de anotación
  selectedClass = '';
  annotationMode: AnnotationMode = 'instance';
  currentAnnotations: Annotation[] = [];
  selectedAnnotationId: number | null = null;

  // Estados de UI
  zoomLevel = 100;
  mouseX = 0;
  mouseY = 0;
  mouseImageX = 0;
  mouseImageY = 0;

  // Estados para pan y zoom
  isPanning = false;
  panX = 0;
  panY = 0;
  lastPanX = 0;
  lastPanY = 0;
  isMouseDown = false;

  // Estados para construcción de polígonos - ahora como array
  currentPolygonPoints: { x: number, y: number }[] = [];

  // Estados para construcción de cajas delimitadoras
  isDrawingBoundingBox = false;
  boundingBoxStartPoint: { x: number, y: number } | null = null;
  currentBoundingBox: { x: number, y: number, width: number, height: number } | null = null;

  // Estados de acordeones
  isAnnotationsExpanded = false;
  isStatisticsExpanded = false;

  // Estados para combobox
  public currentClassData = signal<ClassData | undefined>(undefined);
  public classComboboxState = signal<'closed' | 'open'>('closed');

  // Clases del proyecto - se actualizarán desde el proyecto actual
  classes: ClassData[] = [];

  ngOnInit() {
    this.loadProjectConfiguration();
    this.setupEventListeners();
    this.subscribeToAnnotationService();

    // Si ya hay un proyecto abierto, cargar las imágenes
    const currentProject = this.projectService.project();
    if (currentProject) {
      console.log('🔄 Proyecto ya abierto, cargando imágenes...');
      setTimeout(() => {
        this.annotationService.loadProjectImages();
      }, 100);
    }
  }

  ngOnDestroy() {
    // CRÍTICO: Limpiar archivos temporales al destruir componente
    this.annotationService.clearTemporaryFiles().then(() => {
      console.log('🧹 Archivos temporales limpiados al destruir componente');
    }).catch(error => {
      console.error('Error limpiando archivos temporales al destruir:', error);
    });

    // Limpiar event listeners
    this.eventListeners.forEach(cleanup => cleanup());
    // Limpiar subscripciones
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Suscribirse a los observables del servicio de anotación
   */
  private subscribeToAnnotationService() {
    // Suscribirse a las imágenes
    this.subscriptions.push(
      this.annotationService.images$.subscribe(images => {
        this.totalImages = images.length;
        console.log(`Total de imágenes cargadas: ${this.totalImages}`);
      })
    );

    // Suscribirse al índice de imagen actual
    this.subscriptions.push(
      this.annotationService.currentImageIndex$.subscribe(async index => {
        this.currentImage = index + 1; // UI usa base 1

        // CRÍTICO: Limpiar polígono y caja en construcción al cambiar imagen
        this.clearPolygon();
        this.clearBoundingBox();
        // NO limpiar currentAnnotations aquí - el servicio se encarga de cargar las correctas

        // Obtener la imagen actual con URL cargada
        try {
          console.log('🔄 Solicitando imagen actual con URL...');
          this.currentImageData = await this.annotationService.getCurrentImageWithUrl();
          if (this.currentImageData) {
            this.currentImageUrl = this.currentImageData.url;
            this.imageLoaded = false; // Reset para esperar nueva carga
            console.log(`🖼️ Imagen actual: ${this.currentImage}/${this.totalImages} - ${this.currentImageData.filename}`);
            console.log(`🔗 URL de imagen:`, this.currentImageUrl ? 'Cargada (data:image...)' : 'NO disponible');

            if (this.currentImageUrl && this.imageElement?.nativeElement) {
              setTimeout(() => {
                console.log('🔄 Simulando carga de imagen desde cache');
                this.onImageLoad();
              }, 100);
            }

            // CRÍTICO: Forzar detección de cambios para activar área de trabajo
            this.cdr.detectChanges();
          } else {
            this.currentImageUrl = '';
            this.imageLoaded = false;
            console.log(`⚠️ No se pudo cargar la imagen ${this.currentImage} - getCurrentImageWithUrl devolvió null`);
          }
        } catch (error) {
          console.error('❌ Error obteniendo imagen actual:', error);
          this.currentImageUrl = '';
          this.imageLoaded = false;
        }
      })
    );

    // Suscribirse a las anotaciones
    this.subscriptions.push(
      this.annotationService.annotations$.subscribe(annotations => {
        console.log(`📋 Recibidas ${annotations.length} anotaciones del servicio:`, annotations);
        this.currentAnnotations = annotations;
        console.log(`📋 Anotaciones asignadas al componente: ${this.currentAnnotations.length}`);

        // CRÍTICO: Forzar detección de cambios para que se muestren los polígonos inmediatamente
        this.cdr.detectChanges();
        console.log(`📋 Detección de cambios forzada después de cargar anotaciones`);
      })
    );

    // Suscribirse al estado de imágenes disponibles
    this.subscriptions.push(
      this.annotationService.hasImages$.subscribe(hasImages => {
        if (hasImages) {
          console.log('✅ Imágenes disponibles para anotación');
        } else {
          console.log('ℹ️ No hay imágenes cargadas');
        }
      })
    );
  }

  /**
   * Configurar listeners para eventos de proyecto
   */
  private setupEventListeners() {
    // Escuchar cuando se abre un proyecto
    const projectOpenedListener = (event: CustomEvent) => {
      console.log('🟢 Proyecto abierto en componente de anotación:', event.detail);

      // CRÍTICO: Limpiar archivos temporales del proyecto anterior (si los hay)
      this.annotationService.clearTemporaryFiles().then(() => {
        console.log('🧹 Archivos temporales del proyecto anterior limpiados');
      }).catch(error => {
        console.error('Error limpiando archivos temporales anteriores:', error);
      });

      this.loadProjectConfiguration();
      // Cargar imágenes existentes del proyecto
      console.log('🔄 Cargando imágenes existentes del proyecto...');
      this.annotationService.loadProjectImages();

      // CRÍTICO: Forzar inicialización del área de trabajo después de cargar proyecto
      setTimeout(() => {
        this.initializeWorkAreaIfNeeded();
        this.cdr.detectChanges();
      }, 800); // Más tiempo para que se carguen las imágenes
    };
    document.addEventListener('project-opened', projectOpenedListener as EventListener);
    this.eventListeners.push(() => document.removeEventListener('project-opened', projectOpenedListener as EventListener));


    // Escuchar cuando se cargan imágenes
    const imagesLoadedListener = (event: CustomEvent) => {
      console.log('Imágenes cargadas:', event.detail);
      // Recargar las imágenes del proyecto para incluir las nuevas
      this.annotationService.loadProjectImages();

      // CRÍTICO: Forzar actualización de UI después de cargar imágenes
      setTimeout(() => {
        this.cdr.detectChanges();
      }, 300);
    };
    document.addEventListener('images-loaded', imagesLoadedListener as EventListener);
    this.eventListeners.push(() => document.removeEventListener('images-loaded', imagesLoadedListener as EventListener));

    // Escuchar cuando se actualizan las clases
    const classesUpdatedListener = (event: CustomEvent) => {
      console.log('🔄 Clases actualizadas:', event.detail);

      // Actualizar las clases locales
      this.loadProjectConfiguration();

      // Si la clase actual no existe más, resetear la selección
      const currentClass = this.currentClassData();
      if (currentClass) {
        const classStillExists = this.classes.find(c => c.value === currentClass.value);
        if (!classStillExists) {
          // La clase actual ya no existe, seleccionar la primera disponible
          if (this.classes.length > 0) {
            const firstClass = this.classes[0];
            this.currentClassData.set(firstClass);
            this.selectedClass = firstClass.value;
          } else {
            this.currentClassData.set(undefined);
            this.selectedClass = '';
          }
        }
      } else if (this.classes.length > 0) {
        // No había clase seleccionada, seleccionar la primera
        const firstClass = this.classes[0];
        this.currentClassData.set(firstClass);
        this.selectedClass = firstClass.value;
      }

      // CRÍTICO: Forzar detección de cambios para actualizar el combobox
      this.cdr.detectChanges();
    };
    document.addEventListener('classes-updated', classesUpdatedListener as EventListener);
    this.eventListeners.push(() => document.removeEventListener('classes-updated', classesUpdatedListener as EventListener));

    // Escuchar cuando se cierra un proyecto
    const projectClosedListener = (event: CustomEvent) => {
      console.log('🔴 Proyecto cerrado en componente de anotación:', event.detail);

      // CRÍTICO: Limpiar archivos temporales del proyecto cerrado
      this.annotationService.clearTemporaryFiles().then(() => {
        console.log('🧹 Archivos temporales del proyecto cerrado limpiados');
      }).catch(error => {
        console.error('Error limpiando archivos temporales del proyecto cerrado:', error);
      });

      this.resetToDefaultConfiguration();
    };
    document.addEventListener('project-closed', projectClosedListener as EventListener);
    this.eventListeners.push(() => document.removeEventListener('project-closed', projectClosedListener as EventListener));
  }

  /**
   * Resetear a configuración por defecto cuando no hay proyecto
   */
  private resetToDefaultConfiguration() {
    // Limpiar estado
    this.currentImageData = null;
    this.currentImage = 0;
    this.totalImages = 0;
    this.currentImageUrl = '';
    this.imageLoaded = false;
    this.currentAnnotations = [];

    // Resetear estados de dibujo
    this.clearPolygon();
    this.clearBoundingBox();

    // Resetear zoom y pan
    this.resetView();

    // Configurar clases por defecto
    this.classes = this.getDefaultClasses();
    if (this.classes.length > 0) {
      const firstClass = this.classes[0];
      this.currentClassData.set(firstClass);
      this.selectedClass = firstClass.value;
    } else {
      this.currentClassData.set(undefined);
      this.selectedClass = '';
    }

    console.log('🔄 Configuración resetada a valores por defecto');
  }

  /**
   * Cargar configuración del proyecto actual
   */
  private loadProjectConfiguration() {
    const project = this.projectService.project();

    if (!project || !project.classes || project.classes.length === 0) {
      console.log('ℹ️ No hay proyecto abierto o sin clases configuradas, usando configuración por defecto');
      this.classes = this.getDefaultClasses();
    } else {
      console.log('🔄 Cargando configuración del proyecto:', project);
      this.classes = this.generateClassesFromProject(project.classes);
    }

    // Seleccionar la primera clase disponible
    if (this.classes.length > 0) {
      const firstClass = this.classes[0];
      this.currentClassData.set(firstClass);
      this.selectedClass = firstClass.value;
    } else {
      this.currentClassData.set(undefined);
      this.selectedClass = '';
    }
  }

  /**
   * Generar clases con colores desde los nombres del proyecto
   */
  private generateClassesFromProject(classNames: string[]): ClassData[] {
    const colorPalette = [
      'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
      'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-gray-500',
      'bg-orange-500', 'bg-teal-500', 'bg-cyan-500', 'bg-lime-500'
    ];

    return classNames.map((name, index) => ({
      label: name,
      value: name.toLowerCase().replace(/\s+/g, '-'),
      color: colorPalette[index % colorPalette.length]
    }));
  }

  /**
   * Obtener clases por defecto si no hay proyecto
   */
  private getDefaultClasses(): ClassData[] {
    return [
      { label: 'Clase 1', value: 'clase-1', color: 'bg-red-500' }
    ];
  }

  // Eliminar arrays obsoletos - ahora usamos el servicio
  constructor() {}

  /**
   * Obtener clase CSS para el indicador de color
   */
  getClassCssColor(className: string): string {
    const classData = this.classes.find(c => c.label === className);
    return classData ? classData.color : 'bg-gray-400';
  }

  // ==================== GETTERS ====================

  get annotatedImages(): number {
    // TODO: implementar lógica real de imágenes anotadas
    return 0;
  }

  get totalAnnotations(): number {
    return this.currentAnnotations.length;
  }

  // ==================== MÉTODOS DE NAVEGACIÓN ====================

  setAnnotationMode(mode: AnnotationMode): void {
    this.annotationMode = mode;
  }

  async previousImage(): Promise<void> {
    await this.annotationService.previousImage();
  }

  async nextImage(): Promise<void> {
    await this.annotationService.nextImage();
  }

  getClassColor(className: string): string {
    const classData = this.classes.find(c => c.label === className);

    if (classData) {
      // Convertir la clase de Tailwind a color hexadecimal
      return this.tailwindToColor(classData.color);
    }

    // Fallback a gris si no se encuentra la clase
    return '#888888';
  }

  /**
   * Convertir clases de Tailwind a colores hexadecimales
   */
  private tailwindToColor(tailwindClass: string): string {
    const colorMap: Record<string, string> = {
      'bg-red-500': '#ef4444',
      'bg-blue-500': '#3b82f6',
      'bg-green-500': '#22c55e',
      'bg-yellow-500': '#eab308',
      'bg-purple-500': '#a855f7',
      'bg-pink-500': '#ec4899',
      'bg-indigo-500': '#6366f1',
      'bg-gray-500': '#6b7280',
      'bg-orange-500': '#f97316',
      'bg-teal-500': '#14b8a6',
      'bg-cyan-500': '#06b6d4',
      'bg-lime-500': '#84cc16'
    };

    return colorMap[tailwindClass] || '#888888';
  }

  /**
   * Convertir array de puntos a string para SVG usando coordenadas de visualización
   */
  getPolygonPointsString(points: { x: number; y: number }[]): string {
    return points.map(point => `${point.x},${point.y}`).join(' ');
  }

  /**
   * Obtener string de puntos del polígono actual en construcción usando coordenadas de visualización
   */
  getCurrentPolygonPointsString(): string {
    return this.getPolygonPointsString(this.currentPolygonPoints);
  }

  /**
   * Track function para optimizar el renderizado de anotaciones
   */
  trackAnnotation(index: number, annotation: Annotation): number {
    return (annotation as any).id;
  }

  deleteAnnotation(annotationId: number): void {
    this.annotationService.removeAnnotation(annotationId);
  }

  // Placeholder methods for functionality
  newProject(): void {
    console.log('Nuevo proyecto');
  }

  openProject(): void {
    console.log('Abrir proyecto');
  }

  uploadImages(): void {
    console.log('Cargar imágenes');
  }

  openManageClasses(): void {
    console.log('Gestionar clases');
    this.manageClassesDialog?.openDialog();
  }

  undoPoint(): void {
    if (this.currentPolygonPoints.length > 0) {
      this.currentPolygonPoints.pop();
      console.log('Punto eliminado. Puntos restantes:', this.currentPolygonPoints.length);
    }
  }

  clearPolygon(): void {
    this.currentPolygonPoints = [];
    console.log('Polígono limpiado');
  }

  /**
   * Completar caja delimitadora actual
   */
  completeBoundingBox(): void {
    if (this.currentBoundingBox && this.currentBoundingBox.width > 10 && this.currentBoundingBox.height > 10 && this.currentClassData()) {
      const currentProject = this.projectService.project();
      if (!currentProject) {
        alert('No hay proyecto abierto');
        return;
      }

      // Encontrar el ID de clase
      const className = this.currentClassData()!.label;
      const classIndex = currentProject.classes?.findIndex(name => name === className) || 0;

      if (classIndex === -1) {
        alert('Clase no válida');
        return;
      }

      // Convertir a coordenadas normalizadas si es necesario
      const normalizedBbox = this.boundingBoxToNormalized(this.currentBoundingBox);

      const annotation: AnnotationBoundingBox = {
        id: Date.now(), // ID único temporal
        classId: classIndex,
        className: className,
        x: normalizedBbox.x,
        y: normalizedBbox.y,
        width: normalizedBbox.width,
        height: normalizedBbox.height
      };

      console.log('🔷 Añadiendo caja delimitadora:', annotation);
      this.annotationService.addAnnotation(annotation);

      // Limpiar la caja actual
      this.clearBoundingBox();
    } else {
      console.log('⚠️ Caja demasiado pequeña o clase no seleccionada');
    }
  }

  /**
   * Limpiar caja delimitadora actual
   */
  clearBoundingBox(): void {
    this.isDrawingBoundingBox = false;
    this.boundingBoxStartPoint = null;
    this.currentBoundingBox = null;
    console.log('Caja delimitadora limpiada');
  }

  /**
   * Convertir caja delimitadora de coordenadas de imagen a normalizadas
   */
  private boundingBoxToNormalized(bbox: { x: number, y: number, width: number, height: number }): { x: number, y: number, width: number, height: number } {
    if (this.imageWidth === 0 || this.imageHeight === 0) {
      return bbox; // Si no hay dimensiones, devolver tal como está
    }

    return {
      x: bbox.x / this.imageWidth,
      y: bbox.y / this.imageHeight,
      width: bbox.width / this.imageWidth,
      height: bbox.height / this.imageHeight
    };
  }

  /**
   * Manejar click derecho para completar polígono o caja
   */
  onCanvasRightClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.annotationMode === 'instance') {
      this.completePolygon();
    } else {
      this.clearBoundingBox();
    }
  }

  /**
   * Completar polígono actual
   */
  completePolygon(): void {
    if (this.currentPolygonPoints.length < 3) {
      console.log('⚠️ Se necesitan al menos 3 puntos para completar el polígono');
      return;
    }

    const selectedClass = this.currentClassData();
    if (!selectedClass) {
      alert('Selecciona una clase antes de crear la anotación');
      return;
    }

    const currentProject = this.projectService.project();
    if (!currentProject) {
      alert('No hay proyecto abierto');
      return;
    }

    // Encontrar el ID de clase
    const classIndex = currentProject.classes?.findIndex(name => name === selectedClass.label) || 0;

    if (classIndex === -1) {
      alert('Clase no válida');
      return;
    }

    // Crear la anotación
    const annotation: AnnotationPolygon = {
      id: Date.now(), // ID único temporal
      classId: classIndex,
      className: selectedClass.label,
      points: [...this.currentPolygonPoints] // Copia de los puntos
    };

    console.log('🔷 Añadiendo polígono:', annotation);
    this.annotationService.addAnnotation(annotation);

    // Limpiar el polígono actual
    this.clearPolygon();
  }

  moveBox(): void {
    console.log('Mover caja');
  }

  resizeBox(): void {
    console.log('Redimensionar caja');
  }

  deleteBox(): void {
    console.log('Eliminar caja');
  }

  splitDataset(): void {
    console.log('Dividir dataset');
  }

  exportYolo(): void {
    console.log('Exportar YOLO');
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(400, this.zoomLevel + 10);
    console.log(`🔍 Zoom: ${this.zoomLevel}%`);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(10, this.zoomLevel - 10);
    console.log(`🔍 Zoom: ${this.zoomLevel}%`);
  }

  /**
   * Restablecer vista al centro con zoom 100%
   */
  resetView(): void {
    this.zoomLevel = 100;
    this.panX = 0;
    this.panY = 0;
    console.log('🔄 Vista restablecida');
  }

  /**
   * Ajustar imagen al tamaño de la pantalla
   */
  fitToScreen(): void {
    if (!this.workArea || !this.imageLoaded) return;

    const workAreaRect = this.workArea.nativeElement.getBoundingClientRect();
    const availableWidth = workAreaRect.width - 32; // Margen
    const availableHeight = workAreaRect.height - 32; // Margen

    const scaleX = availableWidth / this.imageWidth;
    const scaleY = availableHeight / this.imageHeight;
    const scale = Math.min(scaleX, scaleY) * 100;

    this.zoomLevel = Math.min(400, Math.max(10, scale));
    this.panX = 0;
    this.panY = 0;
    console.log(`📐 Ajustado a pantalla: ${this.zoomLevel.toFixed(0)}%`);
  }

  /**
   * Callback cuando la imagen se ha cargado
   */
  onImageLoad(): void {
    if (!this.imageElement) return;

    const img = this.imageElement.nativeElement;
    this.imageWidth = img.naturalWidth;
    this.imageHeight = img.naturalHeight;
    this.imageLoaded = true;

    // Establecer dimensiones en el servicio para normalizaciones futuras
    this.annotationService.setImageDimensions(this.imageWidth, this.imageHeight);

    console.log(`🖼️ Imagen cargada: ${this.imageWidth}x${this.imageHeight}`);

    // CRÍTICO: Forzar detección de cambios después de cargar la imagen
    this.cdr.detectChanges();
  }

  /**
   * Simular carga de imagen desde cache para inicializar área de trabajo
   */
  private simulateImageLoadFromCache(): void {
    console.log('🔄 Simulando carga de imagen desde cache...');

    if (this.imageElement?.nativeElement?.complete && this.imageElement.nativeElement.naturalWidth > 0) {
      // La imagen ya está cargada, ejecutar onImageLoad
      this.onImageLoad();
      console.log('✅ Imagen ya estaba cargada, área de trabajo inicializada');
    }
  }

  /**
   * Inicializar área de trabajo si es necesario (cuando se carga desde cache)
   */
  private initializeWorkAreaIfNeeded(): void {
    if (this.currentImageUrl && this.imageElement?.nativeElement?.complete && !this.imageLoaded) {
      this.simulateImageLoadFromCache();
    }
  }
  onCanvasMouseDown(event: MouseEvent): void {
    // Manejar paneo con botón central o Alt+Click
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      this.isPanning = true;
      this.lastPanX = event.clientX;
      this.lastPanY = event.clientY;
      return;
    }

    this.isMouseDown = true;
    this.handleAnnotationClick(event);
  }

  /**
   * Manejo del mouse move en el canvas
   */
  onCanvasMouseMove(event: MouseEvent): void {
    // Actualizar coordenadas del mouse
    this.updateMouseCoordinates(event);

    // Manejar paneo
    if (this.isPanning) {
      this.panX += (event.clientX - this.lastPanX);
      this.panY += (event.clientY - this.lastPanY);
      this.lastPanX = event.clientX;
      this.lastPanY = event.clientY;
      return;
    }

    // Manejar dibujo de caja delimitadora
    this.handleBoundingBoxDrawing(event);
  }

  /**
   * Manejo del mouse up en el canvas
   */
  onCanvasMouseUp(event: MouseEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
    }
    this.isMouseDown = false;
  }

  /**
   * Manejo del wheel para zoom
   */
  onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    const zoomDelta = event.deltaY > 0 ? -10 : 10;
    this.zoomLevel = Math.min(400, Math.max(10, this.zoomLevel + zoomDelta));
    console.log(`🔍 Zoom: ${this.zoomLevel}%`);
  }

  /**
   * Actualizar coordenadas del mouse teniendo en cuenta las transformaciones
   */
  private updateMouseCoordinates(event: MouseEvent): void {
    if (!this.imageElement?.nativeElement) return;

    const rect = this.imageElement.nativeElement.getBoundingClientRect();
    const scale = this.zoomLevel / 100;

    // Calcular posición relativa en la imagen
    const x = (event.clientX - rect.left - this.panX) / scale;
    const y = (event.clientY - rect.top - this.panY) / scale;

    this.mouseImageX = Math.round(x);
    this.mouseImageY = Math.round(y);
  }

  /**
   * Actualizar la caja delimitadora actual mientras se dibuja
   */
  private updateCurrentBoundingBox(event: MouseEvent): void {
    if (!this.isDrawingBoundingBox || !this.boundingBoxStartPoint) return;

    const currentPoint = this.viewportToImageCoordinates(event);
    if (!currentPoint) return;

    const x = Math.min(this.boundingBoxStartPoint.x, currentPoint.x);
    const y = Math.min(this.boundingBoxStartPoint.y, currentPoint.y);
    const width = Math.abs(this.boundingBoxStartPoint.x - currentPoint.x);
    const height = Math.abs(this.boundingBoxStartPoint.y - currentPoint.y);

    this.currentBoundingBox = { x, y, width, height };
  }

  /**
   * Manejar clicks para anotación
   */
  private handleAnnotationClick(event: MouseEvent): void {
    const imagePoint = this.viewportToImageCoordinates(event);
    if (!imagePoint) return;

    if (this.annotationMode === 'instance') {
      this.handlePolygonClick(imagePoint);
    } else if (this.annotationMode === 'bounding-box') {
      this.handleBoundingBoxClick(imagePoint);
    }
  }

  /**
   * Manejar clicks para polígonos
   */
  private handlePolygonClick(imagePoint: { x: number, y: number }): void {
    // Agregar punto al polígono actual
    this.currentPolygonPoints.push({
      x: imagePoint.x,
      y: imagePoint.y
    });

    console.log(`📍 Punto agregado: (${imagePoint.x}, ${imagePoint.y}). Total: ${this.currentPolygonPoints.length}`);
  }

  /**
   * Convertir coordenadas del viewport a coordenadas de la imagen original
   * Ahora tiene en cuenta las transformaciones de pan y zoom correctamente
   */
  private viewportToImageCoordinates(event: MouseEvent): { x: number, y: number } | null {
    if (!this.imageElement?.nativeElement) return null;

    const rect = this.imageElement.nativeElement.getBoundingClientRect();
    const scale = this.zoomLevel / 100;

    // Calcular coordenadas considerando transformaciones
    const x = (event.clientX - rect.left - this.panX) / scale;
    const y = (event.clientY - rect.top - this.panY) / scale;

    // Validar que esté dentro de los límites de la imagen
    if (x < 0 || y < 0 || x > this.imageWidth || y > this.imageHeight) {
      return null;
    }

    return { x, y };
  }

  /**
   * Manejar clicks para bounding boxes
   */
  private handleBoundingBoxClick(imagePoint: { x: number, y: number }): void {
    if (!this.isDrawingBoundingBox) {
      // Iniciar nueva caja
      this.isDrawingBoundingBox = true;
      this.boundingBoxStartPoint = { ...imagePoint };
      this.currentBoundingBox = { x: imagePoint.x, y: imagePoint.y, width: 0, height: 0 };
      console.log(`📦 Iniciando caja en: (${imagePoint.x}, ${imagePoint.y})`);
    } else {
      // Completar caja actual
      this.completeBoundingBox();
    }
  }

  /**
   * Manejar dibujo de bounding box
   */
  private handleBoundingBoxDrawing(event: MouseEvent): void {
    if (!this.isDrawingBoundingBox || !this.boundingBoxStartPoint) return;

    const currentPoint = this.viewportToImageCoordinates(event);
    if (!currentPoint) return;

    // Calcular dimensiones de la caja
    const x = Math.min(this.boundingBoxStartPoint.x, currentPoint.x);
    const y = Math.min(this.boundingBoxStartPoint.y, currentPoint.y);
    const width = Math.abs(this.boundingBoxStartPoint.x - currentPoint.x);
    const height = Math.abs(this.boundingBoxStartPoint.y - currentPoint.y);

    this.currentBoundingBox = { x, y, width, height };
  }

  /**
   * Convertir coordenadas de imagen original a coordenadas de visualización (SVG)
   * Ahora tiene en cuenta las transformaciones de pan y zoom
   */
  private imageToDisplayCoordinates(imagePoint: { x: number, y: number }): { x: number, y: number } | null {
    if (!this.imageElement?.nativeElement || !this.imageLoaded) return null;

    // Las coordenadas del SVG son relativas a la imagen, que ya está transformada
    // Simplemente devolvemos las coordenadas de la imagen tal como están
    // porque el SVG está contenido dentro del div transformado
    return {
      x: imagePoint.x,
      y: imagePoint.y
    };
  }

  /**
   * Obtener el path SVG para un polígono basado en coordenadas de imagen original
   */
  getPolygonPath(points: Array<{ x: number, y: number }>): string {
    if (!points || points.length === 0) return '';

    // Convertir todos los puntos a coordenadas de visualización
    const displayPoints = points.map(p => this.imageToDisplayCoordinates(p)).filter(p => p !== null);

    if (displayPoints.length === 0) return '';

    // Construir el path SVG
    let path = `M ${displayPoints[0]!.x} ${displayPoints[0]!.y}`;
    for (let i = 1; i < displayPoints.length; i++) {
      path += ` L ${displayPoints[i]!.x} ${displayPoints[i]!.y}`;
    }
    path += ' Z'; // Cerrar el path

    return path;
  }

  /**
   * Obtener coordenadas de visualización para un punto
   */
  getDisplayPoint(imagePoint: { x: number, y: number }): { x: number, y: number } | null {
    return this.imageToDisplayCoordinates(imagePoint);
  }

  /**
   * Obtener las coordenadas del mouse en el espacio de visualización del SVG
   */
  getMouseDisplayPoint(): { x: number, y: number } | null {
    return this.imageToDisplayCoordinates({ x: this.mouseImageX, y: this.mouseImageY });
  }

  /**
   * Obtener coordenadas de visualización para una caja delimitadora
   */
  getBoundingBoxDisplayCoords(annotation: any): { x: number, y: number, width: number, height: number } | null {
    if (!annotation || !this.imageLoaded) return null;

    // Si la anotación tiene coordenadas normalizadas, desnormalizarlas
    let x = annotation.x;
    let y = annotation.y;
    let width = annotation.width;
    let height = annotation.height;

    // Si las coordenadas están normalizadas (0-1), convertir a píxeles
    if (x <= 1 && y <= 1 && width <= 1 && height <= 1) {
      x *= this.imageWidth;
      y *= this.imageHeight;
      width *= this.imageWidth;
      height *= this.imageHeight;
    }

    return {
      x: x,
      y: y,
      width: width,
      height: height
    };
  }

  /**
   * Obtener coordenadas de visualización para la caja actual en construcción
   */
  getCurrentBoundingBoxDisplay(): { x: number, y: number, width: number, height: number } | null {
    if (!this.currentBoundingBox || !this.imageLoaded) return null;

    return {
      x: this.currentBoundingBox.x,
      y: this.currentBoundingBox.y,
      width: this.currentBoundingBox.width,
      height: this.currentBoundingBox.height
    };
  }

  // Métodos para acordeones
  toggleAnnotations(): void {
    this.isAnnotationsExpanded = !this.isAnnotationsExpanded;
  }

  toggleStatistics(): void {
    this.isStatisticsExpanded = !this.isStatisticsExpanded;
  }

  // Métodos para combobox
  classComboboxStateChanged(state: 'open' | 'closed'): void {
    this.classComboboxState.set(state);
  }

  commandSelected(classData: ClassData): void {
    this.currentClassData.set(classData);
    this.selectedClass = classData.value;
    this.classComboboxState.set('closed');
    console.log('🎯 Clase seleccionada:', classData.label);
  }
}
