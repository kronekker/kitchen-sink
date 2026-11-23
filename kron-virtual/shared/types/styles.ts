import { InferenceParams } from './sessions';

export interface RpStyle {
  id: number;
  name: string;
  description: string;
  directives: string;
  scenarioOverride: string;
  sceneNote: string;
  cadenceReminder: string;
  suggestPrompt: string;
  params: InferenceParams;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStyleRequest {
  name: string;
  description?: string;
  directives?: string;
  scenarioOverride?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  suggestPrompt?: string;
  params?: InferenceParams;
  isDefault?: boolean;
}

export interface UpdateStyleRequest {
  name?: string;
  description?: string;
  directives?: string;
  scenarioOverride?: string;
  sceneNote?: string;
  cadenceReminder?: string;
  suggestPrompt?: string;
  params?: InferenceParams;
  isDefault?: boolean;
}
