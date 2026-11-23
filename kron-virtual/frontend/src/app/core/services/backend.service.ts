import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ActiveEngineStatus,
  ApiResponse,
  AppInfo,
  AssignImageRequest,
  Character,
  ChatStreamEvent,
  ChatStreamRequest,
  CreateCharacterRequest,
  CreatePersonaRequest,
  CreateSessionRequest,
  CreateStyleRequest,
  DraftImagePromptRequest,
  DraftImagePromptResponse,
  GeneratedImage,
  GenerateImageRequest,
  ImagePromptTemplate,
  ImageTemplateKey,
  Persona,
  PromptPreview,
  RpMessage,
  RpSession,
  RpSessionDetail,
  RpSessionSummary,
  RpStyle,
  SuggestReplyRequest,
  SuggestStreamEvent,
  UpdateCharacterRequest,
  UpdateImageTemplateRequest,
  UpdateMessageRequest,
  UpdatePersonaRequest,
  UpdateSessionRequest,
  UpdateStyleRequest,
  WiroConfigStatus,
} from '@shared/index';

@Injectable({
  providedIn: 'root',
})
export class BackendService {
  private readonly http = inject(HttpClient);

  getAppInfo(): Observable<ApiResponse<AppInfo>> {
    return this.http.get<ApiResponse<AppInfo>>('/api/info');
  }

  // Active Local Inference Engine (8080 / 8081)
  getEngineStatus(refresh = false): Observable<ApiResponse<ActiveEngineStatus>> {
    const query = refresh ? '?refresh=true' : '';
    return this.http.get<ApiResponse<ActiveEngineStatus>>(`/api/engine/status${query}`);
  }

  // Characters
  getCharacters(): Observable<ApiResponse<Character[]>> {
    return this.http.get<ApiResponse<Character[]>>('/api/characters');
  }

  createCharacter(payload: CreateCharacterRequest): Observable<ApiResponse<Character>> {
    return this.http.post<ApiResponse<Character>>('/api/characters', payload);
  }

  updateCharacter(id: number, payload: UpdateCharacterRequest): Observable<ApiResponse<Character>> {
    return this.http.put<ApiResponse<Character>>(`/api/characters/${id}`, payload);
  }

  deleteCharacter(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/characters/${id}`);
  }

  // Personas
  getPersonas(): Observable<ApiResponse<Persona[]>> {
    return this.http.get<ApiResponse<Persona[]>>('/api/personas');
  }

  createPersona(payload: CreatePersonaRequest): Observable<ApiResponse<Persona>> {
    return this.http.post<ApiResponse<Persona>>('/api/personas', payload);
  }

  updatePersona(id: number, payload: UpdatePersonaRequest): Observable<ApiResponse<Persona>> {
    return this.http.put<ApiResponse<Persona>>(`/api/personas/${id}`, payload);
  }

  deletePersona(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/personas/${id}`);
  }

  // RP Styles (Session Prompt & Sampler Presets)
  getStyles(): Observable<ApiResponse<RpStyle[]>> {
    return this.http.get<ApiResponse<RpStyle[]>>('/api/styles');
  }

  createStyle(payload: CreateStyleRequest): Observable<ApiResponse<RpStyle>> {
    return this.http.post<ApiResponse<RpStyle>>('/api/styles', payload);
  }

  updateStyle(id: number, payload: UpdateStyleRequest): Observable<ApiResponse<RpStyle>> {
    return this.http.put<ApiResponse<RpStyle>>(`/api/styles/${id}`, payload);
  }

  deleteStyle(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/styles/${id}`);
  }

  // RP Sessions
  getSessions(): Observable<ApiResponse<RpSessionSummary[]>> {
    return this.http.get<ApiResponse<RpSessionSummary[]>>('/api/sessions');
  }

  createSession(payload: CreateSessionRequest): Observable<ApiResponse<RpSessionDetail>> {
    return this.http.post<ApiResponse<RpSessionDetail>>('/api/sessions', payload);
  }

  getSession(id: number): Observable<ApiResponse<RpSessionDetail>> {
    return this.http.get<ApiResponse<RpSessionDetail>>(`/api/sessions/${id}`);
  }

  updateSession(id: number, payload: UpdateSessionRequest): Observable<ApiResponse<RpSession>> {
    return this.http.patch<ApiResponse<RpSession>>(`/api/sessions/${id}`, payload);
  }

  deleteSession(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/sessions/${id}`);
  }

  resetSessionMessages(id: number, reseed = true): Observable<ApiResponse<RpMessage[]>> {
    const query = reseed ? '?reseed=true' : '';
    return this.http.delete<ApiResponse<RpMessage[]>>(`/api/sessions/${id}/messages${query}`);
  }

  getPromptPreview(sessionId: number): Observable<ApiResponse<PromptPreview>> {
    return this.http.get<ApiResponse<PromptPreview>>(`/api/sessions/${sessionId}/prompt-preview`);
  }

  // Messages
  updateMessage(id: number, payload: UpdateMessageRequest): Observable<ApiResponse<RpMessage>> {
    return this.http.patch<ApiResponse<RpMessage>>(`/api/messages/${id}`, payload);
  }

  deleteMessage(id: number, truncateAfter = false): Observable<ApiResponse<void>> {
    const query = truncateAfter ? '?truncateAfter=true' : '';
    return this.http.delete<ApiResponse<void>>(`/api/messages/${id}${query}`);
  }

  // Image Generation & Studio (Wiro.ai Seedream 5.5)
  getWiroStatus(): Observable<ApiResponse<WiroConfigStatus>> {
    return this.http.get<ApiResponse<WiroConfigStatus>>('/api/images/status');
  }

  getImages(filters?: {
    kind?: string;
    entityType?: string;
    entityId?: number;
  }): Observable<ApiResponse<GeneratedImage[]>> {
    const params = new URLSearchParams();
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.entityType) params.set('entityType', filters.entityType);
    if (filters?.entityId !== undefined) params.set('entityId', String(filters.entityId));
    const qs = params.toString();
    return this.http.get<ApiResponse<GeneratedImage[]>>(`/api/images${qs ? '?' + qs : ''}`);
  }

  generateImage(payload: GenerateImageRequest): Observable<ApiResponse<GeneratedImage>> {
    return this.http.post<ApiResponse<GeneratedImage>>('/api/images/generate', payload);
  }

  setDefaultImage(id: number): Observable<ApiResponse<GeneratedImage>> {
    return this.http.patch<ApiResponse<GeneratedImage>>(`/api/images/${id}/default`, {});
  }

  assignImage(id: number, payload: AssignImageRequest): Observable<ApiResponse<GeneratedImage>> {
    return this.http.patch<ApiResponse<GeneratedImage>>(`/api/images/${id}/assign`, payload);
  }

  deleteImage(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/images/${id}`);
  }

  getImageTemplates(): Observable<ApiResponse<ImagePromptTemplate[]>> {
    return this.http.get<ApiResponse<ImagePromptTemplate[]>>('/api/images/templates');
  }

  updateImageTemplate(
    key: ImageTemplateKey,
    payload: UpdateImageTemplateRequest
  ): Observable<ApiResponse<ImagePromptTemplate>> {
    return this.http.put<ApiResponse<ImagePromptTemplate>>(`/api/images/templates/${key}`, payload);
  }

  resetImageTemplate(key: ImageTemplateKey): Observable<ApiResponse<ImagePromptTemplate>> {
    return this.http.post<ApiResponse<ImagePromptTemplate>>(
      `/api/images/templates/${key}/reset`,
      {}
    );
  }

  draftImagePrompt(
    payload: DraftImagePromptRequest
  ): Observable<ApiResponse<DraftImagePromptResponse>> {
    return this.http.post<ApiResponse<DraftImagePromptResponse>>(
      '/api/images/draft-prompt',
      payload
    );
  }

  // Streaming RP Chat Proxy (SSE over POST)
  async streamChat(
    payload: ChatStreamRequest,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      let msg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson?.error) msg = errJson.error;
      } catch {
        // ignore
      }
      onEvent({ type: 'error', error: msg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr) as ChatStreamEvent;
          onEvent(parsed);
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  }

  // Streaming User Reply Suggestion Proxy (SSE over POST, non-persisted)
  async streamSuggestReply(
    payload: SuggestReplyRequest,
    onEvent: (event: SuggestStreamEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch('/api/chat/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok || !response.body) {
      let msg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson?.error) msg = errJson.error;
      } catch {
        // ignore
      }
      onEvent({ type: 'error', error: msg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr) continue;
        try {
          const parsed = JSON.parse(dataStr) as SuggestStreamEvent;
          onEvent(parsed);
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  }
}
