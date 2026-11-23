export interface Persona {
  id: number;
  name: string;
  tagline: string;
  description: string;
  background: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonaRequest {
  name: string;
  tagline?: string;
  description?: string;
  background?: string;
  isDefault?: boolean;
}

export interface UpdatePersonaRequest {
  name?: string;
  tagline?: string;
  description?: string;
  background?: string;
  isDefault?: boolean;
}
