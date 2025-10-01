import { Injectable, signal } from '@angular/core';

export type MenuAction =
  // Archivo
  'nuevo-proyecto' | 'abrir-proyecto' | 'abrir-reciente' | 'importar-dataset' | 'importar-modelo' | 'importar-config' |
  'exportar-proyecto' | 'exportar-resultados' | 'exportar-pdf' | 'salir' | // salir cierra pywebview
  // Proyecto
  'guardar-proyecto' | 'cerrar-proyecto' | 'cargar-imagenes' | 'gestionar-imagenes' | 'gestionar-clases' | 'exportar-yolo' |
  // Herramientas
  'validar-dataset' | 'convertir-coco-yolo' | 'convertir-pascal-yolo' | 'convertir-yolo-coco' | 'estadisticas-dataset' | 'limpiar-cache' | 'optimizar-rendimiento' | 'configurar-gpu' | 'monitor-sistema' | 'opciones' |
  // Entrenamiento
  'gestionar-modelos' | 'importar-modelo-entrenamiento' | 'exportar-modelos' |
  // Ver
  'recargar' | 'forzar-recarga' | 'toggle-devtools' | 'zoom-normal' | 'zoom-in' | 'zoom-out' | 'toggle-fullscreen' |
  // Ventana
  'minimizar' | 'cerrar-ventana' |
  // Ayuda
  'documentacion' | 'tutorial-primeros-pasos' | 'tutorial-entrenamiento' | 'tutorial-anotacion' | 'ejemplo-dataset' | 'ejemplo-proyecto' | 'soporte-tecnico' | 'reportar-error' | 'sugerir-mejora' | 'buscar-actualizaciones' | 'acerca-de' |
  // Especiales internos
  'limpiar-recientes';

type Handler = (payload?: any) => void | Promise<void>;

@Injectable({ providedIn: 'root' })
export class MenuService {
  private handlers = new Map<MenuAction, Handler[]>();
  readonly lastAction = signal<MenuAction | null>(null);
  readonly lastPayload = signal<any>(null);

  on(action: MenuAction, handler: Handler) {
    const list = this.handlers.get(action) || [];
    list.push(handler);
    this.handlers.set(action, list);
    return () => this.off(action, handler);
  }

  off(action: MenuAction, handler: Handler) {
    const list = this.handlers.get(action);
    if (!list) return;
    this.handlers.set(action, list.filter(h => h !== handler));
  }

  dispatch(action: MenuAction, payload?: any) {
    this.lastAction.set(action);
    this.lastPayload.set(payload);
    const list = this.handlers.get(action) || [];
    for (const h of list) {
      try { h(payload); } catch (e) { console.error('[MenuService] Handler error', action, e); }
    }
  }
}
