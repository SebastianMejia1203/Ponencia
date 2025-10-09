// Tipos globales para la API expuesta desde Python vía pywebview
// Ajusta y expande conforme vayas exponiendo más métodos en Python.

export interface PyWebviewApi {
  hello(name: string): Promise<string>;

  /** Diálogo nativo para elegir el dataset .yaml */
  select_dataset_yaml(): Promise<{ ok: boolean; path?: string; error?: string }>;

  /**
   * Inicia entrenamiento YOLO.
   * @param task 'detect' | 'segment'
   * @param params Hiperparámetros de YOLO
   */
  start_training(
    task: 'detect' | 'segment',
    params: YOLOTrainingParams
  ): Promise<{ ok: boolean; error?: string }>;

  /** Señal de parada (best-effort) */
  stop_training(): Promise<{ ok: boolean; error?: string }>;

  /**
   * Crea proyecto YOLO.
   * @param path Ruta destino.
   * @param name Nombre del proyecto.
   * @param classes Lista de clases (opcional) - si se omite se crea placeholder.
   * @param task 'detect' | 'segment'
   */
  create_project(
    path: string,
    name: string,
    classes?: string[],
    task?: 'detect' | 'segment',
    meta?: {
      description?: string;
      model?: string;
      yoloModel?: string;
      segmentationType?: string;
      imageSize?: number;
      splits?: { train: number; val: number; test: number };
      augmentation?: boolean;
    }
  ): Promise<{ ok: boolean; project: any; images: string[] }>;
  open_project(path: string): Promise<{ ok: boolean; project: any; images: string[] }>;
  close_project(): Promise<{ ok: boolean }>;
  save_project(classes?: string[]): Promise<{ ok: boolean; project?: any; stats?: any; error?: string }>;
  list_images(): Promise<string[]>;
  get_image_base64(filename: string): Promise<{ ok: boolean; dataUrl?: string; filename?: string; error?: string }>; // data URL envuelta
  load_annotations(filename: string): Promise<any[]>; // array de anotaciones
  save_annotations(filename: string, annotations: any[]): Promise<{ ok: boolean }>;
  /** Abre un diálogo nativo para seleccionar carpeta de proyecto */
  select_directory(title?: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Abre un diálogo nativo para elegir directamente project_config.json */
  select_project_config(title?: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Agrega imágenes (data URLs) al proyecto y refresca listado */
  add_images(images: { name: string; dataUrl: string }[]): Promise<{ ok: boolean; added: number; images: string[] }>;
  /** Diálogo multi-selección de imágenes, retorna rutas */
  select_images_dialog(title?: string): Promise<{ ok: boolean; paths?: string[]; error?: string }>;
  /** Copia rutas de imágenes al dataset del proyecto */
  copy_image_paths(paths: string[]): Promise<{ ok: boolean; copied: number; images: string[]; elapsed?: number; error?: string }>;
  /** Obtiene estadísticas e información detallada de una imagen */
  get_image_stats(filename: string): Promise<{
    ok: boolean;
    stats?: {
      filename: string;
      path: string;
      size: number;
      dimensions?: { width: number; height: number };
      hasAnnotations: boolean;
      modified: number
    };
    error?: string
  }>;
  /** Elimina una imagen y sus anotaciones del proyecto */
  delete_image(filename: string): Promise<{ ok: boolean; images?: string[]; deleted?: string; error?: string }>;
  /** Verifica si una imagen tiene anotaciones */
  check_image_annotations(filename: string): Promise<{ ok: boolean; hasAnnotations?: boolean; count?: number; error?: string }>;
  /** Abre diálogo para seleccionar una carpeta */
  select_folder_dialog(title?: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Cierra la aplicación */
  copy_image_paths(paths: string[]): Promise<{ ok: boolean; copied: number; images: string[]; elapsed?: number }>;
  /** Obtiene recursos del sistema (CPU, memoria, GPU, etc.) */
  get_system_resources(): Promise<SystemResources>;
  /** Obtiene la lista de proyectos recientes */
  get_recent_projects(): Promise<{ ok: boolean; projects: RecentProject[]; error?: string }>;
  /** Agrega un proyecto a la lista de recientes */
  add_recent_project(name: string, configPath: string): Promise<{ ok: boolean; projects?: RecentProject[]; error?: string }>;
  /** Limpia la lista de proyectos recientes */
  clear_recent_projects(): Promise<{ ok: boolean; error?: string }>;
  /** Abre el manual de usuario en PDF */
  open_user_manual(): Promise<{ ok: boolean; path?: string; error?: string }>;
  exit_app(): Promise<{ ok: boolean; error?: string }>;
}

export interface PyWebviewWrapper {
  api?: PyWebviewApi;
  // Eventos especiales (pywebview suele disparar window.pywebviewready)
}

declare global {
  interface Window {
    pywebview?: PyWebviewWrapper;
    __pushLog?: (msg: string) => void;
    // Evento custom disparado internamente cuando python inyecta la API
    // window.addEventListener('pywebview:ready', () => {})  (lo lanzaremos manual si hace falta)
  }
}

export interface YOLOTrainingParams {
  // esenciales
  model?: string;          // p.ej. 'yolo11n.pt' o 'yolo11n-seg.pt'
  epochs?: number;         // int
  batch?: number;          // int
  imgsz?: number;          // int
  learningRate?: number;   // lo mapeamos a lr0 en Python

  // comunes / avanzados (opcionales)
  lr0?: number;
  device?: string;         // 'cpu', '0', '0,1', etc.
  name?: string;           // nombre del run
  project?: string;        // carpeta del proyecto de runs
  pretrained?: boolean;
  optimizer?: 'SGD'|'Adam'|'AdamW'|string;
  seed?: number;
  deterministic?: boolean;
  single_cls?: boolean;
  classes?: number[];      // filtrar clases
  rect?: boolean;
  multi_scale?: boolean;
  cos_lr?: boolean;
  close_mosaic?: number|boolean;
  resume?: boolean|string; // path de checkpoint o true
  amp?: boolean;
  fraction?: number;       // para dataset parcial
  freeze?: number|number[];
  workers?: number;
}

export interface SystemResources {
  cpu: {
    percent: number;
    count: number;
  };
  memory: {
    percent: number;
    used_gb: number;
    total_gb: number;
  };
  gpu: {
    gpu_available: boolean;
    gpu_name: string;
    gpu_memory_used_gb: number;
    gpu_memory_total_gb: number;
    gpu_utilization: number;
    gpu_memory_percent: number;
    gpu_temperature: number;
  };
  disk: {
    percent: number;
  };
  process: {
    memory_mb: number;
    cpu_percent: number;
  };
}

export interface RecentProject {
  name: string;
  configPath: string;
  openedAt: number;
}

export {};
