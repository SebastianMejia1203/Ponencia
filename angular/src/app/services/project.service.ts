import { Injectable, signal, computed } from '@angular/core';
import { PythonApiService } from './python-api.service';

export interface ProjectInfo {
  name: string;
  root: string;
  configPath?: string; // Ruta al project_config.json para agregar a recientes
  createdAt?: string;
  classes?: string[];
  task?: 'detect' | 'segment';
  dataYamlPath?: string;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  readonly project = signal<ProjectInfo | null>(null);
  readonly images = signal<string[]>([]);
  readonly currentIndex = signal(0); // 0-based
  readonly currentImage = computed(() => this.images().length ? this.images()[this.currentIndex()] : null);
  readonly isOpen = computed(() => this.project() !== null);

  constructor(private api: PythonApiService) {}

  async create(path: string, name: string, classes?: string[], task: 'detect' | 'segment' = 'detect', meta?: any) {
    const res = await this.api.call('create_project', path, name, classes, task, meta);
    if (res?.ok) {
      // res.project.root ya apunta a la subcarpeta única creada
      this.project.set({ ...(res.project || { name, root: path }) });
      this.images.set(res.images || []);
      this.currentIndex.set(0);
    }
    return res;
  }

  async open(path: string) {
    const res = await this.api.call('open_project', path);
    if (res?.ok) {
      this.project.set(res.project);
      this.images.set(res.images || []);
      this.currentIndex.set(0);
    }
    return res;
  }

  async close() {
    if (!this.isOpen()) return;
    await this.api.call('close_project');
    this.project.set(null);
    this.images.set([]);
    this.currentIndex.set(0);
  }

  async save(updatedClasses?: string[]) {
    if (!this.isOpen()) {
      return { ok: false, error: 'No hay proyecto abierto' };
    }

    // Si se proporcionan clases actualizadas, enviarlas al backend
    const res = await this.api.call('save_project', updatedClasses);

    if (res?.ok && res.project) {
      // Actualizar la información del proyecto con los datos guardados
      this.project.set(res.project);
    }
    return res;
  }

  nextImage() {
    if (this.currentIndex() < this.images().length - 1) {
      this.currentIndex.update(i => i + 1);
    }
  }
  previousImage() {
    if (this.currentIndex() > 0) {
      this.currentIndex.update(i => i - 1);
    }
  }
}
