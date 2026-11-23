import { Router, Request, Response } from 'express';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { DEFAULT_INFERENCE_PARAMS, DEFAULT_RP_DIRECTIVES, DEFAULT_SUGGEST_PROMPT } from '../db/init';
import { characters, personas, rpMessages, rpSessions, rpStyles } from '../db/schema';
import {
  ApiResponse,
  ChatMetrics,
  CreateSessionRequest,
  InferenceParams,
  PromptPreview,
  RpMessage,
  RpSession,
  RpSessionDetail,
  RpSessionSummary,
  UpdateSessionRequest,
} from '@shared/index';
import { toCharacterDto } from './characters';
import { toPersonaDto } from './personas';
import { assemblePrompt, replacePlaceholders } from '../services/prompt-assembler';

const router = Router();

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toSessionDto(row: typeof rpSessions.$inferSelect): RpSession {
  return {
    id: row.id,
    title: row.title,
    characterId: row.characterId,
    personaId: row.personaId,
    directives: row.directives,
    scenarioOverride: row.scenarioOverride,
    sceneNote: row.sceneNote,
    cadenceReminder: row.cadenceReminder,
    suggestPrompt: row.suggestPrompt || DEFAULT_SUGGEST_PROMPT,
    params: safeParseJson<InferenceParams>(row.paramsJson, DEFAULT_INFERENCE_PARAMS),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMessageDto(row: typeof rpMessages.$inferSelect): RpMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content,
    reasoningContent: row.reasoningContent ?? null,
    systemPrompt: row.systemPrompt ?? null,
    modelId: row.modelId ?? null,
    engineLabel: row.engineLabel ?? null,
    metrics: safeParseJson<ChatMetrics | null>(row.metricsJson, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/sessions
router.get('/', (_req: Request, res: Response) => {
  const rows = db.select().from(rpSessions).orderBy(desc(rpSessions.updatedAt)).all();
  const charRows = db.select().from(characters).all();
  const personaRows = db.select().from(personas).all();
  const counts = db
    .select({
      sessionId: rpMessages.sessionId,
      count: sql<number>`count(*)`,
    })
    .from(rpMessages)
    .groupBy(rpMessages.sessionId)
    .all();

  const charMap = new Map(charRows.map((c) => [c.id, c]));
  const personaMap = new Map(personaRows.map((p) => [p.id, p]));
  const countMap = new Map(counts.map((c) => [c.sessionId, Number(c.count)]));

  const summaries: RpSessionSummary[] = rows.map((row) => {
    const ch = charMap.get(row.characterId);
    const pe = personaMap.get(row.personaId);
    return {
      ...toSessionDto(row),
      characterName: ch?.name ?? 'Unknown Character',
      characterTagline: ch?.tagline ?? '',
      personaName: pe?.name ?? 'Unknown Persona',
      personaTagline: pe?.tagline ?? '',
      messageCount: countMap.get(row.id) ?? 0,
    };
  });

  const response: ApiResponse<RpSessionSummary[]> = {
    success: true,
    data: summaries,
  };
  res.json(response);
});

// POST /api/sessions
router.post('/', (req: Request, res: Response) => {
  const body: CreateSessionRequest = req.body ?? ({} as CreateSessionRequest);
  const characterId = Number(body.characterId);
  const personaId = Number(body.personaId);

  if (!Number.isInteger(characterId) || !Number.isInteger(personaId)) {
    res.status(400).json({ success: false, error: 'Valid characterId and personaId are required.' });
    return;
  }

  const charRow = db.select().from(characters).where(eq(characters.id, characterId)).get();
  if (!charRow) {
    res.status(404).json({ success: false, error: 'Character not found.' });
    return;
  }

  const personaRow = db.select().from(personas).where(eq(personas.id, personaId)).get();
  if (!personaRow) {
    res.status(404).json({ success: false, error: 'Persona not found.' });
    return;
  }

  const now = new Date().toISOString();
  const title =
    typeof body.title === 'string' && body.title.trim().length > 0
      ? body.title.trim()
      : `${charRow.name} & ${personaRow.name}`;

  // Optional Style preset lookup
  let styleRow: typeof rpStyles.$inferSelect | undefined;
  if (body.styleId !== undefined && body.styleId !== null) {
    const styleIdNum = Number(body.styleId);
    if (Number.isInteger(styleIdNum)) {
      styleRow = db.select().from(rpStyles).where(eq(rpStyles.id, styleIdNum)).get();
    }
  }

  const styleParams = styleRow
    ? safeParseJson<InferenceParams>(styleRow.paramsJson, DEFAULT_INFERENCE_PARAMS)
    : DEFAULT_INFERENCE_PARAMS;

  const directives =
    typeof body.directives === 'string'
      ? body.directives
      : styleRow?.directives || DEFAULT_RP_DIRECTIVES;
  const scenarioOverride =
    typeof body.scenarioOverride === 'string'
      ? body.scenarioOverride
      : styleRow?.scenarioOverride || '';
  const sceneNote =
    typeof body.sceneNote === 'string' ? body.sceneNote : styleRow?.sceneNote || '';
  const cadenceReminder =
    typeof body.cadenceReminder === 'string'
      ? body.cadenceReminder
      : styleRow?.cadenceReminder || '';
  const suggestPrompt =
    typeof body.suggestPrompt === 'string' && body.suggestPrompt.trim()
      ? body.suggestPrompt.trim()
      : styleRow?.suggestPrompt || DEFAULT_SUGGEST_PROMPT;
  const params: InferenceParams = { ...styleParams, ...(body.params ?? {}) };

  const created = db
    .insert(rpSessions)
    .values({
      title,
      characterId,
      personaId,
      directives,
      scenarioOverride,
      sceneNote,
      cadenceReminder,
      suggestPrompt,
      paramsJson: JSON.stringify(params),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const messages: RpMessage[] = [];
  if (charRow.firstMessage.trim().length > 0) {
    const greeting = replacePlaceholders(charRow.firstMessage.trim(), charRow.name, personaRow.name);
    const savedGreeting = db
      .insert(rpMessages)
      .values({
        sessionId: created.id,
        role: 'assistant',
        content: greeting,
        reasoningContent: null,
        modelId: null,
        engineLabel: 'Opening Greeting',
        metricsJson: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    messages.push(toMessageDto(savedGreeting));
  }

  const response: ApiResponse<RpSessionDetail> = {
    success: true,
    data: {
      session: toSessionDto(created),
      character: toCharacterDto(charRow),
      persona: toPersonaDto(personaRow),
      messages,
    },
  };
  res.status(201).json(response);
});

// GET /api/sessions/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' });
    return;
  }

  const sessionRow = db.select().from(rpSessions).where(eq(rpSessions.id, id)).get();
  if (!sessionRow) {
    res.status(404).json({ success: false, error: 'Session not found.' });
    return;
  }

  const charRow = db.select().from(characters).where(eq(characters.id, sessionRow.characterId)).get();
  const personaRow = db.select().from(personas).where(eq(personas.id, sessionRow.personaId)).get();
  if (!charRow || !personaRow) {
    res.status(404).json({ success: false, error: 'Session character or persona not found.' });
    return;
  }

  const msgRows = db
    .select()
    .from(rpMessages)
    .where(eq(rpMessages.sessionId, id))
    .orderBy(asc(rpMessages.id))
    .all();

  const response: ApiResponse<RpSessionDetail> = {
    success: true,
    data: {
      session: toSessionDto(sessionRow),
      character: toCharacterDto(charRow),
      persona: toPersonaDto(personaRow),
      messages: msgRows.map(toMessageDto),
    },
  };
  res.json(response);
});

// PATCH /api/sessions/:id
router.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' });
    return;
  }

  const existing = db.select().from(rpSessions).where(eq(rpSessions.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Session not found.' });
    return;
  }

  const body: UpdateSessionRequest = req.body ?? {};
  const now = new Date().toISOString();

  const updated = db
    .update(rpSessions)
    .set({
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title,
      directives: typeof body.directives === 'string' ? body.directives : existing.directives,
      scenarioOverride:
        typeof body.scenarioOverride === 'string' ? body.scenarioOverride : existing.scenarioOverride,
      sceneNote: typeof body.sceneNote === 'string' ? body.sceneNote : existing.sceneNote,
      cadenceReminder:
        typeof body.cadenceReminder === 'string' ? body.cadenceReminder : existing.cadenceReminder,
      suggestPrompt:
        typeof body.suggestPrompt === 'string' ? body.suggestPrompt : existing.suggestPrompt,
      paramsJson: body.params !== undefined ? JSON.stringify(body.params) : existing.paramsJson,
      updatedAt: now,
    })
    .where(eq(rpSessions.id, id))
    .returning()
    .get();

  const response: ApiResponse<RpSession> = {
    success: true,
    data: toSessionDto(updated),
  };
  res.json(response);
});

// DELETE /api/sessions/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' });
    return;
  }
  const deleted = db.delete(rpSessions).where(eq(rpSessions.id, id)).returning().get();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Session not found.' });
    return;
  }
  res.json({ success: true });
});

// DELETE /api/sessions/:id/messages
router.delete('/:id/messages', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' });
    return;
  }

  const sessionRow = db.select().from(rpSessions).where(eq(rpSessions.id, id)).get();
  if (!sessionRow) {
    res.status(404).json({ success: false, error: 'Session not found.' });
    return;
  }

  db.delete(rpMessages).where(eq(rpMessages.sessionId, id)).run();

  const reseed = req.query['reseed'] === 'true' || req.query['reseed'] === '1';
  const messages: RpMessage[] = [];
  const now = new Date().toISOString();

  if (reseed) {
    const charRow = db.select().from(characters).where(eq(characters.id, sessionRow.characterId)).get();
    const personaRow = db.select().from(personas).where(eq(personas.id, sessionRow.personaId)).get();
    if (charRow && personaRow && charRow.firstMessage.trim().length > 0) {
      const greeting = replacePlaceholders(charRow.firstMessage.trim(), charRow.name, personaRow.name);
      const savedGreeting = db
        .insert(rpMessages)
        .values({
          sessionId: id,
          role: 'assistant',
          content: greeting,
          reasoningContent: null,
          modelId: null,
          engineLabel: 'Opening Greeting',
          metricsJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      messages.push(toMessageDto(savedGreeting));
    }
  }

  db.update(rpSessions).set({ updatedAt: now }).where(eq(rpSessions.id, id)).run();

  const response: ApiResponse<RpMessage[]> = {
    success: true,
    data: messages,
  };
  res.json(response);
});

// GET /api/sessions/:id/prompt-preview
router.get('/:id/prompt-preview', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' });
    return;
  }

  const sessionRow = db.select().from(rpSessions).where(eq(rpSessions.id, id)).get();
  if (!sessionRow) {
    res.status(404).json({ success: false, error: 'Session not found.' });
    return;
  }

  const charRow = db.select().from(characters).where(eq(characters.id, sessionRow.characterId)).get();
  const personaRow = db.select().from(personas).where(eq(personas.id, sessionRow.personaId)).get();
  if (!charRow || !personaRow) {
    res.status(404).json({ success: false, error: 'Session character or persona not found.' });
    return;
  }

  const msgRows = db
    .select()
    .from(rpMessages)
    .where(eq(rpMessages.sessionId, id))
    .orderBy(asc(rpMessages.id))
    .all();

  const preview: PromptPreview = assemblePrompt({
    session: toSessionDto(sessionRow),
    character: toCharacterDto(charRow),
    persona: toPersonaDto(personaRow),
    history: msgRows.map(toMessageDto),
  });

  const response: ApiResponse<PromptPreview> = {
    success: true,
    data: preview,
  };
  res.json(response);
});

export default router;
