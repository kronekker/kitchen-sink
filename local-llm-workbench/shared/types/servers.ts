export interface SystemdServiceStatus {
  unit: string;
  activeState: string;
  subState: string;
  loadState: string;
  mainPid: number | null;
  activeEnterTimestamp: string | null;
  description: string | null;
}

export type IsMtpMode = 'true' | 'false' | 'unknown';

export interface LlamaScriptConfig {
  scriptPath: string;
  modelName: string;
  modelQuant: string;
  modelCtx: number;
  isMtp: IsMtpMode;
}

export interface ModelPreset {
  id: number;
  name: string;
  modelName: string;
  modelQuant: string;
  modelCtx: number;
  isMtp: IsMtpMode;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModelPresetRequest {
  name: string;
  modelName: string;
  modelQuant: string;
  modelCtx: number;
  isMtp: IsMtpMode;
  notes?: string | null;
}

export interface UpdateModelPresetRequest {
  name?: string;
  modelName?: string;
  modelQuant?: string;
  modelCtx?: number;
  isMtp?: IsMtpMode;
  notes?: string | null;
}

export interface ContainerInfo {
  runtime: 'podman' | 'docker';
  id: string;
  name: string;
  image: string;
  imageTitle: string | null;
  state: string;
  status: string;
  ports: string;
  command: string;
  created: string;
}

export type RestartPolicy = 'unless-stopped' | 'always' | 'on-failure' | 'no';

export interface TransformContainerCommandRequest {
  rawCommand: string;
  restartPolicy?: RestartPolicy;
  containerName?: string;
  replaceExisting?: boolean;
}

export interface TransformContainerCommandResult {
  runtime: 'podman' | 'docker';
  args: string[];
  formattedCommand: string;
  containerName: string | null;
  image: string;
  removedFlags: string[];
  addedFlags: string[];
}

export interface LaunchPersistentContainerResponse {
  containerId: string;
  containerName: string | null;
  formattedCommand: string;
  stdout: string;
  stderr: string;
}
