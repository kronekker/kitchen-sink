import { Injectable, inject, signal } from '@angular/core';
import { EndpointProbeResult } from '@shared/index';
import { BackendService } from './backend.service';

@Injectable({
  providedIn: 'root',
})
export class EndpointStatusService {
  private readonly backendService = inject(BackendService);

  readonly statuses = signal<EndpointProbeResult[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  refresh(): void {
    this.isLoading.set(true);
    this.backendService.getAllEndpointStatuses().subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.data) {
          this.statuses.set(res.data);
          this.error.set(null);
        } else {
          this.error.set(res.error || 'Failed to probe endpoints.');
        }
      },
      error: (err: any) => {
        this.isLoading.set(false);
        this.error.set(err?.error?.error || err?.message || 'Failed to reach backend.');
      },
    });
  }
}
