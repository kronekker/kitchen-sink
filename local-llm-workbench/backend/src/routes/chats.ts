import { Router, Request, Response } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { chatMessages, chatSessions, systemPrompts } from '../db/schema';
import {
  ApiResponse,
  ChatMessage,
  ChatMetrics,
  ChatRole,
  ChatSession,
  CreateChatSessionRequest,
  InferenceParams,
  UpdateChatSessionRequest,
} from '@shared/index';

const router = Router();

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toSessionDto(row: typeof chatSessions.$inferSelect): ChatSession {
  return {
    id: row.id,
    title: row.title,
    endpointId: row.endpointId ?? null,
    modelId: row.modelId ?? null,
    systemPrompt: row.systemPrompt,
    params: safeParseJson<InferenceParams>(row.paramsJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMessageDto(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as ChatRole,
    content: row.content,
    reasoningContent: row.reasoningContent ?? null,
    modelId: row.modelId ?? null,
    endpointName: row.endpointName ?? null,
    metrics: safeParseJson<ChatMetrics | null>(row.metricsJson, null),
    createdAt: row.createdAt,
  };
}

// GET /api/chats
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .select()
      .from(chatSessions)
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.id))
      .all();

    res.json({ success: true, data: rows.map(toSessionDto) } satisfies ApiResponse<ChatSession[]>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/chats
router.post('/', (req: Request, res: Response) => {
  const body: CreateChatSessionRequest = req.body ?? {};
  const now = new Date().toISOString();

  let defaultPrompt = '';
  if (body.systemPrompt === undefined) {
    const def = db.select().from(systemPrompts).where(eq(systemPrompts.isDefault, true)).get();
    defaultPrompt = def?.content ?? '';
  } else {
    defaultPrompt = body.systemPrompt;
  }

  try {
    const inserted = db
      .insert(chatSessions)
      .values({
        title: (body.title?.trim() || 'New Chat').slice(0, 120),
        endpointId: body.endpointId ?? null,
        modelId: body.modelId ?? null,
        systemPrompt: defaultPrompt,
        paramsJson: JSON.stringify(body.params ?? {}),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    res.status(201).json({ success: true, data: toSessionDto(inserted) } satisfies ApiResponse<ChatSession>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// GET /api/chats/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    const session = db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
    if (!session) {
      res.status(404).json({ success: false, error: 'Chat session not found.' } satisfies ApiResponse<never>);
      return;
    }

    const messages = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(asc(chatMessages.id))
      .all();

    res.json({
      success: true,
      data: {
        session: toSessionDto(session),
        messages: messages.map(toMessageDto),
      },
    } satisfies ApiResponse<{ session: ChatSession; messages: ChatMessage[] }>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// PATCH /api/chats/:id
router.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Chat session not found.' } satisfies ApiResponse<never>);
    return;
  }

  const body: UpdateChatSessionRequest = req.body ?? {};
  try {
    const updated = db
      .update(chatSessions)
      .set({
        title: body.title !== undefined ? (body.title.trim() || 'New Chat').slice(0, 120) : existing.title,
        endpointId: body.endpointId !== undefined ? body.endpointId : existing.endpointId,
        modelId: body.modelId !== undefined ? body.modelId : existing.modelId,
        systemPrompt: body.systemPrompt !== undefined ? body.systemPrompt : existing.systemPrompt,
        paramsJson: body.params !== undefined ? JSON.stringify(body.params) : existing.paramsJson,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(chatSessions.id, id))
      .returning()
      .get();

    res.json({ success: true, data: toSessionDto(updated) } satisfies ApiResponse<ChatSession>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// DELETE /api/chats/:id/messages
router.delete('/:id/messages', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    db.delete(chatMessages).where(eq(chatMessages.sessionId, id)).run();
    db.update(chatSessions)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(chatSessions.id, id))
      .run();
    res.json({ success: true } satisfies ApiResponse<void>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// DELETE /api/chats/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid session ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Chat session not found.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    db.delete(chatSessions).where(eq(chatSessions.id, id)).run();
    res.json({ success: true } satisfies ApiResponse<void>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

export default router;
