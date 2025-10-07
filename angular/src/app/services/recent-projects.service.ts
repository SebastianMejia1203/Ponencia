import { Injectable, signal, inject } from '@angular/core';
import { PythonApiService } from './python-api.service';

export interface RecentProjectEntry {
  name: string;
  configPath: string; // ruta absoluta a project_config.json
  openedAt: number;   // timestamp último uso
}

const MAX_RECENTS = 10;

@Injectable({ providedIn: 'root' })
export class RecentProjectsService {
  readonly items = signal<RecentProjectEntry[]>([]);
  private pythonApi = inject(PythonApiService);

  constructor() {
    this.load();
  }

  private async load() {
    try {
      // Esperar a que la API esté lista
      if (!this.pythonApi.apiReady()) {
        // Intentar cargar después de un pequeño delay
        setTimeout(() => this.load(), 500);
        return;
      }

      const api = this.pythonApi.api();
      if (!api) return;

      const response = await api.get_recent_projects();
      if (response.ok && response.projects) {
        this.items.set(response.projects.slice(0, MAX_RECENTS));
      }
    } catch (error) {
      console.error('[RecentProjectsService] Error cargando proyectos recientes:', error);
    }
  }

  async touch(name: string, configPath: string) {
    try {
      const api = this.pythonApi.requireApi();
      const response = await api.add_recent_project(name, configPath);

      if (response.ok && response.projects) {
        this.items.set(response.projects.slice(0, MAX_RECENTS));
      }
    } catch (error) {
      console.error('[RecentProjectsService] Error agregando proyecto reciente:', error);
    }
  }

  async clear() {
    try {
      const api = this.pythonApi.requireApi();
      const response = await api.clear_recent_projects();

      if (response.ok) {
        this.items.set([]);
      }
    } catch (error) {
      console.error('[RecentProjectsService] Error limpiando proyectos recientes:', error);
    }
  }

  // Método para refrescar la lista manualmente
  async refresh() {
    await this.load();
  }
}
