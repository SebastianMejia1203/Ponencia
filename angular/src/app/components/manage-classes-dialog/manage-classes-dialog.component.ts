import { Component, signal, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BrnDialogContent, BrnDialogTrigger } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialog, HlmDialogContent, HlmDialogDescription, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { ProjectService } from '../../services/project.service';
import { PythonApiService } from '../../services/python-api.service';

interface ClassData { label: string; value: string; color: string; }

@Component({
  selector: 'app-manage-classes-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    BrnDialogTrigger, BrnDialogContent,
    HlmDialog, HlmDialogContent, HlmDialogHeader, HlmDialogFooter, HlmDialogTitle, HlmDialogDescription,
    HlmInput, HlmButton
  ],
  template: `
  <hlm-dialog #dialogRef>
    <button #hiddenTrigger brnDialogTrigger hlmBtn variant="default" style="display:none;opacity:0;pointer-events:none;" [disabled]="true">Hidden</button>
    <hlm-dialog-content class="sm:max-w-[600px] max-h-[90vh] flex flex-col" *brnDialogContent="let ctx">
      <hlm-dialog-header class="flex-shrink-0">
        <h3 hlmDialogTitle>Gestionar Clases</h3>
        <p hlmDialogDescription>Administre las clases de su proyecto.</p>
      </hlm-dialog-header>
      <div class="flex-1 flex flex-col py-4 min-h-0">
        <div class="flex-1 overflow-y-auto min-h-0 mb-4">
          <div class="space-y-3 pr-2">
            @for (classData of classes(); track classData.value; let i = $index) {
              <div class="flex items-center gap-3 p-3 border rounded-lg">
                <div class="w-4 h-4 rounded-full flex-shrink-0" [class]="classData.color"></div>
                <div class="flex-1 min-w-0">
                  @if (editingIndex() === i) {
                    <input hlmInput [(ngModel)]="editingName" placeholder="Nombre de la clase" class="w-full" (keyup.enter)="saveEdit(i)" (keyup.escape)="cancelEdit()" />
                  } @else {
                    <span class="text-sm font-medium truncate">{{ classData.label }}</span>
                  }
                </div>
                <div class="flex gap-1 flex-shrink-0">
                  @if (editingIndex() === i) {
                    <button hlmBtn variant="outline" size="sm" (click)="saveEdit(i)" class="h-8 w-8 p-0">✓</button>
                    <button hlmBtn variant="outline" size="sm" (click)="cancelEdit()" class="h-8 w-8 p-0">✕</button>
                  } @else {
                    <button hlmBtn variant="outline" size="sm" (click)="startEdit(i, classData.label)" class="h-8 w-8 p-0">✏️</button>
                    <button hlmBtn variant="outline" size="sm" (click)="removeClass(i)" [disabled]="classes().length <= 1" class="h-8 w-8 p-0 text-red-600 hover:text-red-700">🗑️</button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
        <div class="flex-shrink-0 p-3 border-2 border-dashed border-gray-300 rounded-lg mb-4">
          @if (addingNew()) {
            <div class="flex gap-2">
              <input hlmInput [(ngModel)]="newClassName" placeholder="Nombre de la nueva clase" class="flex-1" (keyup.enter)="addNewClass()" (keyup.escape)="cancelAdd()" />
              <button hlmBtn variant="default" size="sm" (click)="addNewClass()" [disabled]="!newClassName.trim()">Agregar</button>
              <button hlmBtn variant="outline" size="sm" (click)="cancelAdd()">Cancelar</button>
            </div>
          } @else {
            <button hlmBtn variant="ghost" class="w-full border-dashed" (click)="startAdd()">+ Agregar Nueva Clase</button>
          }
        </div>
        <div class="flex-shrink-0 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 w-[400px]">
          <p><strong>Total de clases:</strong> {{ classes().length }}</p>
          <p class="text-xs mt-1">Los colores se asignan automáticamente.</p>
        </div>
      </div>
      <hlm-dialog-footer class="flex gap-2 flex-shrink-0 border-t pt-4">
        <button hlmBtn variant="outline" (click)="cancelChanges(ctx)" type="button">Cancelar</button>
        <button hlmBtn variant="default" (click)="saveChanges(ctx)" type="submit">Guardar</button>
      </hlm-dialog-footer>
    </hlm-dialog-content>
  </hlm-dialog>
  `
})
export class ManageClassesDialogComponent {
  private projectService = inject(ProjectService);
  private pythonApi = inject(PythonApiService);

  classes = signal<ClassData[]>([]);
  editingIndex = signal<number>(-1);
  addingNew = signal<boolean>(false);
  editingName = '';
  newClassName = '';

  private availableColors = [
    'bg-red-500','bg-blue-500','bg-green-500','bg-yellow-500','bg-purple-500','bg-pink-500','bg-indigo-500','bg-gray-500','bg-orange-500','bg-teal-500','bg-cyan-500','bg-lime-500'
  ];
  private isDialogOpen = false;

  @ViewChild('hiddenTrigger',{static:false}) hiddenTrigger!: any;

  openDialog(){
    if(this.isDialogOpen) return;
    this.loadCurrentClasses();
    if(this.hiddenTrigger?.nativeElement){
      this.isDialogOpen = true;
      this.hiddenTrigger.nativeElement.disabled = false;
      setTimeout(()=>{
        try { this.hiddenTrigger.nativeElement.click(); } catch {}
        this.hiddenTrigger.nativeElement.disabled = true;
        this.setupDialogWatchdog();
      },50);
    }
  }
  private setupDialogWatchdog(){
    const watchdog = setInterval(()=>{
      const backdrop = document.querySelector('[data-brn-dialog-overlay]');
      if(!backdrop && this.isDialogOpen){
        this.onDialogClose();
        clearInterval(watchdog);
      }
    },500);
    setTimeout(()=>clearInterval(watchdog),30000);
  }
  onDialogClose(){
    this.isDialogOpen = false;
    this.editingIndex.set(-1); this.addingNew.set(false);
    this.editingName=''; this.newClassName='';
  }
  private loadCurrentClasses(){
    const project: any = this.projectService.project();
    const classNames: string[] = project?.classes || [];
    if(classNames.length){
      this.classes.set(this.generateClassesFromProject(classNames));
    } else {
      this.classes.set([{label:'Clase 1', value:'clase-1', color:'bg-red-500'}]);
    }
  }
  private generateClassesFromProject(classNames: string[]): ClassData[]{
    return classNames.map((name,i)=>({
      label: name.charAt(0).toUpperCase()+name.slice(1),
      value: name.toLowerCase().replace(/\s+/g,'-'),
      color: this.availableColors[i % this.availableColors.length]
    }));
  }
  startEdit(i:number,name:string){ this.editingIndex.set(i); this.editingName=name; }
  saveEdit(i:number){
    if(this.editingName.trim()){
      const cls=[...this.classes()];
      cls[i]={...cls[i],label:this.editingName.trim(),value:this.editingName.trim().toLowerCase().replace(/\s+/g,'-')};
      this.classes.set(cls);
    }
    this.cancelEdit();
  }
  cancelEdit(){ this.editingIndex.set(-1); this.editingName=''; }

  async removeClass(i:number){
    if(this.classes().length <= 1) return;

    const classToRemove = this.classes()[i];

    // Verificar si hay anotaciones con esta clase
    const hasAnnotations = await this.checkClassHasAnnotations(classToRemove.label);

    if (hasAnnotations) {
      alert(`No se puede eliminar la clase "${classToRemove.label}" porque tiene anotaciones asociadas.\n\nPrimero debe eliminar todas las anotaciones de esta clase.`);
      return;
    }

    const cls=[...this.classes()];
    cls.splice(i,1);
    this.classes.set(cls);
  }

  private async checkClassHasAnnotations(className: string): Promise<boolean> {
    try {
      if (!this.pythonApi.apiReady()) return false;

      const images = this.projectService.images();

      for (const imageName of images) {
        const annotations = await this.pythonApi.call('load_annotations', imageName);
        if (annotations && Array.isArray(annotations)) {
          const hasClass = annotations.some((ann: any) => ann.className === className);
          if (hasClass) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      console.error('Error verificando anotaciones:', error);
      return false; // En caso de error, permitir eliminación
    }
  }

  startAdd(){ this.addingNew.set(true); this.newClassName=''; }
  addNewClass(){ if(this.newClassName.trim()){ const cls=[...this.classes()]; cls.push({label:this.newClassName.trim(),value:this.newClassName.trim().toLowerCase().replace(/\s+/g,'-'), color:this.availableColors[cls.length % this.availableColors.length]}); this.classes.set(cls); this.cancelAdd(); } }
  cancelAdd(){ this.addingNew.set(false); this.newClassName=''; }
  async saveChanges(ctx:any){
    try {
      const classNames = this.classes().map(c=>c.label);

      // Guardar proyecto en backend con las clases actualizadas
      // El backend actualizará data.yaml y project_config.json
      const result = await this.projectService.save(classNames);

      if (result?.ok) {
        console.log('✅ Clases actualizadas y proyecto guardado correctamente');
        console.log('📋 Clases guardadas:', classNames);

        // Emitir evento para que otros componentes se actualicen
        // Usamos las clases del resultado del backend (source of truth)
        const savedClasses = result.project?.classes || classNames;
        document.dispatchEvent(new CustomEvent('classes-updated',{detail:{classNames: savedClasses}}));

        this.onDialogClose();
        ctx.close();
      } else {
        const errorMsg = result?.error || 'Error desconocido';
        console.error('❌ Error guardando clases:', errorMsg);
        alert('Error al guardar las clases:\n' + errorMsg);
      }
    } catch (error) {
      console.error('❌ Error guardando clases:', error);
      alert('Error al guardar las clases:\n' + (error instanceof Error ? error.message : String(error)));
    }
  }
  cancelChanges(ctx:any){ this.onDialogClose(); ctx.close(); }
}
