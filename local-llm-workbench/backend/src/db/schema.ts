import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const endpoints = sqliteTable('endpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key'),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const modelPresets = sqliteTable('model_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  modelName: text('model_name').notNull(),
  modelQuant: text('model_quant').notNull(),
  modelCtx: integer('model_ctx').notNull(),
  isMtp: text('is_mtp').notNull().default('unknown'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const systemPrompts = sqliteTable('system_prompts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  content: text('content').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull().default('New Chat'),
  endpointId: integer('endpoint_id').references(() => endpoints.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  systemPrompt: text('system_prompt').notNull().default(''),
  paramsJson: text('params_json').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  reasoningContent: text('reasoning_content'),
  modelId: text('model_id'),
  endpointName: text('endpoint_name'),
  metricsJson: text('metrics_json'),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
