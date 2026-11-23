import { Component, OnInit, signal, inject } from '@angular/core';
import { GeneratedImage, Persona } from '@shared/index';
import { BackendService } from '../../core/services/backend.service';

@Component({
  selector: 'app-personas',
  standalone: true,
  templateUrl: './personas.html',
  styleUrl: './personas.css',
})
export class Personas implements OnInit {
  private readonly backendService = inject(BackendService);

  protected readonly personas = signal<Persona[]>([]);
  protected readonly editingId = signal<number | null>(null);
  protected readonly isSaving = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statusMsg = signal<string | null>(null);

  // Form fields
  protected readonly name = signal<string>('');
  protected readonly tagline = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly background = signal<string>('');
  protected readonly isDefault = signal<boolean>(false);

  // Avatar management
  protected readonly avatars = signal<GeneratedImage[]>([]);
  protected readonly avatarPrompt = signal<string>('');
  protected readonly isGeneratingAvatar = signal<boolean>(false);
  protected readonly isDraftingAvatar = signal<boolean>(false);
  protected readonly previewAvatar = signal<GeneratedImage | null>(null);

  ngOnInit(): void {
    this.loadPersonas();
  }

  loadPersonas(): void {
    this.backendService.getPersonas().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.personas.set(res.data);
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message || 'Failed to load personas.'),
    });
  }

  startCreate(): void {
    this.editingId.set(null);
    this.name.set('');
    this.tagline.set('');
    this.description.set('');
    this.background.set('');
    this.isDefault.set(false);
    this.avatars.set([]);
    this.avatarPrompt.set('');
    this.error.set(null);
    this.statusMsg.set(null);
  }

  selectForEdit(persona: Persona): void {
    this.editingId.set(persona.id);
    this.name.set(persona.name);
    this.tagline.set(persona.tagline);
    this.description.set(persona.description);
    this.background.set(persona.background);
    this.isDefault.set(persona.isDefault);
    this.error.set(null);
    this.statusMsg.set(null);
    this.loadAvatars(persona.id);
    this.draftAvatarPrompt(persona.id);
  }

  loadAvatars(personaId: number): void {
    this.backendService.getImages({ entityType: 'persona', entityId: personaId }).subscribe({
      next: (res) => {
        if (res.success && res.data) this.avatars.set(res.data);
      },
    });
  }

  draftAvatarPrompt(personaId?: number): void {
    const id = personaId ?? this.editingId();
    if (!id) return;
    this.isDraftingAvatar.set(true);
    this.backendService
      .draftImagePrompt({ templateKey: 'avatar_persona', personaId: id })
      .subscribe({
        next: (res) => {
          this.isDraftingAvatar.set(false);
          if (res.success && res.data) this.avatarPrompt.set(res.data.prompt);
        },
        error: () => this.isDraftingAvatar.set(false),
      });
  }

  generateAvatar(): void {
    const id = this.editingId();
    const prompt = this.avatarPrompt().trim();
    if (!id || !prompt) return;

    this.isGeneratingAvatar.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    this.backendService
      .generateImage({
        kind: 'avatar',
        entityType: 'persona',
        entityId: id,
        prompt,
        width: 1024,
        height: 1024,
        outputFormat: 'jpeg',
        setAsDefault: this.avatars().length === 0,
      })
      .subscribe({
        next: (res) => {
          this.isGeneratingAvatar.set(false);
          if (res.success && res.data) {
            this.statusMsg.set('Generated new persona avatar.');
            this.loadAvatars(id);
            this.loadPersonas();
          } else {
            this.error.set(res.error || 'Failed to generate avatar.');
          }
        },
        error: (err: any) => {
          this.isGeneratingAvatar.set(false);
          this.error.set(err?.error?.error || err?.message || 'Failed to generate avatar.');
        },
      });
  }

  setDefaultAvatar(img: GeneratedImage): void {
    this.backendService.setDefaultImage(img.id).subscribe({
      next: (res) => {
        if (res.success) {
          const id = this.editingId();
          if (id) this.loadAvatars(id);
          this.loadPersonas();
        }
      },
    });
  }

  deleteAvatar(img: GeneratedImage, event: Event): void {
    event.stopPropagation();
    if (!confirm('Delete this avatar image?')) return;
    this.backendService.deleteImage(img.id).subscribe({
      next: (res) => {
        if (res.success) {
          const id = this.editingId();
          if (id) this.loadAvatars(id);
          this.loadPersonas();
          if (this.previewAvatar()?.id === img.id) this.previewAvatar.set(null);
        }
      },
    });
  }

  save(): void {
    const trimmedName = this.name().trim();
    if (!trimmedName) {
      this.error.set('Persona name is required.');
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    const payload = {
      name: trimmedName,
      tagline: this.tagline().trim(),
      description: this.description().trim(),
      background: this.background().trim(),
      isDefault: this.isDefault(),
    };

    const id = this.editingId();
    const obs =
      id === null
        ? this.backendService.createPersona(payload)
        : this.backendService.updatePersona(id, payload);

    obs.subscribe({
      next: (res) => {
        this.isSaving.set(false);
        if (res.success && res.data) {
          this.editingId.set(res.data.id);
          this.statusMsg.set(
            id === null
              ? `Created persona "${res.data.name}".`
              : `Saved changes to "${res.data.name}".`
          );
          this.loadPersonas();
        } else {
          this.error.set(res.error || 'Failed to save persona.');
        }
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.error.set(err?.error?.error || err?.message || 'Failed to save persona.');
      },
    });
  }

  deletePersona(persona: Persona, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete persona "${persona.name}"? Sessions using this persona will also be removed.`)) {
      return;
    }

    this.backendService.deletePersona(persona.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.personas.update((prev) => prev.filter((p) => p.id !== persona.id));
          if (this.editingId() === persona.id) {
            this.startCreate();
          }
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message || 'Failed to delete persona.'),
    });
  }
}
