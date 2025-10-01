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
  copy_image_paths(paths: string[]): Promise<{ ok: boolean; copied: number; images: string[]; elapsed?: number }>;
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

export {};
