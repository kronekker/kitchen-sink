import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  signal,
  computed,
  effect,
  inject,
} from '@angular/core';
import {
  ChatMessage,
  ChatMetrics,
  ChatSession,
  InferenceParams,
  SystemPromptPreset,
} from '@shared/index';
import { BackendService } from '../../core/services/backend.service';
import { EndpointStatusService } from '../../core/services/endpoint-status.service';
import { MarkdownPipe } from '../../core/pipes/markdown.pipe';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [MarkdownPipe],
  templateUrl: './chat.html',
  styleUrl: './chat.css',
})
export class Chat implements OnInit {
  private readonly backendService = inject(BackendService);
  protected readonly endpointStatusService = inject(EndpointStatusService);

  @ViewChild('transcriptContainer') transcriptContainer?: ElementRef<HTMLDivElement>;

  // Sessions & messages
  protected readonly sessions = signal<ChatSession[]>([]);
  protected readonly activeSessionId = signal<number | null>(null);
  protected readonly messages = signal<ChatMessage[]>([]);

  // System prompt presets
  protected readonly promptPresets = signal<SystemPromptPreset[]>([]);
  protected readonly selectedPresetId = signal<string>('');

  // Active controls
  protected readonly selectedEndpointId = signal<number | null>(null);
  protected readonly selectedModelId = signal<string>('');
  protected readonly systemPrompt = signal<string>('');
  protected readonly temperature = signal<string>('0.7');
  protected readonly topP = signal<string>('0.95');
  protected readonly maxTokens = signal<string>('');

  // UI state
  protected readonly showSettings = signal<boolean>(false);
  protected readonly renderMarkdown = signal<boolean>(true);
  protected readonly composerText = signal<string>('');
  protected readonly isStreaming = signal<boolean>(false);
  protected readonly streamingContent = signal<string>('');
  protected readonly streamingReasoning = signal<string>('');
  protected readonly liveMetrics = signal<ChatMetrics | null>(null);
  protected readonly error = signal<string | null>(null);

  private activeAbortController: AbortController | null = null;
  private pendingContent = '';
  private pendingReasoning = '';
  private rafId: number | null = null;

  protected readonly selectedEndpointProbe = computed(() => {
    const id = this.selectedEndpointId();
    return this.endpointStatusService.statuses().find((e) => e.endpointId === id) ?? null;
  });

  protected readonly availableModels = computed(() => {
    return this.selectedEndpointProbe()?.models ?? [];
  });

  constructor() {
    // Auto-select first online endpoint (or first endpoint) when probes arrive
    effect(() => {
      const statuses = this.endpointStatusService.statuses();
      if (statuses.length === 0) return;

      if (this.selectedEndpointId() === null) {
        const preferred = statuses.find((s) => s.status === 'online') ?? statuses[0];
        this.selectedEndpointId.set(preferred.endpointId);
        if (preferred.activeModel && !this.selectedModelId()) {
          this.selectedModelId.set(preferred.activeModel);
        }
      } else {
        const current = statuses.find((s) => s.endpointId === this.selectedEndpointId());
        if (current?.activeModel && !this.selectedModelId()) {
          this.selectedModelId.set(current.activeModel);
        }
      }
    });
  }

  ngOnInit(): void {
    this.loadPromptPresets();
    this.loadSessions();
  }

  private loadPromptPresets(): void {
    this.backendService.getSystemPrompts().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.promptPresets.set(res.data);
          const def = res.data.find((p) => p.isDefault);
          if (def && !this.systemPrompt() && this.activeSessionId() === null) {
            this.systemPrompt.set(def.content);
            this.selectedPresetId.set(String(def.id));
          }
        }
      },
    });
  }

  private loadSessions(selectId?: number): void {
    this.backendService.getChatSessions().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.sessions.set(res.data);
          const targetId = selectId ?? this.activeSessionId() ?? res.data[0]?.id ?? null;
          if (targetId !== null) {
            this.selectSession(targetId);
          } else {
            this.createNewChat();
          }
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  createNewChat(): void {
    if (this.isStreaming()) this.stopGeneration();
    const def = this.promptPresets().find((p) => p.isDefault);
    this.backendService
      .createChatSession({
        endpointId: this.selectedEndpointId(),
        modelId: this.selectedModelId() || null,
        systemPrompt: def?.content ?? this.systemPrompt(),
        params: this.buildInferenceParams(),
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.sessions.update((prev) => [res.data!, ...prev]);
            this.applySessionState(res.data, []);
          }
        },
        error: (err: any) => this.error.set(err?.error?.error || err?.message),
      });
  }

  selectSession(id: number): void {
    if (this.isStreaming()) this.stopGeneration();
    this.backendService.getChatSession(id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.applySessionState(res.data.session, res.data.messages);
          this.scrollToBottom();
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  private applySessionState(session: ChatSession, msgs: ChatMessage[]): void {
    this.activeSessionId.set(session.id);
    this.messages.set(msgs);
    this.systemPrompt.set(session.systemPrompt ?? '');
    if (session.endpointId !== null) {
      this.selectedEndpointId.set(session.endpointId);
    }
    if (session.modelId) {
      this.selectedModelId.set(session.modelId);
    } else {
      const active = this.selectedEndpointProbe()?.activeModel;
      if (active) this.selectedModelId.set(active);
    }
    this.temperature.set(
      session.params?.temperature !== undefined ? String(session.params.temperature) : '0.7'
    );
    this.topP.set(session.params?.top_p !== undefined ? String(session.params.top_p) : '0.95');
    this.maxTokens.set(
      session.params?.max_tokens !== undefined ? String(session.params.max_tokens) : ''
    );

    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.metrics);
    this.liveMetrics.set(lastAssistant?.metrics ?? null);
    this.error.set(null);
  }

  deleteSession(id: number, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    this.backendService.deleteChatSession(id).subscribe({
      next: (res) => {
        if (res.success) {
          const remaining = this.sessions().filter((s) => s.id !== id);
          this.sessions.set(remaining);
          if (this.activeSessionId() === id) {
            if (remaining.length > 0) {
              this.selectSession(remaining[0].id);
            } else {
              this.activeSessionId.set(null);
              this.createNewChat();
            }
          }
        }
      },
    });
  }

  clearMessages(): void {
    const id = this.activeSessionId();
    if (id === null || this.messages().length === 0) return;
    if (!confirm('Clear all messages in this conversation?')) return;

    this.backendService.clearChatMessages(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.messages.set([]);
          this.liveMetrics.set(null);
        }
      },
    });
  }

  onEndpointChange(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    if (!Number.isInteger(id)) return;
    this.selectedEndpointId.set(id);
    const probe = this.endpointStatusService.statuses().find((s) => s.endpointId === id);
    if (probe?.activeModel) {
      this.selectedModelId.set(probe.activeModel);
    }
  }

  onModelSelectChange(event: Event): void {
    this.selectedModelId.set((event.target as HTMLSelectElement).value);
  }

  onPresetChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedPresetId.set(value);
    const preset = this.promptPresets().find((p) => String(p.id) === value);
    if (preset) {
      this.systemPrompt.set(preset.content);
    }
  }

  saveCurrentAsPreset(): void {
    const content = this.systemPrompt().trim();
    if (!content) {
      alert('Enter a system prompt first.');
      return;
    }
    const name = prompt('Name for this system prompt preset:');
    if (!name || !name.trim()) return;

    this.backendService.createSystemPrompt({ name: name.trim(), content }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.promptPresets.update((prev) => [...prev, res.data!]);
          this.selectedPresetId.set(String(res.data.id));
        }
      },
    });
  }

  deleteSelectedPreset(): void {
    const id = Number(this.selectedPresetId());
    if (!Number.isInteger(id) || id <= 0) return;
    const preset = this.promptPresets().find((p) => p.id === id);
    if (!preset || !confirm(`Delete system prompt preset "${preset.name}"?`)) return;

    this.backendService.deleteSystemPrompt(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.promptPresets.update((prev) => prev.filter((p) => p.id !== id));
          this.selectedPresetId.set('');
        }
      },
    });
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private buildInferenceParams(): InferenceParams {
    const params: InferenceParams = {};
    const t = parseFloat(this.temperature());
    if (Number.isFinite(t)) params.temperature = t;
    const tp = parseFloat(this.topP());
    if (Number.isFinite(tp)) params.top_p = tp;
    const mt = parseInt(this.maxTokens(), 10);
    if (Number.isInteger(mt) && mt > 0) params.max_tokens = mt;
    return params;
  }

  async sendMessage(): Promise<void> {
    if (this.isStreaming()) return;

    const text = this.composerText().trim();
    const sessionId = this.activeSessionId();
    const endpointId = this.selectedEndpointId();
    const modelId = this.selectedModelId().trim();

    if (!text) return;
    if (sessionId === null || endpointId === null) {
      this.error.set('Select an active session and endpoint first.');
      return;
    }
    if (!modelId) {
      this.error.set('Select or enter a model ID before sending.');
      return;
    }

    this.error.set(null);
    this.composerText.set('');
    this.isStreaming.set(true);
    this.streamingContent.set('');
    this.streamingReasoning.set('');
    this.liveMetrics.set(null);

    const endpointName = this.selectedEndpointProbe()?.name ?? 'Endpoint';
    const tempUserMsg: ChatMessage = {
      id: -Date.now(),
      sessionId,
      role: 'user',
      content: text,
      reasoningContent: null,
      modelId,
      endpointName,
      metrics: null,
      createdAt: new Date().toISOString(),
    };
    this.messages.update((prev) => [...prev, tempUserMsg]);
    this.scrollToBottom();

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      await this.backendService.streamChat(
        {
          sessionId,
          endpointId,
          modelId,
          userMessage: text,
          systemPrompt: this.systemPrompt(),
          params: this.buildInferenceParams(),
        },
        (event) => {
          if (event.type === 'start') {
            this.messages.update((prev) =>
              prev.map((m) => (m.id === tempUserMsg.id ? { ...m, id: event.userMessageId } : m))
            );
          } else if (event.type === 'delta') {
            if (event.content) {
              this.pendingContent += event.content;
            }
            if (event.reasoning) {
              this.pendingReasoning += event.reasoning;
            }
            this.scheduleStreamFlush();
          } else if (event.type === 'metrics') {
            this.liveMetrics.set(event.metrics);
          } else if (event.type === 'done') {
            this.flushStreamNow();
            this.messages.update((prev) => [...prev, event.assistantMessage]);
            this.streamingContent.set('');
            this.streamingReasoning.set('');
            this.refreshSessionListOnly();
            this.scrollToBottom();
          } else if (event.type === 'error') {
            this.error.set(event.error);
          }
        },
        abortController.signal
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        this.error.set(err?.message || 'Streaming request failed.');
      }
    } finally {
      this.isStreaming.set(false);
      this.activeAbortController = null;
      // If aborted mid-stream before 'done' arrived, reload persisted messages from DB
      if (this.streamingContent() || this.streamingReasoning()) {
        this.streamingContent.set('');
        this.streamingReasoning.set('');
        this.selectSession(sessionId);
      }
    }
  }

  stopGeneration(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  private refreshSessionListOnly(): void {
    this.backendService.getChatSessions().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.sessions.set(res.data);
        }
      },
    });
  }

  private scheduleStreamFlush(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flushStreamNow();
    });
  }

  private flushStreamNow(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.pendingContent) {
      const chunk = this.pendingContent;
      this.pendingContent = '';
      this.streamingContent.update((c) => c + chunk);
    }
    if (this.pendingReasoning) {
      const chunk = this.pendingReasoning;
      this.pendingReasoning = '';
      this.streamingReasoning.update((r) => r + chunk);
    }
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.transcriptContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }, 0);
  }
}
