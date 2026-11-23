import { InferenceParams } from '@shared/index';
import { db, sqlite } from './index';
import { characters, personas, rpStyles } from './schema';

export const DEFAULT_RP_DIRECTIVES =
  'Write in first-person limited, present tense. Stay strictly in character as {{char}}. ' +
  "React naturally to {{user}}'s actions and dialogue without summarizing their actions or speaking for them. " +
  'Keep narration grounded, concrete, and true to the established scene.';

export const DEFAULT_SUGGEST_PROMPT =
  "Write the next single in-character reply from {{user}}'s first-person perspective, responding naturally to {{char}}'s last message. " +
  "Match {{user}}'s established persona, tone, and formatting. " +
  "Output ONLY {{user}}'s dialogue and action beats — no preamble, no speaker label, and do not write for {{char}}.";

export const DEFAULT_INFERENCE_PARAMS: InferenceParams = {
  temperature: 0.85,
  top_p: 0.95,
  min_p: 0.05,
};

export function initializeDatabase(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      personality TEXT NOT NULL DEFAULT '',
      speech_patterns TEXT NOT NULL DEFAULT '',
      scenario TEXT NOT NULL DEFAULT '',
      first_message TEXT NOT NULL DEFAULT '',
      example_dialogue TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      background TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rp_styles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      directives TEXT NOT NULL DEFAULT '',
      scenario_override TEXT NOT NULL DEFAULT '',
      scene_note TEXT NOT NULL DEFAULT '',
      cadence_reminder TEXT NOT NULL DEFAULT '',
      suggest_prompt TEXT NOT NULL DEFAULT '',
      params_json TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rp_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      directives TEXT NOT NULL DEFAULT '',
      scenario_override TEXT NOT NULL DEFAULT '',
      scene_note TEXT NOT NULL DEFAULT '',
      cadence_reminder TEXT NOT NULL DEFAULT '',
      suggest_prompt TEXT NOT NULL DEFAULT '',
      params_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES rp_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning_content TEXT,
      system_prompt TEXT,
      model_id TEXT,
      engine_label TEXT,
      metrics_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rp_messages_session_id ON rp_messages(session_id);
  `);

  // Safe additive migrations for existing SQLite databases
  const msgCols = sqlite.prepare(`PRAGMA table_info(rp_messages)`).all() as Array<{ name: string }>;
  if (!msgCols.some((c) => c.name === 'system_prompt')) {
    sqlite.exec(`ALTER TABLE rp_messages ADD COLUMN system_prompt TEXT;`);
  }

  const personaCols = sqlite.prepare(`PRAGMA table_info(personas)`).all() as Array<{ name: string }>;
  if (!personaCols.some((c) => c.name === 'tagline')) {
    sqlite.exec(`ALTER TABLE personas ADD COLUMN tagline TEXT NOT NULL DEFAULT '';`);
    sqlite.exec(
      `UPDATE personas SET tagline = 'Resourceful docks-district courier' WHERE name = 'Kael' AND tagline = '';`
    );
  }

  const styleCols = sqlite.prepare(`PRAGMA table_info(rp_styles)`).all() as Array<{ name: string }>;
  if (!styleCols.some((c) => c.name === 'suggest_prompt')) {
    sqlite.exec(`ALTER TABLE rp_styles ADD COLUMN suggest_prompt TEXT NOT NULL DEFAULT '';`);
    sqlite
      .prepare(`UPDATE rp_styles SET suggest_prompt = ? WHERE suggest_prompt = ''`)
      .run(DEFAULT_SUGGEST_PROMPT);
  }

  const sessionCols = sqlite.prepare(`PRAGMA table_info(rp_sessions)`).all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === 'suggest_prompt')) {
    sqlite.exec(`ALTER TABLE rp_sessions ADD COLUMN suggest_prompt TEXT NOT NULL DEFAULT '';`);
    sqlite
      .prepare(`UPDATE rp_sessions SET suggest_prompt = ? WHERE suggest_prompt = ''`)
      .run(DEFAULT_SUGGEST_PROMPT);
  }

  const now = new Date().toISOString();

  const existingChars = db.select({ id: characters.id }).from(characters).limit(1).all();
  if (existingChars.length === 0) {
    db.insert(characters)
      .values({
        name: 'Vex',
        tagline: 'Pragmatic dockside fixer with a dry sense of humor',
        description:
          'A lean, sharp-eyed fixer in her late twenties who operates out of a rain-streaked warehouse office near the harbor docks. She wears a weathered oilskin coat, keeps a brass-hilted utility knife within reach, and always checks the latches before sitting down.',
        personality:
          'Guarded, observant, fiercely pragmatic, and darkly witty. Slow to trust, quick to notice exits and inconsistencies, yet fiercely loyal once a debt is earned.',
        speechPatterns:
          'Clipped, grounded dialogue with dry understatements and short physical action beats. Avoids melodrama or long monologues.',
        scenario:
          'Late evening in a dimly lit backroom overlooking the wet docks. Rain taps steadily against the frosted glass while harbor fog rolls in.',
        firstMessage:
          '*Vex slides the heavy iron bolt across the warehouse door and turns back toward {{user}}, wiping rain from her sleeves.* "You\'re five minutes late, {{user}}, and the harbor watch just doubled the patrol on the east pier. Tell me you actually brought what we talked about."',
        exampleDialogue:
          '{{user}}: "You\'re late."\n{{char}}: *She doesn\'t look up from checking the latch.* "And you\'re still breathing. Priorities."\n\n{{user}}: "Do you trust the informant?"\n{{char}}: *Vex taps the edge of the ledger with one knuckle.* "I trust people who want to get paid. Anything beyond that is bad math."',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const existingPersonas = db.select({ id: personas.id }).from(personas).limit(1).all();
  if (existingPersonas.length === 0) {
    db.insert(personas)
      .values({
        name: 'Kael',
        tagline: 'Resourceful docks-district courier',
        description:
          'A resourceful courier who knows the back alleys of the docks district better than the city guard does. Calm under pressure with a habit of keeping his coat collar turned up against the rain.',
        background:
          'Has worked a handful of off-the-books jobs with local fixers over the past year. Keeps things strictly professional, though old favors have a way of resurfacing.',
        isDefault: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const existingStyles = db.select({ id: rpStyles.id }).from(rpStyles).limit(1).all();
  if (existingStyles.length === 0) {
    const starterStyles = [
      {
        name: 'Grounded Realism',
        description:
          'Balanced third-person RP with natural dialogue, short physical action beats, and DRY anti-repetition sampling.',
        directives: DEFAULT_RP_DIRECTIVES,
        scenarioOverride: '',
        sceneNote: 'Keep reactions grounded in immediate sensory details and character motivations.',
        cadenceReminder:
          'Write grounded dialogue paired with brief, concrete action beats. Keep replies to 2-3 focused paragraphs.',
        params: {
          temperature: 0.85,
          top_p: 0.95,
          min_p: 0.05,
          dry_multiplier: 0.8,
          dry_base: 1.75,
          dry_allowed_length: 2,
        },
        isDefault: 1,
      },
      {
        name: 'Cinematic Noir / High Tension',
        description:
          'Taut, atmospheric pacing with clipped dialogue, subtext, and heightened stakes.',
        directives:
          'Write in first-person limited, present tense with a taut, noir-inflected voice. Stay strictly in character as {{char}}. ' +
          'Never narrate {{user}}\'s thoughts or actions. Favor subtext, body language, and sharp environmental details.',
        scenarioOverride: '',
        sceneNote: 'Tone: tense, watchful, rain-slicked atmosphere. Every line of dialogue should carry subtext.',
        cadenceReminder:
          'Use crisp sentences, vivid sensory anchors, and restrained emotional tells. End on a beat that invites {{user}} to react.',
        params: {
          temperature: 0.9,
          top_p: 0.95,
          min_p: 0.06,
          dry_multiplier: 0.8,
          dry_base: 1.75,
          dry_allowed_length: 2,
        },
        isDefault: 0,
      },
      {
        name: 'Literary & Descriptive',
        description:
          'Richer prose, deeper atmosphere, and expressive pacing for slower, novel-style scenes.',
        directives:
          'Write in evocative third-person limited, past tense. Stay strictly in character as {{char}}, giving attention to setting, mood, and subtle internal reactions. ' +
          'Never speak for {{user}} or advance their actions without permission.',
        scenarioOverride: '',
        sceneNote: 'Pacing: unhurried and immersive. Let the environment and unspoken tension breathe.',
        cadenceReminder:
          'Blend natural spoken dialogue with layered, tactile prose. Vary sentence length and avoid repetitive phrasing.',
        params: {
          temperature: 0.95,
          top_p: 0.95,
          min_p: 0.05,
          dry_multiplier: 0.9,
          dry_base: 1.75,
          dry_allowed_length: 2,
        },
        isDefault: 0,
      },
      {
        name: 'Snappy Dialogue-First',
        description:
          'Fast back-and-forth banter with minimal narration — great for lively conversations and quick pacing.',
        directives:
          'Write in first-person limited, present tense. Stay strictly in character as {{char}}. ' +
          'Prioritize quick, natural spoken dialogue over long descriptive paragraphs. Never speak for {{user}}.',
        scenarioOverride: '',
        sceneNote: 'Pacing: brisk, conversational, high back-and-forth energy.',
        cadenceReminder:
          'Keep replies punchy (1-2 short paragraphs). Lead with dialogue and minimal stage direction.',
        params: {
          temperature: 0.8,
          top_p: 0.92,
          min_p: 0.05,
          max_tokens: 280,
          dry_multiplier: 0.6,
          dry_base: 1.75,
          dry_allowed_length: 2,
        },
        isDefault: 0,
      },
    ];

    for (const s of starterStyles) {
      db.insert(rpStyles)
        .values({
          name: s.name,
          description: s.description,
          directives: s.directives,
          scenarioOverride: s.scenarioOverride,
          sceneNote: s.sceneNote,
          cadenceReminder: s.cadenceReminder,
          suggestPrompt: DEFAULT_SUGGEST_PROMPT,
          paramsJson: JSON.stringify(s.params),
          isDefault: s.isDefault,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }
}
