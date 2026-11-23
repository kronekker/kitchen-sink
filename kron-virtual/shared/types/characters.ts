export interface Character {
  id: number;
  name: string;
  tagline: string;
  description: string;
  personality: string;
  speechPatterns: string;
  scenario: string;
  firstMessage: string;
  exampleDialogue: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  name: string;
  tagline?: string;
  description?: string;
  personality?: string;
  speechPatterns?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogue?: string;
}

export interface UpdateCharacterRequest {
  name?: string;
  tagline?: string;
  description?: string;
  personality?: string;
  speechPatterns?: string;
  scenario?: string;
  firstMessage?: string;
  exampleDialogue?: string;
}
