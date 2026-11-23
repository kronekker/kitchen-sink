export interface LlmEndpoint {
  id: number;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  isBuiltIn: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface CreateEndpointRequest {
  name: string;
  baseUrl: string;
  apiKey?: string | null;
}

export interface UpdateEndpointRequest {
  name?: string;
  baseUrl?: string;
  apiKey?: string | null;
}

export interface ModelInfo {
  id: string;
  ownedBy?: string;
}

export type EndpointHealthState = 'online' | 'loading' | 'offline';

export interface EndpointProbeResult {
  endpointId: number;
  name: string;
  baseUrl: string;
  isBuiltIn: boolean;
  status: EndpointHealthState;
  models: ModelInfo[];
  activeModel: string | null;
  latencyMs: number | null;
  checkedAt: string;
  error?: string;
}
