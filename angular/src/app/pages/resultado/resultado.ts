import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideChevronsUpDown, lucideSearch } from '@ng-icons/lucide';
import { BrnCommandImports } from '@spartan-ng/brain/command';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';

interface TrainingSession {
  id: string;
  name: string;
  label: string;
  value: string;
  model: string;
  date: string;
  epochs: number;
  mAP: number;
  precision: number;
  recall: number;
}

interface ExportFormat {
  label: string;
  value: string;
}

interface ClassMetric {
  class: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

@Component({
  selector: 'app-resultado',
  imports: [
    CommonModule,
    FormsModule,
    BrnCommandImports,
    HlmCommandImports,
    NgIcon,
    HlmIcon,
    HlmButton,
    BrnPopover,
    BrnPopoverTrigger,
    HlmPopoverContent,
    BrnPopoverContent,
  ],
  providers: [provideIcons({ lucideChevronsUpDown, lucideSearch, lucideCheck })],
  templateUrl: './resultado.html',
  styleUrl: './resultado.scss'
})
export class Resultado {
  selectedTraining = 'training1';
  activeTab = 'curves';
  exportFormat = 'pytorch';

  // Estados para combobox
  public currentTrainingSession = signal<TrainingSession | undefined>(undefined);
  public trainingComboboxState = signal<'closed' | 'open'>('closed');
  public currentExportFormat = signal<ExportFormat | undefined>(undefined);
  public exportFormatComboboxState = signal<'closed' | 'open'>('closed');

  trainingSessions: TrainingSession[] = [
    {
      id: 'training1',
      name: 'YOLO11n_2024-01-15',
      label: 'YOLO11n - 15 Ene 2024 (mAP: 0.871)',
      value: 'training1',
      model: 'YOLO11n',
      date: '2024-01-15',
      epochs: 50,
      mAP: 0.871,
      precision: 0.892,
      recall: 0.834
    },
    {
      id: 'training2',
      name: 'YOLO11s_2024-01-10',
      label: 'YOLO11s - 10 Ene 2024 (mAP: 0.924)',
      value: 'training2',
      model: 'YOLO11s',
      date: '2024-01-10',
      epochs: 100,
      mAP: 0.924,
      precision: 0.931,
      recall: 0.887
    },
    {
      id: 'training3',
      name: 'YOLO11m_2024-01-05',
      label: 'YOLO11m - 05 Ene 2024 (mAP: 0.896)',
      value: 'training3',
      model: 'YOLO11m',
      date: '2024-01-05',
      epochs: 75,
      mAP: 0.896,
      precision: 0.912,
      recall: 0.854
    }
  ];

  exportFormats: ExportFormat[] = [
    { label: 'PyTorch (.pt)', value: 'pytorch' },
    { label: 'ONNX (.onnx)', value: 'onnx' },
    { label: 'TensorFlow (.pb)', value: 'tensorflow' },
    { label: 'TensorRT (.trt)', value: 'tensorrt' },
    { label: 'CoreML (.mlmodel)', value: 'coreml' }
  ];

  constructor() {
    // Inicializar valores por defecto
    const defaultTraining = this.trainingSessions.find(t => t.value === this.selectedTraining);
    this.currentTrainingSession.set(defaultTraining);

    const defaultExportFormat = this.exportFormats.find(f => f.value === this.exportFormat);
    this.currentExportFormat.set(defaultExportFormat);
  }

  classMetrics: ClassMetric[] = [
    { class: 'persona', precision: 0.89, recall: 0.85, f1: 0.87, support: 145 },
    { class: 'vehiculo', precision: 0.92, recall: 0.88, f1: 0.90, support: 98 },
    { class: 'animal', precision: 0.78, recall: 0.82, f1: 0.80, support: 67 },
    { class: 'objeto', precision: 0.85, recall: 0.79, f1: 0.82, support: 134 }
  ];

  get currentTraining(): TrainingSession | undefined {
    return this.currentTrainingSession();
  }

  get f1Score(): number {
    if (!this.currentTraining) return 0;
    // F1-Score es la media armónica de precisión y recall, no la media aritmética
    const precision = this.currentTraining.precision;
    const recall = this.currentTraining.recall;
    return (2 * precision * recall) / (precision + recall);
  }

  setActiveTab(tab: string): void {
    this.activeTab = tab;
  }

  isTabActive(tab: string): boolean {
    return this.activeTab === tab;
  }

  getTabClasses(tab: string): string {
    const baseClasses = 'px-4 py-2 text-sm font-medium rounded-md transition-colors';
    const activeClasses = 'bg-blue-600 text-white';
    const inactiveClasses = 'text-gray-600 hover:text-gray-900 hover:bg-gray-100';

    return `${baseClasses} ${this.isTabActive(tab) ? activeClasses : inactiveClasses}`;
  }

  compareTrainings(): void {
    console.log('Comparar entrenamientos');
  }

  exportModel(): void {
    console.log('Exportar modelo en formato:', this.exportFormat);
  }

  generateReport(): void {
    console.log('Generar reporte');
  }

  // Metrics calculations
  get macroAvgPrecision(): number {
    const sum = this.classMetrics.reduce((acc, metric) => acc + metric.precision, 0);
    return sum / this.classMetrics.length;
  }

  get macroAvgRecall(): number {
    const sum = this.classMetrics.reduce((acc, metric) => acc + metric.recall, 0);
    return sum / this.classMetrics.length;
  }

  get macroAvgF1(): number {
    const sum = this.classMetrics.reduce((acc, metric) => acc + metric.f1, 0);
    return sum / this.classMetrics.length;
  }

  get weightedAvgF1(): number {
    const totalSupport = this.classMetrics.reduce((acc, metric) => acc + metric.support, 0);
    const weightedSum = this.classMetrics.reduce((acc, metric) =>
      acc + (metric.f1 * metric.support), 0);
    return weightedSum / totalSupport;
  }

  get totalImages(): number {
    return 1500;
  }

  get totalAnnotations(): number {
    return this.classMetrics.reduce((acc, metric) => acc + metric.support, 0);
  }

  get averagePerImage(): number {
    return this.totalAnnotations / this.totalImages;
  }

  // Métodos para combobox
  trainingComboboxStateChanged(state: 'open' | 'closed') {
    this.trainingComboboxState.set(state);
  }

  trainingCommandSelected(training: TrainingSession) {
    this.trainingComboboxState.set('closed');
    if (this.currentTrainingSession()?.value === training.value) {
      this.currentTrainingSession.set(undefined);
      this.selectedTraining = '';
    } else {
      this.currentTrainingSession.set(training);
      this.selectedTraining = training.value;
    }
  }

  exportFormatComboboxStateChanged(state: 'open' | 'closed') {
    this.exportFormatComboboxState.set(state);
  }

  exportFormatCommandSelected(format: ExportFormat) {
    this.exportFormatComboboxState.set('closed');
    if (this.currentExportFormat()?.value === format.value) {
      this.currentExportFormat.set(undefined);
      this.exportFormat = '';
    } else {
      this.currentExportFormat.set(format);
      this.exportFormat = format.value;
    }
  }
}
