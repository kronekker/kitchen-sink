import { Component, OnInit, signal, inject } from '@angular/core';
import { InferenceParams, RpStyle } from '@shared/index';
import { BackendService } from '../../core/services/backend.service';

@Component({
  selector: 'app-styles',
  standalone: true,
  templateUrl: './styles.html',
  styleUrl: './styles.css',
})
export class Styles implements OnInit {
  private readonly backendService = inject(BackendService);

  protected readonly styles = signal<RpStyle[]>([]);
  protected readonly editingId = signal<number | null>(null);
  protected readonly isSaving = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statusMsg = signal<string | null>(null);

  // Metadata
  protected readonly name = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly isDefault = signal<boolean>(false);

  // Index 0 (Static Cached Prefix)
  protected readonly directives = signal<string>('');
  protected readonly scenarioOverride = signal<string>('');

  // Depth 1 (Dynamic Per-Turn Steering — KV-Cache Safe)
  protected readonly sceneNote = signal<string>('');
  protected readonly cadenceReminder = signal<string>('');
  protected readonly suggestPrompt = signal<string>('');

  // Samplers (KV-Cache Safe)
  protected readonly temperature = signal<string>('0.85');
  protected readonly topP = signal<string>('0.95');
  protected readonly minP = signal<string>('0.05');
  protected readonly maxTokens = signal<string>('');
  protected readonly dryMultiplier = signal<string>('0.8');

  ngOnInit(): void {
    this.loadStyles(true);
  }

  loadStyles(selectFirst = false): void {
    this.backendService.getStyles().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.styles.set(res.data);
          if (selectFirst && this.editingId() === null && res.data.length > 0) {
            this.selectForEdit(res.data[0]);
          }
        }
      },
      error: (err: any) =>
        this.error.set(err?.error?.error || err?.message || 'Failed to load styles.'),
    });
  }

  startCreate(): void {
    this.editingId.set(null);
    this.name.set('');
    this.description.set('');
    this.isDefault.set(false);
    this.directives.set(
      'Write in first-person limited, present tense. Stay strictly in character as {{char}}. Avoid summarizing {{user}}\'s actions or speaking for them.'
    );
    this.scenarioOverride.set('');
    this.sceneNote.set('');
    this.cadenceReminder.set(
      'Write grounded dialogue paired with brief action beats. Keep replies to 2-3 focused paragraphs.'
    );
    this.suggestPrompt.set(
      "Write the next single in-character reply from {{user}}'s first-person perspective, responding naturally to {{char}}'s last message. Match {{user}}'s established persona, tone, and formatting. Output ONLY {{user}}'s dialogue and action beats — no preamble, no speaker label, and do not write for {{char}}."
    );
    this.temperature.set('0.85');
    this.topP.set('0.95');
    this.minP.set('0.05');
    this.maxTokens.set('');
    this.dryMultiplier.set('0.8');
    this.error.set(null);
    this.statusMsg.set(null);
  }

  selectForEdit(style: RpStyle): void {
    this.editingId.set(style.id);
    this.name.set(style.name);
    this.description.set(style.description);
    this.isDefault.set(style.isDefault);
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

    this.error.set(null);
    this.statusMsg.set(null);
  }

  private buildParams(): InferenceParams {
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

  save(): void {
    const trimmedName = this.name().trim();
    if (!trimmedName) {
      this.error.set('Style name is required.');
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    const payload = {
      name: trimmedName,
      description: this.description().trim(),
      directives: this.directives().trim(),
      scenarioOverride: this.scenarioOverride().trim(),
      sceneNote: this.sceneNote().trim(),
      cadenceReminder: this.cadenceReminder().trim(),
      suggestPrompt: this.suggestPrompt().trim(),
      params: this.buildParams(),
      isDefault: this.isDefault(),
    };

    const id = this.editingId();
    const obs =
      id === null
        ? this.backendService.createStyle(payload)
        : this.backendService.updateStyle(id, payload);

    obs.subscribe({
      next: (res) => {
        this.isSaving.set(false);
        if (res.success && res.data) {
          this.editingId.set(res.data.id);
          this.statusMsg.set(
            id === null
              ? `Created style "${res.data.name}".`
              : `Saved changes to "${res.data.name}".`
          );
          this.loadStyles(false);
        } else {
          this.error.set(res.error || 'Failed to save style.');
        }
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.error.set(err?.error?.error || err?.message || 'Failed to save style.');
      },
    });
  }

  deleteStyle(style: RpStyle, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete style "${style.name}"? Existing sessions will keep their copied settings.`)) {
      return;
    }

    this.backendService.deleteStyle(style.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.styles.update((prev) => prev.filter((s) => s.id !== style.id));
          if (this.editingId() === style.id) {
            this.startCreate();
          }
        }
      },
      error: (err: any) =>
        this.error.set(err?.error?.error || err?.message || 'Failed to delete style.'),
    });
  }
}
