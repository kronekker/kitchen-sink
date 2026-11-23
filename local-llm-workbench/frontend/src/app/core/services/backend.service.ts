import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AppInfo,
  ApiResponse,
  LlmEndpoint,
  CreateEndpointRequest,
  UpdateEndpointRequest,
  EndpointProbeResult,
  SystemPromptPreset,
  CreateSystemPromptRequest,
  UpdateSystemPromptRequest,
  ChatSession,
  CreateChatSessionRequest,
  UpdateChatSessionRequest,
  ChatMessage,
  ChatStreamRequest,
  ChatStreamEvent,
  SystemdServiceStatus,
  LlamaScriptConfig,
  ModelPreset,
  CreateModelPresetRequest,
  UpdateModelPresetRequest,
  IsMtpMode,
  ContainerInfo,
  TransformContainerCommandRequest,
  TransformContainerCommandResult,
  LaunchPersistentContainerResponse,
} from '@shared/index';

@Injectable({
  providedIn: 'root',
})
export class BackendService {
  private readonly http = inject(HttpClient);

  getAppInfo(): Observable<ApiResponse<AppInfo>> {
    return this.http.get<ApiResponse<AppInfo>>('/api/info');
  }

  // Endpoints
  getEndpoints(): Observable<ApiResponse<LlmEndpoint[]>> {
    return this.http.get<ApiResponse<LlmEndpoint[]>>('/api/endpoints');
  }

  createEndpoint(payload: CreateEndpointRequest): Observable<ApiResponse<LlmEndpoint>> {
    return this.http.post<ApiResponse<LlmEndpoint>>('/api/endpoints', payload);
  }

  updateEndpoint(id: number, payload: UpdateEndpointRequest): Observable<ApiResponse<LlmEndpoint>> {
    return this.http.put<ApiResponse<LlmEndpoint>>(`/api/endpoints/${id}`, payload);
  }

  deleteEndpoint(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/endpoints/${id}`);
  }

  getAllEndpointStatuses(): Observable<ApiResponse<EndpointProbeResult[]>> {
    return this.http.get<ApiResponse<EndpointProbeResult[]>>('/api/endpoints/status-all');
  }

  getEndpointStatus(id: number): Observable<ApiResponse<EndpointProbeResult>> {
    return this.http.get<ApiResponse<EndpointProbeResult>>(`/api/endpoints/${id}/status`);
  }

  // System Prompt Presets
  getSystemPrompts(): Observable<ApiResponse<SystemPromptPreset[]>> {
    return this.http.get<ApiResponse<SystemPromptPreset[]>>('/api/prompts');
  }

  createSystemPrompt(payload: CreateSystemPromptRequest): Observable<ApiResponse<SystemPromptPreset>> {
    return this.http.post<ApiResponse<SystemPromptPreset>>('/api/prompts', payload);
  }

  updateSystemPrompt(
    id: number,
    payload: UpdateSystemPromptRequest
  ): Observable<ApiResponse<SystemPromptPreset>> {
    return this.http.put<ApiResponse<SystemPromptPreset>>(`/api/prompts/${id}`, payload);
  }

  deleteSystemPrompt(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/prompts/${id}`);
  }

  // Chat Sessions
  getChatSessions(): Observable<ApiResponse<ChatSession[]>> {
    return this.http.get<ApiResponse<ChatSession[]>>('/api/chats');
  }

  createChatSession(payload: CreateChatSessionRequest = {}): Observable<ApiResponse<ChatSession>> {
    return this.http.post<ApiResponse<ChatSession>>('/api/chats', payload);
  }

  getChatSession(
    id: number
  ): Observable<ApiResponse<{ session: ChatSession; messages: ChatMessage[] }>> {
    return this.http.get<ApiResponse<{ session: ChatSession; messages: ChatMessage[] }>>(
      `/api/chats/${id}`
    );
  }

  updateChatSession(
    id: number,
    payload: UpdateChatSessionRequest
  ): Observable<ApiResponse<ChatSession>> {
    return this.http.patch<ApiResponse<ChatSession>>(`/api/chats/${id}`, payload);
  }

  deleteChatSession(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/chats/${id}`);
  }

  clearChatMessages(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/chats/${id}/messages`);
  }

  // Systemd kron-llama-server (8080)
  getLlamaServiceStatus(): Observable<ApiResponse<SystemdServiceStatus>> {
    return this.http.get<ApiResponse<SystemdServiceStatus>>('/api/systemd/llama/status');
  }

  controlLlamaService(action: 'start' | 'stop' | 'restart'): Observable<ApiResponse<SystemdServiceStatus>> {
    return this.http.post<ApiResponse<SystemdServiceStatus>>(`/api/systemd/llama/${action}`, {});
  }

  getLlamaScriptConfig(): Observable<ApiResponse<LlamaScriptConfig>> {
    return this.http.get<ApiResponse<LlamaScriptConfig>>('/api/systemd/llama/config');
  }

  updateLlamaScriptConfig(
    payload: { modelName: string; modelQuant: string; modelCtx: number; isMtp: IsMtpMode },
    restart = false
  ): Observable<ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>> {
    const query = restart ? '?restart=true' : '';
    return this.http.put<ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>>(
      `/api/systemd/llama/config${query}`,
      payload
    );
  }

  connectLlamaLogs(
    lines: number,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
    onError?: () => void
  ): EventSource {
    const source = new EventSource(`/api/systemd/llama/logs?lines=${lines}`);
    source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { line: string; stream: 'stdout' | 'stderr' };
        onLine(parsed.line, parsed.stream);
      } catch {
        // ignore
      }
    };
    source.onerror = () => {
      if (onError) onError();
    };
    return source;
  }

  // Saved Model Presets
  getModelPresets(): Observable<ApiResponse<ModelPreset[]>> {
    return this.http.get<ApiResponse<ModelPreset[]>>('/api/presets/models');
  }

  createModelPreset(payload: CreateModelPresetRequest): Observable<ApiResponse<ModelPreset>> {
    return this.http.post<ApiResponse<ModelPreset>>('/api/presets/models', payload);
  }

  updateModelPreset(
    id: number,
    payload: UpdateModelPresetRequest
  ): Observable<ApiResponse<ModelPreset>> {
    return this.http.put<ApiResponse<ModelPreset>>(`/api/presets/models/${id}`, payload);
  }

  deleteModelPreset(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`/api/presets/models/${id}`);
  }

  applyModelPreset(
    id: number,
    restart = false
  ): Observable<ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>> {
    const query = restart ? '?restart=true' : '';
    return this.http.post<ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>>(
      `/api/presets/models/${id}/apply${query}`,
      {}
    );
  }

  // Read-only Port 8081 Container Inspector & Persistent Launcher
  getPort8081Containers(): Observable<ApiResponse<ContainerInfo[]>> {
    return this.http.get<ApiResponse<ContainerInfo[]>>('/api/containers/port-8081');
  }

  transformContainerCommand(
    payload: TransformContainerCommandRequest
  ): Observable<ApiResponse<TransformContainerCommandResult>> {
    return this.http.post<ApiResponse<TransformContainerCommandResult>>(
      '/api/containers/transform',
      payload
    );
  }

  launchPersistentContainer(
    payload: TransformContainerCommandRequest
  ): Observable<ApiResponse<LaunchPersistentContainerResponse>> {
    return this.http.post<ApiResponse<LaunchPersistentContainerResponse>>(
      '/api/containers/launch-persistent',
      payload
    );
  }

  connectContainerLogs(
    runtime: 'podman' | 'docker',
    id: string,
    lines: number,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
    onError?: () => void
  ): EventSource {
    const source = new EventSource(
      `/api/containers/${encodeURIComponent(runtime)}/${encodeURIComponent(id)}/logs?lines=${lines}`
    );
    source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as { line: string; stream: 'stdout' | 'stderr' };
        onLine(parsed.line, parsed.stream);
      } catch {
        // ignore
      }
    };
    source.onerror = () => {
      if (onError) onError();
    };
    return source;
  }

  // Streaming Chat Proxy (SSE over POST)
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
}
