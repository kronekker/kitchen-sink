import { count } from 'drizzle-orm';
import { db, sqlite } from './index';
import { endpoints, systemPrompts } from './schema';

export function initializeDatabase(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT,
      is_built_in INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      model_name TEXT NOT NULL,
      model_quant TEXT NOT NULL,
      model_ctx INTEGER NOT NULL,
      is_mtp TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Chat',
      endpoint_id INTEGER REFERENCES endpoints(id) ON DELETE SET NULL,
      model_id TEXT,
      system_prompt TEXT NOT NULL DEFAULT '',
      params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning_content TEXT,
      model_id TEXT,
      endpoint_name TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
  `);

  const now = new Date().toISOString();

  // Seed default built-in endpoints on first run
  const [{ total: endpointCount }] = db.select({ total: count() }).from(endpoints).all();
  if (endpointCount === 0) {
    db.insert(endpoints)
      .values([
        {
          name: 'llama-server (8080)',
          baseUrl: 'http://127.0.0.1:8080',
          apiKey: null,
          isBuiltIn: true,
          sortOrder: 0,
          createdAt: now,
        },
        {
          name: 'ai-toolbox-cockpit (8081)',
          baseUrl: 'http://127.0.0.1:8081',
          apiKey: null,
          isBuiltIn: true,
          sortOrder: 1,
          createdAt: now,
        },
      ])
      .run();
  }

  // Seed default system prompt presets on first run
  const [{ total: promptCount }] = db.select({ total: count() }).from(systemPrompts).all();
  if (promptCount === 0) {
    db.insert(systemPrompts)
      .values([
        {
          name: 'Default Assistant',
          content: 'You are a helpful, accurate, and concise assistant.',
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          name: 'Concise Technical',
          content:
            'You are a senior systems and software engineer. Give direct, technically accurate answers with minimal filler.',
          isDefault: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
  }
}
