import { Router, Request, Response } from 'express';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { systemPrompts } from '../db/schema';
import {
  ApiResponse,
  CreateSystemPromptRequest,
  SystemPromptPreset,
  UpdateSystemPromptRequest,
} from '@shared/index';

const router = Router();

function toDto(row: typeof systemPrompts.$inferSelect): SystemPromptPreset {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/prompts
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .select()
      .from(systemPrompts)
      .orderBy(desc(systemPrompts.isDefault), asc(systemPrompts.id))
      .all();

    res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<SystemPromptPreset[]>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/prompts
router.post('/', (req: Request, res: Response) => {
  const { name, content, isDefault }: CreateSystemPromptRequest = req.body ?? {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedContent = typeof content === 'string' ? content.trim() : '';

  if (!trimmedName || !trimmedContent) {
    res.status(400).json({
      success: false,
      error: 'Both name and content are required.',
    } satisfies ApiResponse<never>);
    return;
  }

  try {
    const now = new Date().toISOString();
    if (isDefault) {
      db.update(systemPrompts).set({ isDefault: false }).run();
    }

    const inserted = db
      .insert(systemPrompts)
      .values({
        name: trimmedName,
        content: trimmedContent,
        isDefault: Boolean(isDefault),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    res.status(201).json({ success: true, data: toDto(inserted) } satisfies ApiResponse<SystemPromptPreset>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// PUT /api/prompts/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid prompt ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(systemPrompts).where(eq(systemPrompts.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'System prompt preset not found.' } satisfies ApiResponse<never>);
    return;
  }

  const body: UpdateSystemPromptRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  const nextContent = typeof body.content === 'string' ? body.content.trim() : existing.content;
  const nextDefault = body.isDefault === undefined ? Boolean(existing.isDefault) : Boolean(body.isDefault);

  if (!nextName || !nextContent) {
    res.status(400).json({ success: false, error: 'Name and content cannot be empty.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    if (nextDefault) {
      db.update(systemPrompts).set({ isDefault: false }).run();
    }

    const updated = db
      .update(systemPrompts)
      .set({
        name: nextName,
        content: nextContent,
        isDefault: nextDefault,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(systemPrompts.id, id))
      .returning()
      .get();

    res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<SystemPromptPreset>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// DELETE /api/prompts/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid prompt ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(systemPrompts).where(eq(systemPrompts.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'System prompt preset not found.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    db.delete(systemPrompts).where(eq(systemPrompts.id, id)).run();
    res.json({ success: true } satisfies ApiResponse<void>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

export default router;
