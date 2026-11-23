import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AppInfo } from '@shared/index';
import { ThemeSelectorComponent } from './core/components/theme-selector/theme-selector';
import { BackendService } from './core/services/backend.service';
import { EndpointStatusService } from './core/services/endpoint-status.service';

@Component({
  selector: 'app-root',
  imports: [RouterModule, ThemeSelectorComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private readonly backendService = inject(BackendService);
  protected readonly endpointStatusService = inject(EndpointStatusService);

  protected readonly appInfo = signal<AppInfo | null>(null);
  protected readonly isSidebarOpen = signal(true);

  private pollHandle: ReturnType<typeof setInterval> | null = null;

  toggleSidebar() {
    this.isSidebarOpen.update((v) => !v);
  }

  ngOnInit() {
    this.fetchAppInfo();
    this.endpointStatusService.refresh();
    this.pollHandle = setInterval(() => {
      this.endpointStatusService.refresh();
    }, 15000);
  }

  ngOnDestroy() {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  fetchAppInfo() {
    this.backendService.getAppInfo().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.appInfo.set(res.data);
        }
      },
      error: (err) => console.error('Failed to fetch application info:', err.message),
    });
  }

  refreshEndpoints() {
    this.endpointStatusService.refresh();
  }
}
