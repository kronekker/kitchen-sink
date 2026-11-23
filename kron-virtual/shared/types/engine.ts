export type EngineConnectionState = 'online' | 'loading' | 'offline';

export interface EngineModelInfo {
  id: string;
  ownedBy?: string;
}

export interface ActiveEngineStatus {
  status: EngineConnectionState;
  port: number | null;
  label: string | null;
  baseUrl: string | null;
  activeModel: string | null;
  models: EngineModelInfo[];
  latencyMs: number | null;
  error?: string;
  checkedAt: string;
}
