import { CreateProjectDialogComponent, NewProjectPayload } from './components/create-project-dialog/create-project-dialog.component';
import { Component, computed, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmTabs, HlmTabsContent, HlmTabsList, HlmTabsTrigger } from '@spartan-ng/helm/tabs';
import { PythonApiService } from './services/python-api.service';
import { ProjectService } from './services/project.service';
import { Anotacion } from './pages/anotacion/anotacion';
import { Menubar } from './components/menubar/menubar';
import { MenuService } from './services/menu.service';
import { RecentProjectsService } from './services/recent-projects.service';
import { Entrenamiento } from "./pages/entrenamiento/entrenamiento";
import { Prediccion } from "./pages/prediccion/prediccion";
import { Resultado } from './pages/resultado/resultado';

@Component({
  selector: 'app-root',
  imports: [CommonModule, HlmButtonImports, HlmTabs, HlmTabsContent, HlmTabsList, HlmTabsTrigger, Anotacion, Menubar, CreateProjectDialogComponent, Entrenamiento, Prediccion, Resultado],
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

  constructor(private pythonApi: PythonApiService, private project: ProjectService, private menu: MenuService, private recents: RecentProjectsService) {
    // Sin effect() explícito para no mantener logs; simple suscripción manual
    const sync = () => this.isConnected.set(this.pythonApi.apiReady());
    // Poll ligero hasta que se conecte, luego detiene
    const id = setInterval(() => {
      sync();
      if (this.pythonApi.apiReady()) clearInterval(id);
    }, 400);

  }

  ngOnInit() {
    // Suscribir acción de menú "abrir-proyecto"
    const offOpen = this.menu.on('abrir-proyecto', () => this.openProjectFromMenu());
    const offRecent = this.menu.on('abrir-reciente', (p: any) => this.openRecent(p));
    const offClearRec = this.menu.on('limpiar-recientes', () => this.recents.clear());
    const offSalir = this.menu.on('salir', () => this.exitApp());
    const offCargar = this.menu.on('cargar-imagenes', () => this.loadImagesFromMenu());
    this.disposers.push(offOpen, offRecent, offClearRec, offSalir);
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
        this.recents.touch(this.project.project()?.name || 'Proyecto', cfgPath);
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
        this.recents.touch(this.project.project()?.name || 'Proyecto', payload.configPath);
      } else {
        alert('No se pudo abrir el proyecto reciente.');
      }
    } catch (e: any) {
      alert('Error abriendo reciente: ' + (e?.message || e));
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
