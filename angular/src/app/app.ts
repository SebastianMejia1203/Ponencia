import { CreateProjectDialogComponent, NewProjectPayload } from './components/create-project-dialog/create-project-dialog.component';
import { ManageClassesDialogComponent } from './components/manage-classes-dialog/manage-classes-dialog.component';
import { ManageImagesDialogComponent } from './components/manage-images-dialog/manage-images-dialog.component';
import { Component, computed, signal, OnInit, OnDestroy, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmTabs, HlmTabsContent, HlmTabsList, HlmTabsTrigger } from '@spartan-ng/helm/tabs';
import { PythonApiService } from './services/python-api.service';
import { ProjectService } from './services/project.service';
import { Anotacion } from './pages/anotacion/anotacion';
import { Menubar } from './components/menubar/menubar';
import { MenuService } from './services/menu.service';
import { RecentProjectsService } from './services/recent-projects.service';
import { AnnotationService } from './services/annotation.service';
import { Entrenamiento } from "./pages/entrenamiento/entrenamiento";
import { Prediccion } from "./pages/prediccion/prediccion";
import { Resultado } from './pages/resultado/resultado';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    HlmButtonImports,
    HlmTabs,
    HlmTabsContent,
    HlmTabsList,
    HlmTabsTrigger,
    Anotacion,
    Menubar,
    CreateProjectDialogComponent,
    ManageClassesDialogComponent,
    ManageImagesDialogComponent,
    Entrenamiento,
    Prediccion,
    Resultado
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  // Título de la aplicación
  readonly title = signal('Yolo Tools App');

  // Estado de proyecto (simplificado – sin servicios externos todavía)
  readonly projectName = signal<string>('Sin proyecto');
  readonly isConnected = signal<boolean>(false);

  // Clases derivadas
  readonly connectionStatus = computed(() => this.isConnected() ? 'Conectado' : 'Desconectado');
  readonly connectionStatusClass = computed(() => this.isConnected() ? 'bg-green-500' : 'bg-red-500');

  private disposers: (() => void)[] = [];

  // Referencias a diálogos
  readonly manageClassesDialog = viewChild(ManageClassesDialogComponent);
  readonly manageImagesDialog = viewChild(ManageImagesDialogComponent);

  constructor(
    private pythonApi: PythonApiService,
    private project: ProjectService,
    private menu: MenuService,
    private recents: RecentProjectsService,
    private annotationService: AnnotationService
  ) {
    // Sin effect() explícito para no mantener logs; simple suscripción manual
    const sync = () => this.isConnected.set(this.pythonApi.apiReady());
    // Poll ligero hasta que se conecte, luego detiene
    const id = setInterval(() => {
      sync();
      if (this.pythonApi.apiReady()) clearInterval(id);
    }, 400);

  }

  ngOnInit() {
    // Suscribir accción de menú "abrir-proyecto"
    const offOpen = this.menu.on('abrir-proyecto', () => this.openProjectFromMenu());
    const offRecent = this.menu.on('abrir-reciente', (p: any) => this.openRecent(p));
    const offClearRec = this.menu.on('limpiar-recientes', () => this.recents.clear());
    const offSave = this.menu.on('guardar-proyecto', () => this.saveProjectFromMenu());
    const offClose = this.menu.on('cerrar-proyecto', () => this.closeProjectFromMenu());
    const offSalir = this.menu.on('salir', () => this.exitApp());
    const offCargar = this.menu.on('cargar-imagenes', () => this.loadImagesFromMenu());
    const offGestionarClases = this.menu.on('gestionar-clases', () => this.openManageClassesDialog());
    const offGestionarImagenes = this.menu.on('gestionar-imagenes', () => this.openManageImagesDialog());
    const offDocumentacion = this.menu.on('documentacion', () => this.openUserManual());
    this.disposers.push(offOpen, offRecent, offClearRec, offSave, offClose, offSalir, offCargar, offGestionarClases, offGestionarImagenes, offDocumentacion);
  }

  ngOnDestroy() {
    this.disposers.forEach(d => { try { d(); } catch {} });
  }

  private opening = false;

  // Progreso carga imágenes
  readonly imagesLoading = signal(false);
  readonly imagesCopied = signal(0);
  readonly imagesTotal = signal(0);
  readonly imagesElapsed = signal(0);
  readonly imagesProgressPct = computed(() => this.imagesTotal() === 0 ? 0 : (this.imagesCopied() / this.imagesTotal()) * 100);

  private async openProjectFromMenu() {
    if (this.opening) return;
    this.opening = true;
    try {
      const sel: any = await this.pythonApi.call('select_project_config', 'Abrir project_config.json');
      if (!sel || !sel.ok || !sel.path) {
        return; // cancelado o error silencioso (se puede mejorar con toast)
      }
      const res = await this.project.open(sel.path);
      if (res?.ok) {
        this.projectName.set(this.project.project()?.name || 'Proyecto');
        // registrar en recientes
        const cfgPath = sel.path.endsWith('project_config.json') ? sel.path : (sel.path + '/project_config.json');
        await this.recents.touch(this.project.project()?.name || 'Proyecto', cfgPath);
      } else {
        alert('No se pudo abrir el proyecto.');
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      alert('Error al abrir proyecto: ' + msg);
    } finally {
      this.opening = false;
    }
  }

  // Métodos temporales para demo de proyecto
  isProjectOpen() { return this.project.isOpen(); }
  projectDisplayName() { return this.project.project()?.name || 'Sin proyecto'; }
  async createProjectTemp() { await this.project.create('./demo_project', 'Proyecto Demo'); }
  // openProjectTemp eliminado: siempre usar diálogo nativo
  async closeProjectTemp() { await this.project.close(); }

  handleCreateProject(data: NewProjectPayload) {
    this.project.create(
      data.path,
      data.name,
      data.classes,
      data.task,
      data.meta
    ).then(res => { if (res?.ok) this.projectName.set(data.name); });
  }

  private async openRecent(payload: { configPath: string }) {
    if (!payload?.configPath) return;
    try {
      const res = await this.project.open(payload.configPath);
      if (res?.ok) {
        this.projectName.set(this.project.project()?.name || 'Proyecto');
        await this.recents.touch(this.project.project()?.name || 'Proyecto', payload.configPath);
      } else {
        alert('No se pudo abrir el proyecto reciente.');
      }
    } catch (e: any) {
      alert('Error abriendo reciente: ' + (e?.message || e));
    }
  }

  private async closeProjectFromMenu() {
    if (!this.project.isOpen()) {
      return; // No hay proyecto abierto
    }

    try {
      // Limpiar servicio de anotaciones (imágenes cargadas, anotaciones, cache)
      this.annotationService.clear();
      await this.annotationService.clearTemporaryFiles();

      // Cerrar proyecto en el backend y limpiar estado del servicio
      await this.project.close();

      // Restaurar nombre del proyecto a estado inicial
      this.projectName.set('Sin proyecto');

      // Limpiar estados de carga de imágenes
      this.imagesLoading.set(false);
      this.imagesCopied.set(0);
      this.imagesTotal.set(0);
      this.imagesElapsed.set(0);

      // Emitir evento personalizado para notificar a los componentes
      const event = new CustomEvent('project-closed');
      document.dispatchEvent(event);

      console.log('✅ Proyecto cerrado correctamente');
    } catch (error) {
      console.error('❌ Error cerrando proyecto:', error);
      alert('Error al cerrar el proyecto: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async saveProjectFromMenu() {
    if (!this.project.isOpen()) {
      alert('No hay proyecto abierto para guardar.');
      return;
    }

    try {
      const result = await this.project.save();

      if (result?.ok) {
        // Mostrar estadísticas si están disponibles
        let message = '✅ Proyecto guardado correctamente';
        if (result.stats) {
          const stats = result.stats;
          message += `\n\n📊 Estadísticas del proyecto:`;
          message += `\n   • Total de imágenes: ${stats.totalImages}`;
          message += `\n   • Train: ${stats.trainImages}`;
          message += `\n   • Validation: ${stats.valImages}`;
          message += `\n   • Test: ${stats.testImages}`;
          message += `\n   • Clases: ${stats.classes}`;
        }

        alert(message);
        console.log('✅ Proyecto guardado correctamente');
      } else {
        const errorMsg = result?.error || 'Error desconocido';
        console.error('❌ Error guardando proyecto:', errorMsg);
        alert('Error al guardar el proyecto:\n' + errorMsg);
      }
    } catch (error) {
      console.error('❌ Error guardando proyecto:', error);
      alert('Error al guardar el proyecto:\n' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private openManageClassesDialog() {
    if (!this.project.isOpen()) {
      alert('Debe abrir un proyecto primero para gestionar clases.');
      return;
    }

    const dialog = this.manageClassesDialog();
    if (dialog) {
      dialog.openDialog();
    }
  }

  private openManageImagesDialog() {
    if (!this.project.isOpen()) {
      alert('Debe abrir un proyecto primero para gestionar imágenes.');
      return;
    }

    const dialog = this.manageImagesDialog();
    if (dialog) {
      dialog.openDialog();
    }
  }

  private async openUserManual() {
    try {
      const result = await this.pythonApi.call('open_user_manual');
      if (!result?.ok) {
        alert('Error abriendo manual de usuario: ' + (result?.error || 'Error desconocido'));
      }
      // Si ok = true, el PDF se abre en el visor externo - no se necesita alert
    } catch (error) {
      console.error('Error abriendo manual:', error);
      alert('No se pudo abrir el manual: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async loadImagesFromMenu() {
    if (!this.project.isOpen()) {
      alert('Primero abre un proyecto.');
      return;
    }
    try {
      const sel: any = await this.pythonApi.call('select_images_dialog', 'Seleccionar imágenes');
      if (!sel?.ok || !sel.paths || sel.paths.length === 0) {
        return; // cancelado
      }
      // Copiar rutas directamente en backend
      this.imagesLoading.set(true);
      this.imagesTotal.set(sel.paths.length);
      this.imagesCopied.set(0);
      const t0 = performance.now();
      // Procesar en lotes para feedback (aunque backend copia todo junto, podríamos simular avance incremental)
      // En esta versión simplificada haremos una sola llamada y luego marcamos progreso completo.
      const res: any = await this.pythonApi.call('copy_image_paths', sel.paths);
      this.imagesElapsed.set((performance.now() - t0) / 1000);
      if (res?.ok) {
        this.imagesCopied.set(res.copied || 0);
        // Actualizar listado de imágenes en ProjectService
        if (Array.isArray(res.images)) {
          this.project.images.set(res.images);
          this.project.currentIndex.set(0);
        }
        // Disparar evento global para que otros componentes reaccionen
        const evt = new CustomEvent('images-loaded', {
          detail: {
            copied: res.copied || 0,
            total: sel.paths.length,
            images: res.images || [],
            elapsed: res.elapsed || this.imagesElapsed()
          }
        });
        document.dispatchEvent(evt);
      } else {
        alert('No se pudieron copiar las imágenes.');
      }
      // Cerrar overlay tras breve delay para que el usuario vea el 100%
      setTimeout(() => this.imagesLoading.set(false), 450);
    } catch (e: any) {
      alert('Error cargando imágenes: ' + (e?.message || e));
      this.imagesLoading.set(false);
    }
  }

  private async exitApp() {
    try {
      if (this.pythonApi.apiReady()) {
        await this.pythonApi.call('exit_app');
      }
      // Fallback: cerrar ventana actual (puede no funcionar en todos los contextos)
      window.close();
    } catch (e) {
      console.error('Error al salir:', e);
    }
  }
}
