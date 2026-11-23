import { Component, OnInit, signal, inject } from '@angular/core';
import { Character } from '@shared/index';
import { BackendService } from '../../core/services/backend.service';

@Component({
  selector: 'app-characters',
  standalone: true,
  templateUrl: './characters.html',
  styleUrl: './characters.css',
})
export class Characters implements OnInit {
  private readonly backendService = inject(BackendService);

  protected readonly characters = signal<Character[]>([]);
  protected readonly editingId = signal<number | null>(null);
  protected readonly isSaving = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly statusMsg = signal<string | null>(null);

  // Form fields
  protected readonly name = signal<string>('');
  protected readonly tagline = signal<string>('');
  protected readonly description = signal<string>('');
  protected readonly personality = signal<string>('');
  protected readonly speechPatterns = signal<string>('');
  protected readonly scenario = signal<string>('');
  protected readonly firstMessage = signal<string>('');
  protected readonly exampleDialogue = signal<string>('');

  ngOnInit(): void {
    this.loadCharacters();
  }

  loadCharacters(): void {
    this.backendService.getCharacters().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.characters.set(res.data);
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message || 'Failed to load characters.'),
    });
  }

  startCreate(): void {
    this.editingId.set(null);
    this.name.set('');
    this.tagline.set('');
    this.description.set('');
    this.personality.set('');
    this.speechPatterns.set('');
    this.scenario.set('');
    this.firstMessage.set('');
    this.exampleDialogue.set('');
    this.error.set(null);
    this.statusMsg.set(null);
  }

  selectForEdit(char: Character): void {
    this.editingId.set(char.id);
    this.name.set(char.name);
    this.tagline.set(char.tagline);
    this.description.set(char.description);
    this.personality.set(char.personality);
    this.speechPatterns.set(char.speechPatterns);
    this.scenario.set(char.scenario);
    this.firstMessage.set(char.firstMessage);
    this.exampleDialogue.set(char.exampleDialogue);
    this.error.set(null);
    this.statusMsg.set(null);
  }

  save(): void {
    const trimmedName = this.name().trim();
    if (!trimmedName) {
      this.error.set('Character name is required.');
      return;
    }

    this.isSaving.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    const payload = {
      name: trimmedName,
      tagline: this.tagline().trim(),
      description: this.description().trim(),
      personality: this.personality().trim(),
      speechPatterns: this.speechPatterns().trim(),
      scenario: this.scenario().trim(),
      firstMessage: this.firstMessage().trim(),
      exampleDialogue: this.exampleDialogue().trim(),
    };

    const id = this.editingId();
    const obs =
      id === null
        ? this.backendService.createCharacter(payload)
        : this.backendService.updateCharacter(id, payload);

    obs.subscribe({
      next: (res) => {
        this.isSaving.set(false);
        if (res.success && res.data) {
          if (id === null) {
            this.characters.update((prev) => [res.data!, ...prev]);
            this.editingId.set(res.data.id);
            this.statusMsg.set(`Created character "${res.data.name}".`);
          } else {
            this.characters.update((prev) =>
              prev.map((c) => (c.id === res.data!.id ? res.data! : c))
            );
            this.statusMsg.set(`Saved changes to "${res.data.name}".`);
          }
        } else {
          this.error.set(res.error || 'Failed to save character.');
        }
      },
      error: (err: any) => {
        this.isSaving.set(false);
        this.error.set(err?.error?.error || err?.message || 'Failed to save character.');
      },
    });
  }

  deleteCharacter(char: Character, event: Event): void {
    event.stopPropagation();
    if (!confirm(`Delete character "${char.name}"? Sessions using this character will also be removed.`)) {
      return;
    }

    this.backendService.deleteCharacter(char.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.characters.update((prev) => prev.filter((c) => c.id !== char.id));
          if (this.editingId() === char.id) {
            this.startCreate();
          }
        }
      },
      error: (err: any) => this.error.set(err?.error?.error || err?.message || 'Failed to delete character.'),
    });
  }
}
