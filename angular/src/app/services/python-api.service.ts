import { Injectable, NgZone, effect, signal } from '@angular/core';
import type { PyWebviewApi } from '../types/pywebview.d';

// Estrategia de detección de inyección:
// 1. Revisa window.pywebview?.api inmediatamente
// 2. Escucha el evento nativo 'pywebviewready'
// 3. Hace polling ligero (backoff) hasta timeout configurable
// 4. Si se pierde la referencia (null), intenta reenganchar

interface RetryOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  timeoutMs?: number;
}

@Injectable({ providedIn: 'root' })
export class PythonApiService {
  private readonly retryOpts: Required<RetryOptions> = {
    initialDelayMs: 150,
    maxDelayMs: 2000,
    factor: 1.6,
    timeoutMs: 15000
  };

  // Signals de estado
  readonly apiReady = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);
  readonly attempts = signal<number>(0);
  readonly connectedAt = signal<number | null>(null);

  // Acceso directo memorizado
  private apiRef: PyWebviewApi | null = null;
  private destroyed = false;

  constructor(private zone: NgZone) {
    this.initializeDetection();

    // Efecto debug (puedes quitarlo luego)
    effect(() => {
      if (this.apiReady()) {
        console.info('[PythonApiService] API lista.');
      }
    });
  }

  /** Obtiene la API tipada si está disponible */
  api(): PyWebviewApi | null {
    return this.apiRef;
  }

  /** Llamada segura que lanza si no hay API */
  requireApi(): PyWebviewApi {
    if (!this.apiRef) {
      throw new Error('API de pywebview no disponible');
    }
    return this.apiRef;
  }

  private initializeDetection() {
    // 1. Chequeo inmediato
    this.tryBind();

    // 2. Evento nativo estándar
    window.addEventListener('pywebviewready', () => {
      this.zone.run(() => {
        this.tryBind();
      });
    });

    // 3. Commence polling/backoff
    this.zone.runOutsideAngular(() => {
      this.pollForApi();
    });
  }

  private tryBind(): boolean {
    const candidate = (window as any).pywebview?.api as PyWebviewApi | undefined;
    if (candidate) {
      this.apiRef = candidate;
      this.apiReady.set(true);
      this.connectedAt.set(Date.now());
      this.lastError.set(null);
      return true;
    }
    return false;
  }

  private async pollForApi() {
    const start = Date.now();
    let delay = this.retryOpts.initialDelayMs;

    while (!this.destroyed && !this.apiReady()) {
      if (this.tryBind()) return; // éxito

      if (Date.now() - start > this.retryOpts.timeoutMs) {
        this.zone.run(() => {
          this.lastError.set('Timeout esperando pywebview.api');
        });
        return;
      }

      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(this.retryOpts.maxDelayMs, Math.round(delay * this.retryOpts.factor));
      this.zone.run(() => this.attempts.update(a => a + 1));
    }
  }

  /** Ejecutar un método de la API con manejo de errores y verificación */
  async call<K extends keyof PyWebviewApi>(method: K, ...args: Parameters<PyWebviewApi[K]>): Promise<Awaited<ReturnType<PyWebviewApi[K]>>> {
    const api = this.requireApi();
    try {
      // @ts-ignore - index access dinámico
      return await api[method](...(args as any));
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.lastError.set(msg);
      throw err;
    }
  }

  /** Forzar reintento manual */
  retryBinding() {
    if (this.apiReady()) return;
    this.attempts.set(0);
    this.lastError.set(null);
    this.pollForApi();
  }

  /** Verificar salud básica (latencia de una llamada simple) */
  async ping(name = 'ping'): Promise<number> {
    const t0 = performance.now();
    await this.call('hello', name as any);
    return performance.now() - t0;
  }

  /** Simular pérdida y reenganche (para pruebas) */
  simulateDetach() {
    (this as any).apiRef = null;
    this.apiReady.set(false);
    this.retryBinding();
  }

  ngOnDestroy() {
    this.destroyed = true;
  }
}
