import { Component, signal, inject, ViewChild, ElementRef, EventEmitter, Output, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';

import { BrnSelectImports } from '@spartan-ng/brain/select';
import { HlmSelectImports } from '@spartan-ng/helm/select';

import { MenuService } from '../../services/menu.service';

export interface NewProjectPayload {
  name: string;
  path: string; // carpeta base (se creará dentro si no existe)
  classes: string[];
  task: 'detect' | 'segment';
  meta: {
    description: string;
    model: string;
    segmentationType: string;
    imageSize: number;
    splits: { train: number; val: number; test: number };
    augmentation: boolean;
  };
}

@Component({
  selector: 'app-create-project-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    BrnDialogImports,
    HlmDialogImports,
    HlmLabelImports,
    HlmInputImports,
    HlmButtonImports,
    BrnSelectImports,
    HlmSelectImports,
  ],
  templateUrl: './create-project-dialog.component.html',
  styleUrl: './create-project-dialog.component.scss'
})
export class CreateProjectDialogComponent implements AfterViewInit {
  @Output() createProject = new EventEmitter<NewProjectPayload>();

  private menu = inject(MenuService);
  @ViewChild('hiddenTrigger', { static: false }) hiddenTrigger!: ElementRef<HTMLButtonElement>;

  isCreating = signal(false);
  selectedPath = '';

  // Form igual al diseño original
  projectForm = {
    name: '',
    description: '',
    yoloModel: 'yolo11n' as const,
    segmentationType: 'instance' as const,
    task: 'detect' as 'detect' | 'segment',
    imageSize: 640,
    trainSplit: 70,
    validSplit: 20,
    testSplit: 10,
    classNames: ['clase1'],
    dataAugmentation: false
  };

  ngAfterViewInit() {
    // noop
  }

  constructor(private cdr: ChangeDetectorRef) {
    this.menu.on('nuevo-proyecto', () => this.openDialog());
  }

  openDialog() {
    if (this.hiddenTrigger) {
      this.hiddenTrigger.nativeElement.click();
    }
  }

  async selectProjectPath() {
    // Prevenir re-entrada si el usuario cliquea varias veces rápido
    // @ts-ignore
    if (this._selectingPath) return;
    // @ts-ignore
    this._selectingPath = true;
    try {
      // 1. pywebview (nativo)
      try {
        // @ts-ignore
        if (window.pywebview?.api?.select_directory) {
          // @ts-ignore
            const res = await window.pywebview.api.select_directory('Seleccionar carpeta de proyecto');
          if (res && res.ok && res.path) {
            this.selectedPath = res.path;
            this.cdr.detectChanges();
            return; // éxito -> no seguir
          }
          // Si res.ok === false (cancelado) detenemos la cadena para NO abrir otros diálogos
          if (res && !res.ok && !res.error) {
            return; // cancelación silenciosa
          }
          // Si hubo error (res.error) continuamos a fallback
        }
      } catch (e) {
        console.warn('Fallo select_directory pywebview:', e);
        // continuamos a siguientes opciones solo si no es cancelación controlada
      }

      // 2. File System Access API
      try {
        // @ts-ignore
        if (window.showDirectoryPicker) {
          // @ts-ignore
          const dirHandle = await window.showDirectoryPicker();
          this.selectedPath = `fs:${dirHandle.name}`;
          this.cdr.detectChanges();
          return; // éxito
        }
      } catch (err: any) {
        // Cancelación explícita -> NO continuar a siguiente fallback para no encadenar diálogos
        if (err && (err.name === 'AbortError' || err.name === 'NotFoundError')) {
          return; // usuario canceló
        }
        console.warn('showDirectoryPicker error (no cancel):', err);
        // Sólo en caso de error real (función no existe / no soportada) seguimos al fallback input
      }

      // 3. Fallback input only si llegamos aquí porque NO hubo cancelación, sino falta de soporte / error real
      await this.selectPathViaInput();
    } finally {
      // @ts-ignore
      this._selectingPath = false;
    }
  }

  private selectPathViaInput(): Promise<void> {
    return new Promise(resolve => {
      const input = document.createElement('input');
      (input as any).webkitdirectory = true;
      input.type = 'file';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = (input.files || [] as any) as FileList;
        if (files.length > 0) {
          // Tomamos el path relativo del primer archivo para inferir carpeta raíz
            // @ts-ignore - webkitRelativePath
          const rel = (files[0] as any).webkitRelativePath as string;
          if (rel) {
            const parts = rel.split('/');
            if (parts.length > 1) {
              this.selectedPath = parts[0];
            }
          }
        }
        document.body.removeChild(input);
        resolve();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  addClass() {
    this.projectForm.classNames.push(`clase${this.projectForm.classNames.length + 1}`);
  }

  removeClass(index: number) {
    if (this.projectForm.classNames.length > 1) {
      this.projectForm.classNames.splice(index, 1);
    }
  }

  updateSplits() {
    this.projectForm.testSplit = 100 - this.projectForm.trainSplit - this.projectForm.validSplit;
  }

  canCreateProject(): boolean {
    return !!(
      this.projectForm.name.trim() &&
      this.selectedPath &&
      this.projectForm.classNames.length > 0 &&
      this.projectForm.classNames.every(name => name.trim()) &&
      this.projectForm.trainSplit + this.projectForm.validSplit + this.projectForm.testSplit === 100 &&
      !this.isCreating()
    );
  }

  emitAndCreate(ctx: any) {
    if (!this.canCreateProject()) return;
    this.isCreating.set(true);
    const payload: NewProjectPayload = {
      name: this.projectForm.name.trim(),
      path: this.selectedPath.trim(),
      classes: this.projectForm.classNames.filter(n => n.trim()),
      task: this.projectForm.task,
      meta: {
        description: this.projectForm.description.trim(),
        model: this.projectForm.yoloModel,
        segmentationType: this.projectForm.segmentationType,
        imageSize: this.projectForm.imageSize,
        splits: {
          train: this.projectForm.trainSplit,
          val: this.projectForm.validSplit,
          test: this.projectForm.testSplit
        },
        augmentation: this.projectForm.dataAugmentation
      }
    };
    this.createProject.emit(payload);
    ctx.close();
    this.resetForm();
    this.isCreating.set(false);
  }

  private resetForm() {
    this.projectForm = {
      name: '',
      description: '',
      yoloModel: 'yolo11n',
      segmentationType: 'instance',
      task: 'detect',
      imageSize: 640,
      trainSplit: 70,
      validSplit: 20,
      testSplit: 10,
      classNames: ['clase1'],
      dataAugmentation: false
    };
    this.selectedPath = '';
  }
}
