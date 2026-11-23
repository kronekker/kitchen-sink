import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AppInfo } from '@shared/index';
import { ThemeSelectorComponent } from './core/components/theme-selector/theme-selector';
import { BackendService } from './core/services/backend.service';
import { EngineStatusService } from './core/services/engine-status.service';

@Component({
  selector: 'app-root',
  imports: [RouterModule, ThemeSelectorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  private readonly backendService = inject(BackendService);
  protected readonly engineStatus = inject(EngineStatusService);

  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly isSidebarOpen = signal(true);

  toggleSidebar(): void {
    this.isSidebarOpen.update((v) => !v);
  }

  ngOnInit(): void {
    this.fetchAppInfo();
    this.engineStatus.startPolling();
  }

  fetchAppInfo(): void {
    this.backendService.getAppInfo().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.appInfo.set(res.data);
        }
      },
      error: (err) => console.error('Failed to fetch application info:', err.message),
    });
  }
}
