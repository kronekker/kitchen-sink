import { Component, OnInit, signal, inject } from '@angular/core';
import { Persona } from '@shared/index';
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
