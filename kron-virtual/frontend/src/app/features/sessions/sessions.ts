import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  signal,
  computed,
  inject,
} from '@angular/core';
import {
  Character,
  ChatMetrics,
  GeneratedImage,
  InferenceParams,
  Persona,
  PromptPreview,
  RpMessage,
  RpSession,
  RpSessionSummary,
  RpStyle,
} from '@shared/index';
import { BackendService } from '../../core/services/backend.service';
import { EngineStatusService } from '../../core/services/engine-status.service';
import { MarkdownPipe } from '../../core/pipes/markdown.pipe';

@Component({
  selector: 'app-sessions',
  standalone: true,
  imports: [MarkdownPipe],
  templateUrl: './sessions.html',
  styleUrl: './sessions.css',
})
export class Sessions implements OnInit {
  private readonly backendService = inject(BackendService);
  protected readonly engineStatus = inject(EngineStatusService);

  @ViewChild('transcriptContainer') transcriptContainer?: ElementRef<HTMLDivElement>;

  // Lists
  protected readonly sessions = signal<RpSessionSummary[]>([]);
  protected readonly characters = signal<Character[]>([]);
  protected readonly personas = signal<Persona[]>([]);
  protected readonly styles = signal<RpStyle[]>([]);

  // Active session detail
  protected readonly activeSession = signal<RpSession | null>(null);
  protected readonly activeCharacter = signal<Character | null>(null);
  protected readonly activePersona = signal<Persona | null>(null);
  protected readonly messages = signal<RpMessage[]>([]);

  // New session modal/card state
  protected readonly showNewSessionForm = signal<boolean>(false);
  protected readonly newSessionCharId = signal<number | null>(null);
  protected readonly newSessionPersonaId = signal<number | null>(null);
  protected readonly newSessionStyleId = signal<number | null>(null);
  protected readonly newSessionTitle = signal<string>('');

  protected readonly selectedNewStyle = computed(() => {
    const id = this.newSessionStyleId();
    return id !== null ? this.styles().find((s) => s.id === id) ?? null : null;
  });

  // RP Controls (editable per session)
  protected readonly directives = signal<string>('');
  protected readonly scenarioOverride = signal<string>('');
  protected readonly sceneNote = signal<string>('');
  protected readonly cadenceReminder = signal<string>('');
  protected readonly suggestPrompt = signal<string>('');
  protected readonly temperature = signal<string>('0.85');
  protected readonly topP = signal<string>('0.95');
  protected readonly minP = signal<string>('0.05');
  protected readonly maxTokens = signal<string>('');
  protected readonly dryMultiplier = signal<string>('');

  // Drawers & UI state
  protected readonly showControls = signal<boolean>(false);
  protected readonly showPromptPreview = signal<boolean>(false);
  protected readonly promptPreview = signal<PromptPreview | null>(null);
  protected readonly isLoadingPreview = signal<boolean>(false);
  protected readonly renderMarkdown = signal<boolean>(true);
  protected readonly controlsSavedMsg = signal<string | null>(null);

  // Message inline edit state
  protected readonly editingMessageId = signal<number | null>(null);
  protected readonly editingMessageText = signal<string>('');

  // Streaming state (ported from local-llm-workbench)
  protected readonly composerText = signal<string>('');
  protected readonly isStreaming = signal<boolean>(false);
  protected readonly isSuggesting = signal<boolean>(false);
  protected readonly streamingContent = signal<string>('');
  protected readonly streamingReasoning = signal<string>('');
  protected readonly streamingSystemPrompt = signal<string | null>(null);
  protected readonly liveMetrics = signal<ChatMetrics | null>(null);
  protected readonly error = signal<string | null>(null);

  // System prompt modal state
  protected readonly modalSystemPrompt = signal<{ title: string; content: string } | null>(null);
  protected readonly copiedModalPrompt = signal<boolean>(false);

  // Session & Combined Image Generation state
  protected readonly sessionImages = signal<GeneratedImage[]>([]);
  protected readonly charAvatars = signal<GeneratedImage[]>([]);
  protected readonly personaAvatars = signal<GeneratedImage[]>([]);
  protected readonly showSceneImageModal = signal<boolean>(false);
  protected readonly sceneImageMode = signal<'session' | 'combined'>('session');
  protected readonly selectedCharAvatarId = signal<number | null>(null);
  protected readonly selectedPersonaAvatarId = signal<number | null>(null);
  protected readonly sceneImagePrompt = signal<string>('');
  protected readonly sceneImageSize = signal<string>('1024x1024');
  protected readonly isDraftingScenePrompt = signal<boolean>(false);
  protected readonly isGeneratingSceneImage = signal<boolean>(false);
  protected readonly sceneImageError = signal<string | null>(null);
  protected readonly lightboxImage = signal<GeneratedImage | null>(null);

  private activeAbortController: AbortController | null = null;
  private suggestAbortController: AbortController | null = null;
  private pendingContent = '';
  private pendingReasoning = '';
  private pendingSuggest = '';
  private rafId: number | null = null;
  private suggestRafId: number | null = null;

  protected readonly lastAssistantMessageId = computed(() => {
    const msgs = this.messages();
    const last = msgs[msgs.length - 1];
    return last && last.role === 'assistant' ? last.id : null;
  });

  protected readonly activePairingTooltip = computed(() => {
    const ch = this.activeCharacter();
    const pe = this.activePersona();
    return this.formatPairingTooltip(ch?.name, ch?.tagline, pe?.name, pe?.tagline);
  });

  protected formatPairingTooltip(
    charName?: string,
    charTagline?: string,
    personaName?: string,
    personaTagline?: string
  ): string {
    const lines: string[] = [];
    if (charName) {
      lines.push(`${charName}${charTagline ? ' — ' + charTagline : ''}`);
    }
    if (personaName) {
      lines.push(`${personaName}${personaTagline ? ' — ' + personaTagline : ''}`);
    }
    return lines.join('\n');
  }

  ngOnInit(): void {
    this.loadReferenceData();
    this.loadSessions();
  }

  private loadReferenceData(): void {
    this.backendService.getCharacters().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.characters.set(res.data);
          if (this.newSessionCharId() === null && res.data.length > 0) {
            this.newSessionCharId.set(res.data[0].id);
          }
        }
      },
    });

    this.backendService.getPersonas().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.personas.set(res.data);
          if (this.newSessionPersonaId() === null && res.data.length > 0) {
            const def = res.data.find((p) => p.isDefault) ?? res.data[0];
            this.newSessionPersonaId.set(def.id);
          }
        }
      },
    });

    this.backendService.getStyles().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.styles.set(res.data);
          if (this.newSessionStyleId() === null && res.data.length > 0) {
            const def = res.data.find((s) => s.isDefault) ?? res.data[0];
            this.newSessionStyleId.set(def.id);
          }
        }
      },
    });
  }

  private loadSessions(selectId?: number): void {
    this.backendService.getSessions().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.sessions.set(res.data);
          const targetId = selectId ?? this.activeSession()?.id ?? res.data[0]?.id ?? null;
          if (targetId !== null) {
            this.selectSession(targetId);
          } else {
            this.showNewSessionForm.set(true);
          }
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  openNewSessionForm(): void {
    this.loadReferenceData();
    this.newSessionTitle.set('');
    this.showNewSessionForm.set(true);
    this.error.set(null);
  }

  cancelNewSession(): void {
    this.showNewSessionForm.set(false);
  }

  createSession(): void {
    const characterId = this.newSessionCharId();
    const personaId = this.newSessionPersonaId();
    if (!characterId || !personaId) {
      this.error.set('Select both a Character and a Persona to start a session.');
      return;
    }

    if (this.isStreaming()) this.stopGeneration();
    this.error.set(null);

    this.backendService
      .createSession({
        characterId,
        personaId,
        styleId: this.newSessionStyleId(),
        title: this.newSessionTitle().trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.showNewSessionForm.set(false);
            this.applySessionDetail(res.data.session, res.data.character, res.data.persona, res.data.messages);
            this.refreshSessionListOnly();
            this.scrollToBottom();
          } else {
            this.error.set(res.error || 'Failed to create session.');
          }
        },
        error: (err: any) => this.error.set(err?.error?.error || err?.message || 'Failed to create session.'),
      });
  }

  selectSession(id: number): void {
    if (this.isStreaming()) this.stopGeneration();
    this.editingMessageId.set(null);
    this.backendService.getSession(id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.showNewSessionForm.set(false);
          this.applySessionDetail(
            res.data.session,
            res.data.character,
            res.data.persona,
            res.data.messages
          );
          if (this.showPromptPreview()) {
            this.loadPromptPreview();
          }
          this.scrollToBottom();
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  private applySessionDetail(
    session: RpSession,
    character: Character,
    persona: Persona,
    msgs: RpMessage[]
  ): void {
    this.activeSession.set(session);
    this.activeCharacter.set(character);
    this.activePersona.set(persona);
    this.messages.set(msgs);

    this.directives.set(session.directives ?? '');
    this.scenarioOverride.set(session.scenarioOverride ?? '');
    this.sceneNote.set(session.sceneNote ?? '');
    this.cadenceReminder.set(session.cadenceReminder ?? '');
    this.suggestPrompt.set(session.suggestPrompt ?? '');

    this.temperature.set(
      session.params?.temperature !== undefined ? String(session.params.temperature) : '0.85'
    );
    this.topP.set(session.params?.top_p !== undefined ? String(session.params.top_p) : '0.95');
    this.minP.set(session.params?.min_p !== undefined ? String(session.params.min_p) : '0.05');
    this.maxTokens.set(
      session.params?.max_tokens !== undefined ? String(session.params.max_tokens) : ''
    );
    this.dryMultiplier.set(
      session.params?.dry_multiplier !== undefined ? String(session.params.dry_multiplier) : ''
    );

    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.metrics);
    this.liveMetrics.set(lastAssistant?.metrics ?? null);
    this.error.set(null);
    this.controlsSavedMsg.set(null);
    this.loadSessionImages(session.id, character.id, persona.id);
  }

  private loadSessionImages(sessionId: number, characterId: number, personaId: number): void {
    this.backendService.getImages({ entityType: 'session', entityId: sessionId }).subscribe({
      next: (res) => {
        if (res.success && res.data) this.sessionImages.set(res.data);
      },
    });
    this.backendService.getImages({ entityType: 'character', entityId: characterId }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.charAvatars.set(res.data);
          const def = res.data.find((a) => a.isDefault) ?? res.data[0] ?? null;
          this.selectedCharAvatarId.set(def?.id ?? null);
        }
      },
    });
    this.backendService.getImages({ entityType: 'persona', entityId: personaId }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.personaAvatars.set(res.data);
          const def = res.data.find((a) => a.isDefault) ?? res.data[0] ?? null;
          this.selectedPersonaAvatarId.set(def?.id ?? null);
        }
      },
    });
  }

  openSceneImageModal(mode: 'session' | 'combined' = 'session'): void {
    this.sceneImageMode.set(mode);
    this.sceneImageError.set(null);
    this.showSceneImageModal.set(true);
    this.draftSceneImagePrompt(false);
  }

  switchSceneImageMode(mode: 'session' | 'combined'): void {
    this.sceneImageMode.set(mode);
    this.sceneImageError.set(null);
    this.draftSceneImagePrompt(false);
  }

  draftSceneImagePrompt(useLlm: boolean): void {
    const session = this.activeSession();
    if (!session) return;
    this.isDraftingScenePrompt.set(true);
    this.sceneImageError.set(null);

    const templateKey = this.sceneImageMode() === 'combined' ? 'combined_scene' : 'session_scene';
    this.backendService
      .draftImagePrompt({
        templateKey,
        sessionId: session.id,
        useLlm,
      })
      .subscribe({
        next: (res) => {
          this.isDraftingScenePrompt.set(false);
          if (res.success && res.data) {
            this.sceneImagePrompt.set(res.data.prompt);
          }
        },
        error: (err: any) => {
          this.isDraftingScenePrompt.set(false);
          this.sceneImageError.set(err?.error?.error || err?.message || 'Failed to draft prompt.');
        },
      });
  }

  generateSceneImage(): void {
    const session = this.activeSession();
    const prompt = this.sceneImagePrompt().trim();
    if (!session || !prompt) return;

    const mode = this.sceneImageMode();
    const refIds: number[] = [];
    const charAvId = this.selectedCharAvatarId();
    const personaAvId = this.selectedPersonaAvatarId();

    if (charAvId !== null) refIds.push(charAvId);
    if (mode === 'combined' && personaAvId !== null) refIds.push(personaAvId);

    const [wStr, hStr] = this.sceneImageSize().split('x');
    const width = Number(wStr) || 1024;
    const height = Number(hStr) || 1024;

    this.isGeneratingSceneImage.set(true);
    this.sceneImageError.set(null);

    this.backendService
      .generateImage({
        kind: mode === 'combined' ? 'combined' : 'session',
        entityType: 'session',
        entityId: session.id,
        prompt,
        referenceImageIds: refIds,
        width,
        height,
        outputFormat: 'jpeg',
      })
      .subscribe({
        next: (res) => {
          this.isGeneratingSceneImage.set(false);
          if (res.success && res.data) {
            this.sessionImages.update((prev) => [res.data!, ...prev]);
            this.showSceneImageModal.set(false);
            this.lightboxImage.set(res.data);
          } else {
            this.sceneImageError.set(res.error || 'Image generation failed.');
          }
        },
        error: (err: any) => {
          this.isGeneratingSceneImage.set(false);
          this.sceneImageError.set(err?.error?.error || err?.message || 'Image generation failed.');
        },
      });
  }

  deleteSessionImage(img: GeneratedImage, event?: Event): void {
    event?.stopPropagation();
    if (!confirm('Delete this scene image?')) return;
    this.backendService.deleteImage(img.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.sessionImages.update((prev) => prev.filter((x) => x.id !== img.id));
          if (this.lightboxImage()?.id === img.id) this.lightboxImage.set(null);
        }
      },
    });
  }

  deleteSession(id: number, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this roleplay session and its transcript?')) return;

    this.backendService.deleteSession(id).subscribe({
      next: (res) => {
        if (res.success) {
          const remaining = this.sessions().filter((s) => s.id !== id);
          this.sessions.set(remaining);
          if (this.activeSession()?.id === id) {
            if (remaining.length > 0) {
              this.selectSession(remaining[0].id);
            } else {
              this.activeSession.set(null);
              this.activeCharacter.set(null);
              this.activePersona.set(null);
              this.messages.set([]);
              this.showNewSessionForm.set(true);
            }
          }
        }
      },
    });
  }

  resetTranscript(): void {
    const session = this.activeSession();
    if (!session) return;
    if (!confirm('Reset this session back to the opening greeting?')) return;

    this.backendService.resetSessionMessages(session.id, true).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.messages.set(res.data);
          this.liveMetrics.set(null);
          this.refreshSessionListOnly();
          if (this.showPromptPreview()) this.loadPromptPreview();
        }
      },
    });
  }

  onNewStyleChange(value: string): void {
    const parsed = Number(value);
    this.newSessionStyleId.set(value && Number.isInteger(parsed) ? parsed : null);
  }

  applyStyleToActiveSession(value: string): void {
    const id = Number(value);
    if (!Number.isInteger(id)) return;
    const style = this.styles().find((s) => s.id === id);
    if (!style) return;

    this.directives.set(style.directives);
    this.scenarioOverride.set(style.scenarioOverride);
    this.sceneNote.set(style.sceneNote);
    this.cadenceReminder.set(style.cadenceReminder);
    this.suggestPrompt.set(style.suggestPrompt);
    this.temperature.set(
      style.params?.temperature !== undefined ? String(style.params.temperature) : '0.85'
    );
    this.topP.set(style.params?.top_p !== undefined ? String(style.params.top_p) : '0.95');
    this.minP.set(style.params?.min_p !== undefined ? String(style.params.min_p) : '0.05');
    this.maxTokens.set(
      style.params?.max_tokens !== undefined ? String(style.params.max_tokens) : ''
    );
    this.dryMultiplier.set(
      style.params?.dry_multiplier !== undefined ? String(style.params.dry_multiplier) : ''
    );
    this.controlsSavedMsg.set(
      `Loaded "${style.name}" — click Save Controls or send a turn to apply.`
    );
  }

  saveSessionControls(): void {
    const session = this.activeSession();
    if (!session) return;

    this.controlsSavedMsg.set(null);
    this.backendService
      .updateSession(session.id, {
        directives: this.directives(),
        scenarioOverride: this.scenarioOverride(),
        sceneNote: this.sceneNote(),
        cadenceReminder: this.cadenceReminder(),
        suggestPrompt: this.suggestPrompt(),
        params: this.buildInferenceParams(),
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.activeSession.set(res.data);
            this.controlsSavedMsg.set('Saved session controls.');
            if (this.showPromptPreview()) this.loadPromptPreview();
          }
        },
        error: (err: any) => this.error.set(err?.error?.error || err?.message),
      });
  }

  togglePromptPreview(): void {
    const next = !this.showPromptPreview();
    this.showPromptPreview.set(next);
    if (next) {
      this.loadPromptPreview();
    }
  }

  loadPromptPreview(): void {
    const session = this.activeSession();
    if (!session) return;
    this.isLoadingPreview.set(true);
    this.backendService.getPromptPreview(session.id).subscribe({
      next: (res) => {
        this.isLoadingPreview.set(false);
        if (res.success && res.data) {
          this.promptPreview.set(res.data);
        }
      },
      error: () => {
        this.isLoadingPreview.set(false);
      },
    });
  }

  // Message editing (prune toxic tics / tweak prose)
  startEditMessage(msg: RpMessage): void {
    this.editingMessageId.set(msg.id);
    this.editingMessageText.set(msg.content);
  }

  cancelEditMessage(): void {
    this.editingMessageId.set(null);
    this.editingMessageText.set('');
  }

  saveEditMessage(id: number): void {
    const content = this.editingMessageText().trim();
    if (!content) return;

    this.backendService.updateMessage(id, { content }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.messages.update((prev) => prev.map((m) => (m.id === id ? res.data! : m)));
          this.editingMessageId.set(null);
          if (this.showPromptPreview()) this.loadPromptPreview();
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message),
    });
  }

  deleteMessage(id: number, truncateAfter = false): void {
    const msg = truncateAfter
      ? 'Rewind conversation by deleting this message and all messages after it?'
      : 'Delete this message?';
    if (!confirm(msg)) return;

    this.backendService.deleteMessage(id, truncateAfter).subscribe({
      next: (res) => {
        if (res.success) {
          if (truncateAfter) {
            this.messages.update((prev) => {
              const idx = prev.findIndex((m) => m.id === id);
              return idx === -1 ? prev : prev.slice(0, idx);
            });
          } else {
            this.messages.update((prev) => prev.filter((m) => m.id !== id));
          }
          this.refreshSessionListOnly();
          if (this.showPromptPreview()) this.loadPromptPreview();
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
    const mp = parseFloat(this.minP());
    if (Number.isFinite(mp)) params.min_p = mp;
    const mt = parseInt(this.maxTokens(), 10);
    if (Number.isInteger(mt) && mt > 0) params.max_tokens = mt;
    const dry = parseFloat(this.dryMultiplier());
    if (Number.isFinite(dry) && dry > 0) {
      params.dry_multiplier = dry;
      params.dry_base = 1.75;
      params.dry_allowed_length = 2;
    }
    return params;
  }

  async sendMessage(): Promise<void> {
    if (this.isStreaming()) return;
    const session = this.activeSession();
    const text = this.composerText().trim();
    if (!session || !text) return;

    this.composerText.set('');
    const tempUserMsg: RpMessage = {
      id: -Date.now(),
      sessionId: session.id,
      role: 'user',
      content: text,
      reasoningContent: null,
      systemPrompt: null,
      modelId: this.engineStatus.engine()?.activeModel ?? null,
      engineLabel: this.engineStatus.engine()?.label ?? null,
      metrics: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.messages.update((prev) => [...prev, tempUserMsg]);
    this.scrollToBottom();

    await this.runStream({
      sessionId: session.id,
      userMessage: text,
      tempUserMsgId: tempUserMsg.id,
    });
  }

  async regenerateLast(): Promise<void> {
    if (this.isStreaming()) return;
    const session = this.activeSession();
    if (!session) return;

    const lastId = this.lastAssistantMessageId();
    if (lastId !== null) {
      this.messages.update((prev) => prev.filter((m) => m.id !== lastId));
    }

    await this.runStream({
      sessionId: session.id,
      regenerate: true,
    });
  }

  private async runStream(opts: {
    sessionId: number;
    userMessage?: string;
    regenerate?: boolean;
    tempUserMsgId?: number;
  }): Promise<void> {
    this.error.set(null);
    this.isStreaming.set(true);
    this.streamingContent.set('');
    this.streamingReasoning.set('');
    this.streamingSystemPrompt.set(null);
    this.liveMetrics.set(null);

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      await this.backendService.streamChat(
        {
          sessionId: opts.sessionId,
          userMessage: opts.userMessage,
          regenerate: opts.regenerate,
          directives: this.directives(),
          scenarioOverride: this.scenarioOverride(),
          sceneNote: this.sceneNote(),
          cadenceReminder: this.cadenceReminder(),
          params: this.buildInferenceParams(),
        },
        (event) => {
          if (event.type === 'start') {
            this.streamingSystemPrompt.set(event.systemPrompt || null);
            if (opts.tempUserMsgId !== undefined && event.userMessageId !== null) {
              this.messages.update((prev) =>
                prev.map((m) =>
                  m.id === opts.tempUserMsgId ? { ...m, id: event.userMessageId! } : m
                )
              );
            }
          } else if (event.type === 'delta') {
            if (event.content) this.pendingContent += event.content;
            if (event.reasoning) this.pendingReasoning += event.reasoning;
            this.scheduleStreamFlush();
          } else if (event.type === 'metrics') {
            this.liveMetrics.set(event.metrics);
          } else if (event.type === 'done') {
            this.flushStreamNow();
            this.messages.update((prev) => [...prev, event.assistantMessage]);
            this.streamingContent.set('');
            this.streamingReasoning.set('');
            this.streamingSystemPrompt.set(null);
            this.refreshSessionListOnly();
            if (this.showPromptPreview()) this.loadPromptPreview();
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
      this.streamingSystemPrompt.set(null);
      this.activeAbortController = null;
      if (this.streamingContent() || this.streamingReasoning()) {
        this.streamingContent.set('');
        this.streamingReasoning.set('');
        this.selectSession(opts.sessionId);
      }
    }
  }

  stopGeneration(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  async suggestReply(): Promise<void> {
    if (this.isStreaming() || this.isSuggesting()) return;
    const session = this.activeSession();
    if (!session) return;

    const existingHint = this.composerText().trim();
    this.error.set(null);
    this.isSuggesting.set(true);
    this.pendingSuggest = '';
    this.composerText.set('');

    const abortController = new AbortController();
    this.suggestAbortController = abortController;
    let receivedAny = false;

    try {
      await this.backendService.streamSuggestReply(
        {
          sessionId: session.id,
          hint: existingHint || undefined,
          suggestPrompt: this.suggestPrompt(),
          sceneNote: this.sceneNote(),
          cadenceReminder: this.cadenceReminder(),
          params: this.buildInferenceParams(),
        },
        (event) => {
          if (event.type === 'delta') {
            receivedAny = true;
            this.pendingSuggest += event.content;
            this.scheduleSuggestFlush();
          } else if (event.type === 'done') {
            this.flushSuggestNow();
            if (event.content) {
              this.composerText.set(event.content);
            }
          } else if (event.type === 'error') {
            this.error.set(event.error);
          }
        },
        abortController.signal
      );
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        this.error.set(err?.message || 'Failed to suggest reply.');
      }
    } finally {
      this.flushSuggestNow();
      if (!receivedAny && existingHint) {
        this.composerText.set(existingHint);
      }
      this.isSuggesting.set(false);
      this.suggestAbortController = null;
    }
  }

  stopSuggest(): void {
    if (this.suggestAbortController) {
      this.suggestAbortController.abort();
      this.suggestAbortController = null;
    }
  }

  private scheduleSuggestFlush(): void {
    if (this.suggestRafId !== null) return;
    this.suggestRafId = requestAnimationFrame(() => {
      this.suggestRafId = null;
      this.flushSuggestNow();
    });
  }

  private flushSuggestNow(): void {
    if (this.suggestRafId !== null) {
      cancelAnimationFrame(this.suggestRafId);
      this.suggestRafId = null;
    }
    if (this.pendingSuggest) {
      const chunk = this.pendingSuggest;
      this.pendingSuggest = '';
      this.composerText.update((c) => c + chunk);
    }
  }

  openSystemPromptModal(content: string, title = 'Assembled System Prompt'): void {
    this.copiedModalPrompt.set(false);
    this.modalSystemPrompt.set({ title, content });
  }

  closeSystemPromptModal(): void {
    this.modalSystemPrompt.set(null);
    this.copiedModalPrompt.set(false);
  }

  copyModalSystemPrompt(): void {
    const prompt = this.modalSystemPrompt();
    if (!prompt) return;
    navigator.clipboard?.writeText(prompt.content).then(() => {
      this.copiedModalPrompt.set(true);
      setTimeout(() => this.copiedModalPrompt.set(false), 1800);
    });
  }

  private refreshSessionListOnly(): void {
    this.backendService.getSessions().subscribe({
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
