import { Component, viewChild } from '@angular/core';
import { BrnDialog, BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';

@Component({
  selector: 'app-about-dialog',
  imports: [BrnDialogImports, HlmDialogImports, HlmButtonImports],
  template: `
    <hlm-dialog #dialogRef>
      <hlm-dialog-content class="sm:max-w-[500px]" *brnDialogContent="let ctx">
        <hlm-dialog-header>
          <div>
            <h3 hlmDialogTitle class="text-2xl">Yolo Tools App</h3>
            <p class="text-sm text-muted-foreground">Herramienta de Anotación y Entrenamiento</p>
          </div>
        </hlm-dialog-header>

        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium">Versión:</span>
              <span class="text-sm text-muted-foreground">1.0.0</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium">Framework:</span>
              <span class="text-sm text-muted-foreground">Angular 18 + Python 3.11</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm font-medium">Licencia:</span>
              <span class="text-sm text-muted-foreground">MIT</span>
            </div>
          </div>

          <div class="border-t pt-4">
            <p class="text-sm text-muted-foreground leading-relaxed">
              Aplicación para anotación de imágenes y entrenamiento de modelos YOLO.
              Desarrollada para facilitar el proceso de creación de datasets y entrenamiento de modelos de detección de objetos.
            </p>
          </div>

          <div class="border-t pt-4 space-y-2">
            <h4 class="text-sm font-medium">Contacto</h4>
            <div class="flex flex-col gap-2">
              <button hlmBtn variant="outline" size="sm" class="justify-start gap-2">
                <span>📦 GitHub Repository</span>
              </button>
              <button hlmBtn variant="outline" size="sm" class="justify-start gap-2">
                <span>✉️ Contactar Soporte</span>
              </button>
            </div>
          </div>

          <div class="border-t pt-4">
            <p class="text-xs text-center text-muted-foreground">
              © 2025 Yolo Tools App. Todos los derechos reservados.
            </p>
          </div>
        </div>

        <hlm-dialog-footer>
          <button hlmBtn brnDialogClose variant="outline">Cerrar</button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
  styles: [`
    :host {
      display: contents;
    }
  `]
})
export class AboutDialogComponent {
  readonly dialogRef = viewChild(BrnDialog);

  open() {
    this.dialogRef()?.open();
  }
}
