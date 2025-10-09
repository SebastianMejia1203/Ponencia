import { Component, signal, ViewChild, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';

// Spartan UI Imports
import { BrnDialogContent, BrnDialogTrigger } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  HlmDialog,
  HlmDialogContent,
  HlmDialogDescription,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
} from '@spartan-ng/helm/dialog';

// Services
import { ProjectService } from '../../services/project.service';
import { PythonApiService } from '../../services/python-api.service';

interface ExtendedImageData {
  filename: string;
  path: string;
  fileSize: number;
  dimensions?: { width: number; height: number };
  hasAnnotations: boolean;
  modified?: number;
  thumbnailUrl?: string; // URL de la miniatura en base64
}

@Component({
  selector: 'app-manage-images-dialog',
  standalone: true,
  imports: [
    CommonModule,
    BrnDialogTrigger,
    BrnDialogContent,
    HlmDialog,
    HlmDialogContent,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmDialogTitle,
    HlmDialogDescription,
    HlmButton,
  ],
  template: `
    <hlm-dialog #dialogRef>
      <!-- Trigger oculto que se activará programáticamente -->
      <button
        #hiddenTrigger
        brnDialogTrigger
        hlmBtn
        variant="default"
        style="display: none; opacity: 0; pointer-events: none;"
        [disabled]="true"
      >
        Hidden Trigger
      </button>

      <hlm-dialog-content class="sm:max-w-[700px] max-h-[90vh] flex flex-col" *brnDialogContent="let ctx">
        <hlm-dialog-header class="flex-shrink-0">
          <h3 hlmDialogTitle>Gestionar Imágenes</h3>
          <p hlmDialogDescription>
            Administre las imágenes de su proyecto. Puede agregar nuevas imágenes o eliminar las existentes.
          </p>
        </hlm-dialog-header>

        <div class="flex-1 flex flex-col py-4 min-h-0">
          <!-- Lista de imágenes con overflow SOLO aquí -->
          <div class="flex-1 overflow-y-auto min-h-0 mb-4">
            <div class="space-y-3 pr-2">
              @if (images().length === 0) {
                <div class="text-center py-8 text-gray-500">
                  <p class="text-lg mb-2">📁 No hay imágenes en el proyecto</p>
                  <p class="text-sm">Agregue algunas imágenes para comenzar</p>
                </div>
              } @else {
                @for (image of images(); track image.filename; let i = $index) {
                  <div class="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50">
                    <!-- Thumbnail de la imagen -->
                    <div class="w-12 h-12 bg-gray-200 rounded flex items-center justify-center flex-shrink-0 overflow-hidden">
                      @if (image.thumbnailUrl) {
                        <img
                          [src]="image.thumbnailUrl"
                          [alt]="image.filename"
                          class="w-full h-full object-cover"
                        />
                      } @else {
                        <span class="text-xs text-gray-600">IMG</span>
                      }
                    </div>

                    <!-- Información de imagen -->
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium truncate" [title]="image.filename">
                        {{ image.filename }}
                      </div>
                      <div class="text-xs text-gray-500 flex gap-4">
                        <span>{{ formatFileSize(image.fileSize) }}</span>
                        @if (image.dimensions) {
                          <span>{{ image.dimensions.width }}×{{ image.dimensions.height }}</span>
                        }
                      </div>
                    </div>

                    <!-- Acciones -->
                    <div class="flex gap-1 flex-shrink-0">
                      <button
                        hlmBtn
                        variant="outline"
                        size="sm"
                        (click)="removeImage(i, image)"
                        class="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                        [disabled]="isRemoving()"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Agregar nuevas imágenes (FUERA del overflow) -->
          <div class="flex-shrink-0 p-4 border-2 border-dashed border-gray-300 rounded-lg mb-4">
            <div class="text-center">
              <p class="text-sm text-gray-600 mb-3">Agregar nuevas imágenes al proyecto</p>
              <div class="flex gap-2 justify-center">
                <button
                  hlmBtn
                  variant="default"
                  (click)="addImages()"
                  [disabled]="isLoading()"
                >
                  @if (isLoading()) {
                    <span class="animate-spin mr-2">⏳</span>
                  } @else {
                    📁
                  }
                  Seleccionar Imágenes
                </button>
                <button
                  hlmBtn
                  variant="outline"
                  (click)="addFromFolder()"
                  [disabled]="isLoading()"
                >
                  📂 Desde Carpeta
                </button>
              </div>
              <p class="text-xs text-gray-500 mt-2">
                Formatos soportados: JPG, PNG, BMP, TIFF
              </p>
            </div>
          </div>

          <!-- Estadísticas (FUERA del overflow) -->
          <div class="flex-shrink-0 p-3 bg-gray-50 rounded-lg">
            <div class="text-sm text-gray-600 grid grid-cols-2 gap-4">
              <div>
                <p><strong>Total de imágenes:</strong> {{ images().length }}</p>
              </div>
              <div>
                <p><strong>Tamaño total:</strong> {{ getTotalSize() }}</p>
              </div>
            </div>
          </div>
        </div>

        <hlm-dialog-footer class="flex gap-2 flex-shrink-0 border-t pt-4">
          <button
            hlmBtn
            variant="outline"
            (click)="closeDialog(ctx)"
            type="button"
          >
            Cerrar
          </button>
          <button
            hlmBtn
            variant="default"
            (click)="refreshImages()"
            [disabled]="isLoading()"
            type="button"
          >
            @if (isLoading()) {
              <span class="animate-spin mr-2">⏳</span>
            }
            Actualizar
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `
})
export class ManageImagesDialogComponent {
  private projectService = inject(ProjectService);
  private api = inject(PythonApiService);
  private cdr = inject(ChangeDetectorRef);

  // Estados reactivos
  images = signal<ExtendedImageData[]>([]);
  isLoading = signal<boolean>(false);
  isRemoving = signal<boolean>(false);

  @ViewChild('hiddenTrigger', { static: false}) hiddenTrigger!: any;

  private isDialogOpen = false;

  /**
   * Abrir el diálogo programáticamente
   */
  openDialog() {
    console.log('🔧 Intentando abrir diálogo de gestión de imágenes...');

    // Prevenir múltiples aperturas
    if (this.isDialogOpen) {
      console.log('⚠️ Diálogo ya está abierto, ignorando solicitud');
      return;
    }

    this.loadCurrentImages();

    if (this.hiddenTrigger?.nativeElement) {
      this.isDialogOpen = true;
      console.log('✅ Activando trigger oculto...');

      // Temporalmente habilitar el botón para hacer clic
      this.hiddenTrigger.nativeElement.disabled = false;

      // Usar un pequeño delay para asegurar que el componente esté listo
      setTimeout(() => {
        if (this.hiddenTrigger?.nativeElement) {
          this.hiddenTrigger.nativeElement.click();
          // Volver a deshabilitar
          this.hiddenTrigger.nativeElement.disabled = true;

          // Configurar un watchdog para detectar cierre del diálogo
          this.setupDialogWatchdog();
        }
      }, 50);
    } else {
      console.error('⚠️ Hidden trigger no está disponible');
      this.isDialogOpen = false;
    }
  }

  /**
   * Configurar watchdog para detectar cierre del diálogo
   */
  private setupDialogWatchdog() {
    // Verificar cada 500ms si el diálogo sigue abierto
    const watchdog = setInterval(() => {
      // Si el backdrop no está presente, el diálogo se cerró
      const backdrop = document.querySelector('[data-brn-dialog-overlay]');
      if (!backdrop && this.isDialogOpen) {
        console.log('🔍 Watchdog detectó cierre del diálogo');
        this.onDialogClose();
        clearInterval(watchdog);
      }
    }, 500);

    // Limpiar watchdog después de 30 segundos (timeout de seguridad)
    setTimeout(() => {
      clearInterval(watchdog);
    }, 30000);
  }

  /**
   * Manejar el cierre del diálogo
   */
  onDialogClose() {
    this.isDialogOpen = false;
    console.log('✅ Diálogo cerrado, flag reseteado');
  }

  /**
   * Cargar imágenes del proyecto actual
   */
  private async loadCurrentImages() {
    const project = this.projectService.project();
    if (!project) {
      this.images.set([]);
      return;
    }

    this.isLoading.set(true);

    try {
      // Obtener lista de imágenes del proyecto
      const imageNames = await this.api.call('list_images');

      if (!imageNames || imageNames.length === 0) {
        console.log('No se encontraron imágenes en el proyecto');
        this.images.set([]);
        return;
      }

      console.log(`Encontradas ${imageNames.length} imágenes en el proyecto`);

      // Obtener información detallada de cada imagen
      const extendedImagePromises = imageNames.map(async (filename: string): Promise<ExtendedImageData> => {
        try {
          const result = await this.api.call('get_image_stats', filename);

          if (result.ok && result.stats) {
            // Cargar miniatura de la imagen
            let thumbnailUrl: string | undefined;
            try {
              const imageData = await this.api.call('get_image_base64', filename);
              if (imageData?.ok && imageData.dataUrl) {
                thumbnailUrl = imageData.dataUrl;
              }
            } catch (thumbError) {
              console.warn(`No se pudo cargar miniatura para ${filename}:`, thumbError);
            }

            // Mapear 'size' a 'fileSize' para compatibilidad
            return {
              ...result.stats,
              fileSize: result.stats.size,
              thumbnailUrl
            };
          } else {
            // Datos por defecto si falla
            return {
              filename,
              path: '',
              fileSize: 0,
              hasAnnotations: false
            };
          }
        } catch (error) {
          console.error(`Error obteniendo stats de ${filename}:`, error);
          return {
            filename,
            path: '',
            fileSize: 0,
            hasAnnotations: false
          };
        }
      });

      const extendedImages = await Promise.all(extendedImagePromises);
      this.images.set(extendedImages);
      console.log(`Cargadas ${extendedImages.length} imágenes con información extendida`);

    } catch (error) {
      console.error('Error cargando imágenes:', error);
      this.images.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Agregar imágenes individuales
   */
  async addImages() {
    const project = this.projectService.project();
    if (!project) {
      alert('No hay proyecto abierto');
      return;
    }

    this.isLoading.set(true);

    try {
      // Usar el diálogo nativo del backend
      const result = await this.api.call('select_images_dialog', 'Seleccionar Imágenes');

      if (result.ok && result.paths && result.paths.length > 0) {
        console.log(`Seleccionadas ${result.paths.length} imágenes`);

        // Copiar las imágenes al proyecto
        const copyResult = await this.api.call('copy_image_paths', result.paths);

        if (copyResult.ok) {
          console.log(`✅ ${copyResult.copied} imágenes copiadas correctamente`);

          // Actualizar la lista de imágenes en el servicio
          this.projectService.images.set(copyResult.images || []);

          // Recargar lista local
          await this.loadCurrentImages();

          // Emitir evento de imágenes cargadas
          const event = new CustomEvent('images-loaded', {
            detail: { count: copyResult.copied }
          });
          document.dispatchEvent(event);

          alert(`Se agregaron ${copyResult.copied} imágenes correctamente`);
        } else {
          alert('Error al copiar las imágenes');
        }
      }
    } catch (error) {
      console.error('Error agregando imágenes:', error);
      alert('Error al agregar imágenes: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Agregar imágenes desde una carpeta
   */
  async addFromFolder() {
    const project = this.projectService.project();
    if (!project) {
      alert('No hay proyecto abierto');
      return;
    }

    this.isLoading.set(true);

    try {
      // Abrir diálogo de selección de carpeta
      const result = await this.api.call('select_folder_dialog', 'Seleccionar Carpeta de Imágenes');

      if (result.ok && result.path) {
        console.log(`Carpeta seleccionada: ${result.path}`);

        // Aquí necesitaríamos un método del backend para escanear la carpeta
        // Por ahora, mostramos un mensaje indicando que esta funcionalidad requiere más trabajo
        alert('Esta funcionalidad requiere agregar un método adicional en el backend para escanear la carpeta.\n\nPor favor, use "Seleccionar Imágenes" para agregar imágenes individuales.');
      }
    } catch (error) {
      console.error('Error agregando imágenes desde carpeta:', error);
      alert('Error al agregar imágenes desde carpeta: ' + error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Eliminar imagen del proyecto
   */
  async removeImage(index: number, image: ExtendedImageData) {
    const confirmation = confirm(
      `¿Está seguro de que desea eliminar "${image.filename}"?${
        image.hasAnnotations ? '\n\nEsta imagen tiene anotaciones que también se eliminarán.' : ''
      }`
    );

    if (!confirmation) return;

    this.isRemoving.set(true);

    try {
      // Llamar al backend para eliminar la imagen
      const result = await this.api.call('delete_image', image.filename);

      if (result.ok) {
        console.log(`✅ Imagen ${image.filename} eliminada correctamente`);

        // Actualizar la lista de imágenes en el servicio
        if (result.images) {
          this.projectService.images.set(result.images);
        }

        // Recargar lista local
        await this.loadCurrentImages();

        // Emitir evento para que otros componentes se actualicen
        const event = new CustomEvent('images-updated', {
          detail: { deleted: image.filename }
        });
        document.dispatchEvent(event);
      } else {
        alert('Error al eliminar la imagen: ' + (result.error || 'Error desconocido'));
      }

    } catch (error) {
      console.error('Error eliminando imagen:', error);
      alert('Error al eliminar la imagen: ' + error);
    } finally {
      this.isRemoving.set(false);
    }
  }

  /**
   * Actualizar lista de imágenes
   */
  async refreshImages() {
    await this.loadCurrentImages();
  }

  /**
   * Cerrar diálogo
   */
  closeDialog(dialogContext: any) {
    this.onDialogClose();
    dialogContext.close();
  }

  // Métodos utilitarios

  /**
   * Formatear tamaño de archivo
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Obtener cantidad de imágenes con anotaciones
   */
  getAnnotatedCount(): number {
    return this.images().filter(img => img.hasAnnotations).length;
  }

  /**
   * Obtener cantidad de imágenes sin anotaciones
   */
  getUnannotatedCount(): number {
    return this.images().filter(img => !img.hasAnnotations).length;
  }

  /**
   * Obtener tamaño total de todas las imágenes
   */
  getTotalSize(): string {
    const totalBytes = this.images().reduce((sum, img) => sum + img.fileSize, 0);
    return this.formatFileSize(totalBytes);
  }
}
