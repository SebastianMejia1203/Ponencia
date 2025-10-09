import { Component, inject, computed, viewChild } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import {
  lucideFilePlus, lucideFolderOpen, lucideSave, lucideImage, lucideSettings, lucideFileOutput,
  lucideUndo, lucideRedo, lucideScissors, lucideCopy, lucideClipboardPaste, lucideSearch, lucideZoomIn, lucideZoomOut,
  lucideSquare, lucideMonitor, lucideMinimize2, lucideMaximize2, lucideBookOpen, lucideLayers,
  lucideGitBranch, lucideTrash2, lucideCpu, lucideDownload, lucideUpload, lucideExternalLink, lucideRefreshCcw,
  lucidePanelTop, lucideCommand
} from '@ng-icons/lucide';
import { BrnMenuTrigger } from '@spartan-ng/brain/menu';
import { HlmMenu, HlmSubMenu, HlmMenuItem, HlmMenuItemSubIndicator, HlmMenuLabel, HlmMenuShortcut, HlmMenuSeparator, HlmMenuGroup } from '@spartan-ng/helm/menu';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { NgIf, NgFor } from '@angular/common';
import { MenuService } from '../../services/menu.service';
import { ProjectService } from '../../services/project.service';
import { RecentProjectsService } from '../../services/recent-projects.service';
import { AboutDialogComponent } from '../about-dialog/about-dialog.component';

@Component({
  selector: 'app-menubar',
  imports: [BrnMenuTrigger, HlmMenu, HlmSubMenu, HlmMenuItem, HlmMenuItemSubIndicator, HlmMenuLabel, HlmMenuShortcut, HlmMenuSeparator, HlmButtonImports, AboutDialogComponent],
  providers: [provideIcons({
    lucideFilePlus, lucideFolderOpen, lucideSave, lucideImage, lucideSettings, lucideFileOutput,
    lucideUndo, lucideRedo, lucideScissors, lucideCopy, lucideClipboardPaste, lucideSearch, lucideZoomIn, lucideZoomOut,
    lucideSquare, lucideMonitor, lucideMinimize2, lucideMaximize2, lucideBookOpen, lucideLayers,
    lucideGitBranch, lucideTrash2, lucideCpu, lucideDownload, lucideUpload, lucideExternalLink, lucideRefreshCcw,
    lucidePanelTop, lucideCommand
  })],
  templateUrl: './menubar.html',
  styleUrl: './menubar.scss'
})
export class Menubar {
  private menu = inject(MenuService);
  private projectSvc = inject(ProjectService);
  private recentsSvc = inject(RecentProjectsService);

  readonly recentProjects = computed(() => this.recentsSvc.items());
  readonly aboutDialogRef = viewChild(AboutDialogComponent);
  readonly hasProject = computed(() => this.projectSvc.isOpen());

  dispatch(action: string, payload?: any) { this.menu.dispatch(action as any, payload); }
  openRecent(p: { configPath: string }) { this.dispatch('abrir-reciente', p); }
  clearRecents() { this.dispatch('limpiar-recientes'); }

  openAboutDialog() {
    this.aboutDialogRef()?.open();
  }
}
