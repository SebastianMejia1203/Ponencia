import { Component, inject, computed } from '@angular/core';
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
import { RecentProjectsService } from '../../services/recent-projects.service';

@Component({
  selector: 'app-menubar',
  imports: [BrnMenuTrigger, HlmMenu, HlmSubMenu, HlmMenuItem, HlmMenuItemSubIndicator, HlmMenuLabel, HlmMenuShortcut, HlmMenuSeparator, HlmButtonImports],
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
  private recentsSvc = inject(RecentProjectsService);

  readonly recentProjects = computed(() => this.recentsSvc.items());

  dispatch(action: string, payload?: any) { this.menu.dispatch(action as any, payload); }
  openRecent(p: { configPath: string }) { this.dispatch('abrir-reciente', p); }
  clearRecents() { this.dispatch('limpiar-recientes'); }
}
