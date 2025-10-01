import { Injectable, signal } from '@angular/core';

export interface RecentProjectEntry {
  name: string;
  configPath: string; // ruta absoluta a project_config.json
  openedAt: number;   // timestamp último uso
}

const STORAGE_KEY = 'recent-projects-v1';
const MAX_RECENTS = 10;

@Injectable({ providedIn: 'root' })
export class RecentProjectsService {
  readonly items = signal<RecentProjectEntry[]>([]);

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: RecentProjectEntry[] = JSON.parse(raw);
        this.items.set(parsed.slice(0, MAX_RECENTS));
      }
    } catch {}
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items()));
    } catch {}
  }

  touch(name: string, configPath: string) {
    const list = this.items().filter(p => p.configPath !== configPath);
    list.unshift({ name, configPath, openedAt: Date.now() });
    this.items.set(list.slice(0, MAX_RECENTS));
    this.persist();
  }

  clear() {
    this.items.set([]);
    this.persist();
  }
}
