import { Character } from './characters';
import { Persona } from './personas';

export interface InferenceParams {
  temperature?: number;
  top_p?: number;
  min_p?: number;
  max_tokens?: number;
  dry_multiplier?: number;
  dry_base?: number;
  dry_allowed_length?: number;
}

export interface ChatMetrics {
  ttftMs: number | null;
  totalMs: number;
  completionTokens: number;
  promptTokens: number | null;
  tokensPerSecond: number | null;
  estimated: boolean;
}

export type RpMessageRole = 'user' | 'assistant';

export interface RpMessage {
  id: number;
  sessionId: number;
  role: RpMessageRole;
  content: string;
  reasoningContent: string | null;
  systemPrompt: string | null;
  modelId: string | null;
  engineLabel: string | null;
  metrics: ChatMetrics | null;
  createdAt: string;
  updatedAt: string;
}

export interface RpSession {
  id: number;
  title: string;
  characterId: number;
  personaId: number;
  directives: string;
  scenarioOverride: string;
  sceneNote: string;
  cadenceReminder: string;
  suggestPrompt: string;
  params: InferenceParams;
  createdAt: string;
  updatedAt: string;
}

export interface RpSessionSummary extends RpSession {
  characterName: string;
  characterTagline: string;
  characterAvatarUrl: string | null;
  personaName: string;
  personaTagline: string;
  personaAvatarUrl: string | null;
  messageCount: number;
}

export interface RpSessionDetail {
  session: RpSession;
  character: Character;
  persona: Persona;
  messages: RpMessage[];
}

export interface CreateSessionRequest {
  characterId: number;
  personaId: number;
  styleId?: number | null;
  title?: string;
  directives?: string;
  scenarioOverride?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  suggestPrompt?: string;
  params?: InferenceParams;
}

export interface UpdateSessionRequest {
  title?: string;
  directives?: string;
  scenarioOverride?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  suggestPrompt?: string;
  params?: InferenceParams;
}

export interface UpdateMessageRequest {
  content: string;
}

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptPreview {
  messages: PromptMessage[];
  estimatedTokens: number;
  staticPrefixChars: number;
}

export interface ChatStreamRequest {
  sessionId: number;
  userMessage?: string;
  regenerate?: boolean;
  directives?: string;
  scenarioOverride?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  suggestPrompt?: string;
  params?: InferenceParams;
}

export type ChatStreamEvent =
  | {
      type: 'start';
      userMessageId: number | null;
      modelId: string;
      engineLabel: string;
      port: number;
      systemPrompt: string;
    }
  | { type: 'delta'; content?: string; reasoning?: string }
  | { type: 'metrics'; metrics: ChatMetrics }
  | { type: 'done'; assistantMessage: RpMessage }
  | { type: 'error'; error: string };

export interface SuggestReplyRequest {
  sessionId: number;
  hint?: string;
  suggestPrompt?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  params?: InferenceParams;
}

export type SuggestStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; content: string }
  | { type: 'error'; error: string };
