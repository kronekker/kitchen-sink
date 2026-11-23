import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  personality: text('personality').notNull().default(''),
  speechPatterns: text('speech_patterns').notNull().default(''),
  scenario: text('scenario').notNull().default(''),
  firstMessage: text('first_message').notNull().default(''),
  exampleDialogue: text('example_dialogue').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const personas = sqliteTable('personas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tagline: text('tagline').notNull().default(''),
  description: text('description').notNull().default(''),
  background: text('background').notNull().default(''),
  isDefault: integer('is_default').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const rpStyles = sqliteTable('rp_styles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  directives: text('directives').notNull().default(''),
  scenarioOverride: text('scenario_override').notNull().default(''),
  sceneNote: text('scene_note').notNull().default(''),
  cadenceReminder: text('cadence_reminder').notNull().default(''),
  suggestPrompt: text('suggest_prompt').notNull().default(''),
  paramsJson: text('params_json').notNull().default('{}'),
  isDefault: integer('is_default').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const rpSessions = sqliteTable('rp_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  characterId: integer('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  personaId: integer('persona_id')
    .notNull()
    .references(() => personas.id, { onDelete: 'cascade' }),
  directives: text('directives').notNull().default(''),
  scenarioOverride: text('scenario_override').notNull().default(''),
  sceneNote: text('scene_note').notNull().default(''),
  cadenceReminder: text('cadence_reminder').notNull().default(''),
  suggestPrompt: text('suggest_prompt').notNull().default(''),
  paramsJson: text('params_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const rpMessages = sqliteTable('rp_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => rpSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  reasoningContent: text('reasoning_content'),
  systemPrompt: text('system_prompt'),
  modelId: text('model_id'),
  engineLabel: text('engine_label'),
  metricsJson: text('metrics_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
