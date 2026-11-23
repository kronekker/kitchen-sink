import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  signal,
  inject,
} from '@angular/core';
import {
  ContainerInfo,
  IsMtpMode,
  LlamaScriptConfig,
  ModelPreset,
  RestartPolicy,
  SystemdServiceStatus,
  TransformContainerCommandResult,
} from '@shared/index';
import { BackendService } from '../../core/services/backend.service';
import { EndpointStatusService } from '../../core/services/endpoint-status.service';

interface LogEntry {
  id: number;
  line: string;
  stream: 'stdout' | 'stderr';
}

const MAX_LOG_LINES = 600;

@Component({
  selector: 'app-servers',
  standalone: true,
  templateUrl: './servers.html',
  styleUrl: './servers.css',
})
export class Servers implements OnInit, OnDestroy {
  private readonly backendService = inject(BackendService);
  private readonly endpointStatusService = inject(EndpointStatusService);

  @ViewChild('logTerminal') logTerminal?: ElementRef<HTMLDivElement>;
  @ViewChild('containerLogTerminal') containerLogTerminal?: ElementRef<HTMLDivElement>;

  // Service status
  protected readonly serviceStatus = signal<SystemdServiceStatus | null>(null);
  protected readonly isControlling = signal<boolean>(false);

  // Script config form
  protected readonly scriptPath = signal<string>('');
  protected readonly modelName = signal<string>('');
  protected readonly modelQuant = signal<string>('');
  protected readonly modelCtx = signal<string>('');
  protected readonly isMtp = signal<IsMtpMode>('unknown');
  protected readonly isSavingConfig = signal<boolean>(false);

  // Presets
  protected readonly presets = signal<ModelPreset[]>([]);

  // Feedback
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  // Live systemd logs
  protected readonly logLines = signal<LogEntry[]>([]);
  protected readonly isStreamingLogs = signal<boolean>(false);
  protected readonly autoScrollLogs = signal<boolean>(true);

  // Port 8081 ai-toolbox-cockpit containers (read-only)
  protected readonly cockpitContainers = signal<ContainerInfo[]>([]);
  protected readonly selectedContainerId = signal<string | null>(null);
  protected readonly isLoadingContainers = signal<boolean>(false);
  protected readonly containerLogLines = signal<LogEntry[]>([]);
  protected readonly isStreamingContainerLogs = signal<boolean>(false);
  protected readonly autoScrollContainerLogs = signal<boolean>(true);
  protected readonly copiedCommandId = signal<string | null>(null);

  // Persistent Container Launcher (from ai-toolbox-cockpit copy command)
  protected readonly rawDockerCommand = signal<string>('');
  protected readonly restartPolicy = signal<RestartPolicy>('unless-stopped');
  protected readonly containerNameOverride = signal<string>('');
  protected readonly replaceExisting = signal<boolean>(true);
  protected readonly transformPreview = signal<TransformContainerCommandResult | null>(null);
  protected readonly launcherError = signal<string | null>(null);
  protected readonly launcherSuccess = signal<string | null>(null);
  protected readonly isLaunchingContainer = signal<boolean>(false);
  protected readonly copiedPreview = signal<boolean>(false);

  private logEventSource: EventSource | null = null;
  private containerLogEventSource: EventSource | null = null;
  private nextLogId = 1;

  ngOnInit(): void {
    this.refreshServiceStatus();
    this.loadScriptConfig();
    this.loadPresets();
    this.startLogStream();
    this.refreshContainers();
  }

  ngOnDestroy(): void {
    this.stopLogStream();
    this.stopContainerLogStream();
  }

  refreshServiceStatus(): void {
    this.backendService.getLlamaServiceStatus().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.serviceStatus.set(res.data);
        } else {
          this.error.set(res.error || 'Failed to read systemd status.');
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  controlService(action: 'start' | 'stop' | 'restart'): void {
    this.error.set(null);
    this.notice.set(null);
    this.isControlling.set(true);

    this.backendService.controlLlamaService(action).subscribe({
      next: (res) => {
        this.isControlling.set(false);
        if (res.success && res.data) {
          this.serviceStatus.set(res.data);
          this.notice.set(`Service ${action} completed (${res.data.activeState}/${res.data.subState}).`);
          setTimeout(() => this.endpointStatusService.refresh(), 1200);
        } else {
          this.error.set(res.error || `Failed to ${action} service.`);
        }
      },
      error: (err: any) => {
        this.isControlling.set(false);
        this.error.set(err?.error?.error || err?.message);
      },
    });
  }

  loadScriptConfig(): void {
    this.backendService.getLlamaScriptConfig().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.applyConfigToForm(res.data);
        } else {
          this.error.set(res.error || 'Failed to read start-llama-cpp.sh.');
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  private applyConfigToForm(cfg: LlamaScriptConfig): void {
    this.scriptPath.set(cfg.scriptPath);
    this.modelName.set(cfg.modelName);
    this.modelQuant.set(cfg.modelQuant);
    this.modelCtx.set(String(cfg.modelCtx));
    this.isMtp.set(cfg.isMtp);
  }

  saveConfig(restart: boolean): void {
    this.error.set(null);
    this.notice.set(null);
    this.isSavingConfig.set(true);

    this.backendService
      .updateLlamaScriptConfig(
        {
          modelName: this.modelName().trim(),
          modelQuant: this.modelQuant().trim(),
          modelCtx: Number(this.modelCtx()),
          isMtp: this.isMtp(),
        },
        restart
      )
      .subscribe({
        next: (res) => {
          this.isSavingConfig.set(false);
          if (res.success && res.data) {
            this.applyConfigToForm(res.data.config);
            if (res.data.serviceStatus) {
              this.serviceStatus.set(res.data.serviceStatus);
              setTimeout(() => this.endpointStatusService.refresh(), 1200);
            }
            this.notice.set(
              restart
                ? 'Saved start-llama-cpp.sh and restarted kron-llama-server.service.'
                : 'Saved start-llama-cpp.sh (backup written to .bak).'
            );
          } else {
            this.error.set(res.error || 'Failed to update configuration.');
          }
        },
        error: (err: any) => {
          this.isSavingConfig.set(false);
          this.error.set(err?.error?.error || err?.message);
        },
      });
  }

  loadPresets(): void {
    this.backendService.getModelPresets().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.presets.set(res.data);
        }
      },
    });
  }

  saveCurrentAsPreset(): void {
    const name = prompt('Preset name (e.g. "Dark Scarlett 26B Q8"):');
    if (!name || !name.trim()) return;
    const notes = prompt('Optional notes (leave blank to skip):') ?? '';

    this.error.set(null);
    this.notice.set(null);

    this.backendService
      .createModelPreset({
        name: name.trim(),
        modelName: this.modelName().trim(),
        modelQuant: this.modelQuant().trim(),
        modelCtx: Number(this.modelCtx()),
        isMtp: this.isMtp(),
        notes: notes.trim() || null,
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.presets.update((prev) => [res.data!, ...prev]);
            this.notice.set(`Saved preset "${res.data.name}".`);
          } else {
            this.error.set(res.error || 'Failed to save preset.');
          }
        },
        error: (err: any) => this.error.set(err?.error?.error || err?.message),
      });
  }

  applyPreset(preset: ModelPreset, restart: boolean): void {
    this.error.set(null);
    this.notice.set(null);
    this.isSavingConfig.set(true);

    this.backendService.applyModelPreset(preset.id, restart).subscribe({
      next: (res) => {
        this.isSavingConfig.set(false);
        if (res.success && res.data) {
          this.applyConfigToForm(res.data.config);
          if (res.data.serviceStatus) {
            this.serviceStatus.set(res.data.serviceStatus);
            setTimeout(() => this.endpointStatusService.refresh(), 1200);
          }
          this.notice.set(
            restart
              ? `Loaded preset "${preset.name}" and restarted service.`
              : `Loaded preset "${preset.name}" into start-llama-cpp.sh.`
          );
        } else {
          this.error.set(res.error || 'Failed to apply preset.');
        }
      },
      error: (err: any) => {
        this.isSavingConfig.set(false);
        this.error.set(err?.error?.error || err?.message);
      },
    });
  }

  deletePreset(preset: ModelPreset): void {
    if (!confirm(`Delete model preset "${preset.name}"?`)) return;
    this.backendService.deleteModelPreset(preset.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.presets.update((prev) => prev.filter((p) => p.id !== preset.id));
        }
      },
    });
  }

  startLogStream(): void {
    this.stopLogStream();
    this.isStreamingLogs.set(true);
    this.logEventSource = this.backendService.connectLlamaLogs(
      120,
      (line, stream) => {
        this.logLines.update((prev) => {
          const next = [...prev, { id: this.nextLogId++, line, stream }];
          return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
        });
        if (this.autoScrollLogs()) {
          setTimeout(() => {
            const el = this.logTerminal?.nativeElement;
            if (el) el.scrollTop = el.scrollHeight;
          }, 0);
        }
      },
      () => {
        this.isStreamingLogs.set(false);
      }
    );
  }

  stopLogStream(): void {
    if (this.logEventSource) {
      this.logEventSource.close();
      this.logEventSource = null;
    }
    this.isStreamingLogs.set(false);
  }

  toggleLogStream(): void {
    if (this.isStreamingLogs()) {
      this.stopLogStream();
    } else {
      this.logLines.set([]);
      this.startLogStream();
    }
  }

  clearLogs(): void {
    this.logLines.set([]);
  }

  // Port 8081 Read-Only Container Inspector
  refreshContainers(): void {
    this.isLoadingContainers.set(true);
    this.backendService.getPort8081Containers().subscribe({
      next: (res) => {
        this.isLoadingContainers.set(false);
        if (res.success && res.data) {
          this.cockpitContainers.set(res.data);
          if (res.data.length > 0 && !this.selectedContainerId()) {
            this.selectContainerForLogs(res.data[0]);
          }
        }
      },
      error: () => {
        this.isLoadingContainers.set(false);
      },
    });
  }

  selectContainerForLogs(container: ContainerInfo): void {
    this.selectedContainerId.set(container.id);
    this.containerLogLines.set([]);
    this.startContainerLogStream(container);
  }

  startContainerLogStream(container: ContainerInfo): void {
    this.stopContainerLogStream();
    this.isStreamingContainerLogs.set(true);
    this.containerLogEventSource = this.backendService.connectContainerLogs(
      container.runtime,
      container.id,
      120,
      (line, stream) => {
        this.containerLogLines.update((prev) => {
          const next = [...prev, { id: this.nextLogId++, line, stream }];
          return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
        });
        if (this.autoScrollContainerLogs()) {
          setTimeout(() => {
            const el = this.containerLogTerminal?.nativeElement;
            if (el) el.scrollTop = el.scrollHeight;
          }, 0);
        }
      },
      () => {
        this.isStreamingContainerLogs.set(false);
      }
    );
  }

  stopContainerLogStream(): void {
    if (this.containerLogEventSource) {
      this.containerLogEventSource.close();
      this.containerLogEventSource = null;
    }
    this.isStreamingContainerLogs.set(false);
  }

  toggleContainerLogStream(): void {
    if (this.isStreamingContainerLogs()) {
      this.stopContainerLogStream();
    } else {
      const current = this.cockpitContainers().find((c) => c.id === this.selectedContainerId());
      if (current) {
        this.containerLogLines.set([]);
        this.startContainerLogStream(current);
      }
    }
  }

  clearContainerLogs(): void {
    this.containerLogLines.set([]);
  }

  copyCommand(container: ContainerInfo): void {
    if (!container.command) return;
    navigator.clipboard?.writeText(container.command).then(() => {
      this.copiedCommandId.set(container.id);
      setTimeout(() => {
        if (this.copiedCommandId() === container.id) {
          this.copiedCommandId.set(null);
        }
      }, 2000);
    });
  }

  previewPersistentCommand(): void {
    const raw = this.rawDockerCommand().trim();
    if (!raw) {
      this.launcherError.set('Paste a docker/podman run command from ai-toolbox-cockpit first.');
      this.transformPreview.set(null);
      return;
    }

    this.launcherError.set(null);
    this.launcherSuccess.set(null);

    this.backendService
      .transformContainerCommand({
        rawCommand: raw,
        restartPolicy: this.restartPolicy(),
        containerName: this.containerNameOverride().trim() || undefined,
        replaceExisting: this.replaceExisting(),
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.transformPreview.set(res.data);
          } else {
            this.transformPreview.set(null);
            this.launcherError.set(res.error || 'Failed to parse command.');
          }
        },
        error: (err: any) => {
          this.transformPreview.set(null);
          this.launcherError.set(err?.error?.error || err?.message || 'Failed to parse command.');
        },
      });
  }

  launchPersistent(): void {
    const raw = this.rawDockerCommand().trim();
    if (!raw) {
      this.launcherError.set('Paste a docker/podman run command first.');
      return;
    }

    this.launcherError.set(null);
    this.launcherSuccess.set(null);
    this.isLaunchingContainer.set(true);

    this.backendService
      .launchPersistentContainer({
        rawCommand: raw,
        restartPolicy: this.restartPolicy(),
        containerName: this.containerNameOverride().trim() || undefined,
        replaceExisting: this.replaceExisting(),
      })
      .subscribe({
        next: (res) => {
          this.isLaunchingContainer.set(false);
          if (res.success && res.data) {
            const nameLabel = res.data.containerName ? ` (${res.data.containerName})` : '';
            this.launcherSuccess.set(
              `Persistent container started${nameLabel}: ${res.data.containerId.slice(0, 12)}`
            );
            this.selectedContainerId.set(null);
            this.refreshContainers();
            setTimeout(() => this.endpointStatusService.refresh(), 1500);
          } else {
            this.launcherError.set(res.error || 'Failed to launch container.');
          }
        },
        error: (err: any) => {
          this.isLaunchingContainer.set(false);
          this.launcherError.set(err?.error?.error || err?.message || 'Failed to launch container.');
        },
      });
  }

  copyPreviewCommand(): void {
    const cmd = this.transformPreview()?.formattedCommand;
    if (!cmd) return;
    navigator.clipboard?.writeText(cmd).then(() => {
      this.copiedPreview.set(true);
      setTimeout(() => this.copiedPreview.set(false), 2000);
    });
  }
}
