import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  Character,
  GeneratedImage,
  ImageBackgroundMode,
  ImageOutputFormat,
  ImagePromptTemplate,
  ImageTemplateKey,
  Persona,
  WiroConfigStatus,
} from '@shared/index';
import { BackendService } from '../../core/services/backend.service';

interface SizePreset {
  label: string;
  width: number;
  height: number;
}

const SIZE_PRESETS: SizePreset[] = [
  { label: '1024 × 1024 (Square)', width: 1024, height: 1024 },
  { label: '1024 × 1280 (Portrait 4:5)', width: 1024, height: 1280 },
  { label: '1280 × 1024 (Landscape 5:4)', width: 1280, height: 1024 },
  { label: '1344 × 768 (Cinematic 16:9)', width: 1344, height: 768 },
  { label: '768 × 1344 (Tall 9:16)', width: 768, height: 1344 },
];

@Component({
  selector: 'app-studio',
  standalone: true,
  templateUrl: './studio.html',
  styleUrl: './studio.css',
})
export class Studio implements OnInit {
  private readonly backendService = inject(BackendService);

  protected readonly sizePresets = SIZE_PRESETS;
  protected readonly activeTab = signal<'generate' | 'gallery' | 'templates'>('generate');

  // Config & reference lists
  protected readonly wiroStatus = signal<WiroConfigStatus | null>(null);
  protected readonly allImages = signal<GeneratedImage[]>([]);
  protected readonly characters = signal<Character[]>([]);
  protected readonly personas = signal<Persona[]>([]);
  protected readonly templates = signal<ImagePromptTemplate[]>([]);

  // Generate / Remix state
  protected readonly prompt = signal<string>('');
  protected readonly selectedSizeIdx = signal<number>(0);
  protected readonly outputFormat = signal<ImageOutputFormat>('jpeg');
  protected readonly backgroundMode = signal<ImageBackgroundMode>('auto');
  protected readonly selectedRefIds = signal<number[]>([]);
  protected readonly quickCharId = signal<number | null>(null);
  protected readonly quickPersonaId = signal<number | null>(null);
  protected readonly isGenerating = signal<boolean>(false);
  protected readonly isDrafting = signal<boolean>(false);
  protected readonly latestResult = signal<GeneratedImage | null>(null);

  // Gallery filter & lightbox
  protected readonly galleryFilter = signal<string>('all');
  protected readonly lightboxImage = signal<GeneratedImage | null>(null);
  protected readonly assignTarget = signal<string>('');

  // Templates editor state
  protected readonly selectedTemplateKey = signal<ImageTemplateKey>('avatar_character');
  protected readonly templateDraft = signal<string>('');
  protected readonly isSavingTemplate = signal<boolean>(false);

  // Feedback
  protected readonly error = signal<string | null>(null);
  protected readonly statusMsg = signal<string | null>(null);

  protected readonly selectedRefImages = computed(() => {
    const map = new Map(this.allImages().map((img) => [img.id, img]));
    return this.selectedRefIds()
      .map((id) => map.get(id))
      .filter((img): img is GeneratedImage => Boolean(img));
  });

  protected readonly filteredGallery = computed(() => {
    const f = this.galleryFilter();
    const list = this.allImages();
    if (f === 'all') return list;
    return list.filter((img) => img.kind === f);
  });

  protected readonly activeTemplate = computed(() => {
    return this.templates().find((t) => t.key === this.selectedTemplateKey()) ?? null;
  });

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.backendService.getWiroStatus().subscribe({
      next: (res) => {
        if (res.success && res.data) this.wiroStatus.set(res.data);
      },
    });

    this.backendService.getImages().subscribe({
      next: (res) => {
        if (res.success && res.data) this.allImages.set(res.data);
      },
    });

    this.backendService.getCharacters().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.characters.set(res.data);
          if (this.quickCharId() === null && res.data.length > 0) {
            this.quickCharId.set(res.data[0].id);
          }
        }
      },
    });

    this.backendService.getPersonas().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.personas.set(res.data);
          if (this.quickPersonaId() === null && res.data.length > 0) {
            this.quickPersonaId.set(res.data[0].id);
          }
        }
      },
    });

    this.backendService.getImageTemplates().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.templates.set(res.data);
          const cur = res.data.find((t) => t.key === this.selectedTemplateKey()) ?? res.data[0];
          if (cur) {
            this.selectedTemplateKey.set(cur.key);
            this.templateDraft.set(cur.template);
          }
        }
      },
    });
  }

  toggleReference(id: number): void {
    const current = this.selectedRefIds();
    if (current.includes(id)) {
      this.selectedRefIds.set(current.filter((x) => x !== id));
    } else if (current.length < 10) {
      this.selectedRefIds.set([...current, id]);
    }
  }

  refOrderNumber(id: number): number {
    const idx = this.selectedRefIds().indexOf(id);
    return idx === -1 ? 0 : idx + 1;
  }

  clearReferences(): void {
    this.selectedRefIds.set([]);
  }

  draftFromTemplate(templateKey: ImageTemplateKey, useLlm = false): void {
    this.isDrafting.set(true);
    this.error.set(null);

    this.backendService
      .draftImagePrompt({
        templateKey,
        characterId: this.quickCharId() ?? undefined,
        personaId: this.quickPersonaId() ?? undefined,
        extraNotes: this.prompt().trim() || undefined,
        useLlm,
      })
      .subscribe({
        next: (res) => {
          this.isDrafting.set(false);
          if (res.success && res.data) {
            this.prompt.set(res.data.prompt);
            // Auto-attach default avatars for I2I templates when none selected yet
            if (templateKey === 'session_scene' && this.selectedRefIds().length === 0) {
              const ch = this.characters().find((c) => c.id === this.quickCharId());
              if (ch?.defaultAvatarId) this.selectedRefIds.set([ch.defaultAvatarId]);
            } else if (templateKey === 'combined_scene' && this.selectedRefIds().length === 0) {
              const ch = this.characters().find((c) => c.id === this.quickCharId());
              const pe = this.personas().find((p) => p.id === this.quickPersonaId());
              const ids = [ch?.defaultAvatarId, pe?.defaultAvatarId].filter(
                (x): x is number => typeof x === 'number'
              );
              if (ids.length > 0) this.selectedRefIds.set(ids);
            }
          }
        },
        error: (err: any) => {
          this.isDrafting.set(false);
          this.error.set(err?.error?.error || err?.message || 'Failed to draft prompt.');
        },
      });
  }

  generate(): void {
    const p = this.prompt().trim();
    if (!p) {
      this.error.set('Enter a prompt first.');
      return;
    }

    const size = SIZE_PRESETS[this.selectedSizeIdx()] ?? SIZE_PRESETS[0];
    this.isGenerating.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    this.backendService
      .generateImage({
        kind: 'studio',
        entityType: 'studio',
        entityId: null,
        prompt: p,
        referenceImageIds: this.selectedRefIds(),
        width: size.width,
        height: size.height,
        outputFormat: this.outputFormat(),
        background: this.backgroundMode(),
      })
      .subscribe({
        next: (res) => {
          this.isGenerating.set(false);
          if (res.success && res.data) {
            this.latestResult.set(res.data);
            this.allImages.update((prev) => [res.data!, ...prev]);
            this.statusMsg.set('Image generated and saved to gallery.');
          } else {
            this.error.set(res.error || 'Image generation failed.');
          }
        },
        error: (err: any) => {
          this.isGenerating.set(false);
          this.error.set(err?.error?.error || err?.message || 'Image generation failed.');
        },
      });
  }

  sendToRemix(img: GeneratedImage): void {
    if (!this.selectedRefIds().includes(img.id) && this.selectedRefIds().length < 10) {
      this.selectedRefIds.update((prev) => [...prev, img.id]);
    }
    this.lightboxImage.set(null);
    this.activeTab.set('generate');
  }

  assignSelectedImage(img: GeneratedImage): void {
    const target = this.assignTarget();
    if (!target) return;
    const [type, idStr] = target.split(':');
    const entityId = Number(idStr);
    if ((type !== 'character' && type !== 'persona') || !Number.isInteger(entityId)) return;

    this.backendService
      .assignImage(img.id, {
        entityType: type,
        entityId,
        kind: 'avatar',
        setAsDefault: true,
      })
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.allImages.update((prev) => prev.map((x) => (x.id === img.id ? res.data! : x)));
            if (this.lightboxImage()?.id === img.id) this.lightboxImage.set(res.data);
            if (this.latestResult()?.id === img.id) this.latestResult.set(res.data);
            this.assignTarget.set('');
            this.statusMsg.set(`Assigned image as default ${type} avatar.`);
          }
        },
        error: (err: any) => this.error.set(err?.error?.error || err?.message),
      });
  }

  deleteImage(img: GeneratedImage, event?: Event): void {
    event?.stopPropagation();
    if (!confirm('Delete this generated image permanently?')) return;

    this.backendService.deleteImage(img.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.allImages.update((prev) => prev.filter((x) => x.id !== img.id));
          this.selectedRefIds.update((prev) => prev.filter((x) => x !== img.id));
          if (this.lightboxImage()?.id === img.id) this.lightboxImage.set(null);
          if (this.latestResult()?.id === img.id) this.latestResult.set(null);
        }
      },
    });
  }

  // Templates tab
  selectTemplate(key: ImageTemplateKey): void {
    this.selectedTemplateKey.set(key);
    const tpl = this.templates().find((t) => t.key === key);
    this.templateDraft.set(tpl?.template ?? '');
    this.statusMsg.set(null);
    this.error.set(null);
  }

  saveTemplate(): void {
    const key = this.selectedTemplateKey();
    const text = this.templateDraft().trim();
    if (!text) {
      this.error.set('Template text cannot be empty.');
      return;
    }

    this.isSavingTemplate.set(true);
    this.error.set(null);
    this.statusMsg.set(null);

    this.backendService.updateImageTemplate(key, { template: text }).subscribe({
      next: (res) => {
        this.isSavingTemplate.set(false);
        if (res.success && res.data) {
          this.templates.update((prev) => prev.map((t) => (t.key === key ? res.data! : t)));
          this.statusMsg.set(`Saved "${res.data.name}" template.`);
        }
      },
      error: (err: any) => {
        this.isSavingTemplate.set(false);
        this.error.set(err?.error?.error || err?.message);
      },
    });
  }

  resetTemplate(): void {
    const key = this.selectedTemplateKey();
    if (!confirm('Reset this template back to the built-in default?')) return;

    this.backendService.resetImageTemplate(key).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.templates.update((prev) => prev.map((t) => (t.key === key ? res.data! : t)));
          this.templateDraft.set(res.data.template);
          this.statusMsg.set(`Reset "${res.data.name}" to default.`);
        }
      },
    });
  }
}
