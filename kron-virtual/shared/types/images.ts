export type GeneratedImageKind = 'avatar' | 'session' | 'combined' | 'studio';
export type ImageEntityType = 'character' | 'persona' | 'session' | 'studio';
export type ImageOutputFormat = 'jpeg' | 'png';
export type ImageBackgroundMode = 'auto' | 'opaque' | 'transparent';

export type ImageTemplateKey =
  | 'avatar_character'
  | 'avatar_persona'
  | 'session_scene'
  | 'combined_scene';

export interface WiroConfigStatus {
  configured: boolean;
  model: string;
  message?: string;
}

export interface GeneratedImage {
  id: number;
  kind: GeneratedImageKind;
  entityType: ImageEntityType;
  entityId: number | null;
  isDefault: boolean;
  filename: string;
  url: string; // Local static URL served by backend (/api/images/file/<filename>)
  remoteUrl: string | null; // Wiro CDN URL for fast I2I reuse
  prompt: string;
  referenceImageIds: number[];
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  wiroTaskId: string | null;
  elapsedSeconds: string | null;
  cost: string | null;
  createdAt: string;
}

export interface ImagePromptTemplate {
  id: number;
  key: ImageTemplateKey;
  name: string;
  description: string;
  template: string;
  updatedAt: string;
}

export interface UpdateImageTemplateRequest {
  template: string;
}

export interface GenerateImageRequest {
  kind: GeneratedImageKind;
  entityType: ImageEntityType;
  entityId?: number | null;
  prompt: string;
  referenceImageIds?: number[];
  width?: number;
  height?: number;
  outputFormat?: ImageOutputFormat;
  background?: ImageBackgroundMode;
  setAsDefault?: boolean;
}

export interface DraftImagePromptRequest {
  templateKey: ImageTemplateKey;
  characterId?: number;
  personaId?: number;
  sessionId?: number;
  extraNotes?: string;
  useLlm?: boolean;
}

export interface DraftImagePromptResponse {
  prompt: string;
  usedLlm: boolean;
}

export interface AssignImageRequest {
  entityType: ImageEntityType;
  entityId: number | null;
  kind?: GeneratedImageKind;
  setAsDefault?: boolean;
}
