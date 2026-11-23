export interface InferenceParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface ChatMetrics {
  ttftMs: number | null;
  totalMs: number;
  completionTokens: number;
  promptTokens: number | null;
  tokensPerSecond: number | null;
  estimated: boolean;
}

export interface SystemPromptPreset {
  id: number;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSystemPromptRequest {
  name: string;
  content: string;
  isDefault?: boolean;
}

export interface UpdateSystemPromptRequest {
  name?: string;
  content?: string;
  isDefault?: boolean;
}

export interface ChatSession {
  id: number;
  title: string;
  endpointId: number | null;
  modelId: string | null;
  systemPrompt: string;
  params: InferenceParams;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatSessionRequest {
  title?: string;
  endpointId?: number | null;
  modelId?: string | null;
  systemPrompt?: string;
  params?: InferenceParams;
}

export interface UpdateChatSessionRequest {
  title?: string;
  endpointId?: number | null;
  modelId?: string | null;
  systemPrompt?: string;
  params?: InferenceParams;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  id: number;
  sessionId: number;
  role: ChatRole;
  content: string;
  reasoningContent: string | null;
  modelId: string | null;
  endpointName: string | null;
  metrics: ChatMetrics | null;
  createdAt: string;
}

export interface ChatStreamRequest {
  sessionId: number;
  endpointId: number;
  modelId: string;
  userMessage: string;
  systemPrompt?: string;
  params?: InferenceParams;
}

export type ChatStreamEvent =
  | { type: 'start'; userMessageId: number; modelId: string; endpointName: string }
  | { type: 'delta'; content?: string; reasoning?: string }
  | { type: 'metrics'; metrics: ChatMetrics }
  | { type: 'done'; assistantMessage: ChatMessage }
  | { type: 'error'; error: string };
