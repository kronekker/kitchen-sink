import { Component, signal, inject } from '@angular/core';
import { BackendService } from '../../core/services/backend.service';
import { EndpointStatusService } from '../../core/services/endpoint-status.service';

@Component({
  selector: 'app-starter',
  standalone: true,
  templateUrl: './starter.html',
  styles: [`
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-size: var(--text-sm);
      font-weight: 500;
      border: 1px solid var(--color-border);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .model-chip {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: var(--radius-sm);
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      font-family: monospace;
      font-size: 0.82rem;
      word-break: break-all;
    }
    .vb-delete-btn {
      background: none;
      border: none;
      padding: var(--space-1);
      color: var(--color-text-muted);
      opacity: 0.6;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }
    .vb-delete-btn:hover {
      color: var(--color-error);
      background-color: hsla(0, 85%, 60%, 0.1);
      opacity: 1;
    }
  `],
})
export class Starter {
  private readonly backendService = inject(BackendService);
  protected readonly endpointStatusService = inject(EndpointStatusService);

  protected readonly formError = signal<string | null>(null);
  protected readonly isSaving = signal<boolean>(false);

  refreshAll() {
    this.endpointStatusService.refresh();
  }

  addEndpoint(nameInput: HTMLInputElement, urlInput: HTMLInputElement, apiKeyInput: HTMLInputElement) {
    const name = nameInput.value.trim();
    const baseUrl = urlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    if (!name || !baseUrl) {
      this.formError.set('Please enter both a display name and a base URL.');
      return;
    }

    this.formError.set(null);
    this.isSaving.set(true);

    this.backendService
      .createEndpoint({ name, baseUrl, apiKey: apiKey || null })
      .subscribe({
        next: (res) => {
          this.isSaving.set(false);
          if (res.success) {
            nameInput.value = '';
            urlInput.value = '';
            apiKeyInput.value = '';
            this.endpointStatusService.refresh();
          } else {
            this.formError.set(res.error || 'Failed to add endpoint.');
          }
        },
        error: (err: any) => {
          this.isSaving.set(false);
          this.formError.set(err?.error?.error || err?.message || 'HTTP error adding endpoint.');
        },
      });
  }

  deleteEndpoint(id: number, name: string) {
    if (!confirm(`Remove custom endpoint "${name}"?`)) {
      return;
    }

    this.backendService.deleteEndpoint(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.endpointStatusService.refresh();
        } else {
          this.formError.set(res.error || 'Failed to delete endpoint.');
        }
      },
      error: (err: any) => {
        this.formError.set(err?.error?.error || err?.message || 'Failed to delete endpoint.');
      },
    });
  }
}
