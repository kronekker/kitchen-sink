import { Injectable, inject, signal } from '@angular/core';
import { ActiveEngineStatus } from '@shared/index';
import { BackendService } from './backend.service';

@Injectable({
  providedIn: 'root',
})
export class EngineStatusService {
  private readonly backendService = inject(BackendService);

  readonly engine = signal<ActiveEngineStatus | null>(null);
  readonly isChecking = signal<boolean>(false);

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  startPolling(intervalMs = 15000): void {
    this.refresh(true);
    if (this.pollTimer !== null) return;
    this.pollTimer = setInterval(() => this.refresh(false), intervalMs);
  }

  refresh(force = true): void {
    this.isChecking.set(true);
    this.backendService.getEngineStatus(force).subscribe({
      next: (res) => {
        this.isChecking.set(false);
        if (res.success && res.data) {
          this.engine.set(res.data);
        }
      },
      error: () => {
        this.isChecking.set(false);
      },
    });
  }
}
