import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { DEFAULT_INFERENCE_PARAMS, DEFAULT_SUGGEST_PROMPT } from '../db/init';
import { rpStyles } from '../db/schema';
import {
  ApiResponse,
  CreateStyleRequest,
  InferenceParams,
  RpStyle,
  UpdateStyleRequest,
} from '@shared/index';

const router = Router();

function safeParseParams(raw: string | null | undefined): InferenceParams {
  if (!raw) return { ...DEFAULT_INFERENCE_PARAMS };
  try {
    return JSON.parse(raw) as InferenceParams;
  } catch {
    return { ...DEFAULT_INFERENCE_PARAMS };
  }
}

export function toStyleDto(row: typeof rpStyles.$inferSelect): RpStyle {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    directives: row.directives,
    scenarioOverride: row.scenarioOverride,
    sceneNote: row.sceneNote,
    cadenceReminder: row.cadenceReminder,
    suggestPrompt: row.suggestPrompt || DEFAULT_SUGGEST_PROMPT,
    params: safeParseParams(row.paramsJson),
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/styles
router.get('/', (_req: Request, res: Response) => {
  const rows = db
    .select()
    .from(rpStyles)
    .orderBy(desc(rpStyles.isDefault), desc(rpStyles.updatedAt))
    .all();
  const response: ApiResponse<RpStyle[]> = {
    success: true,
    data: rows.map(toStyleDto),
  };
  res.json(response);
});

// GET /api/styles/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid style ID.' });
    return;
  }
  const row = db.select().from(rpStyles).where(eq(rpStyles.id, id)).get();
  if (!row) {
    res.status(404).json({ success: false, error: 'Style not found.' });
    return;
  }
  const response: ApiResponse<RpStyle> = {
    success: true,
    data: toStyleDto(row),
  };
  res.json(response);
});

// POST /api/styles
router.post('/', (req: Request, res: Response) => {
  const body: CreateStyleRequest = req.body ?? ({} as CreateStyleRequest);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ success: false, error: 'Style name is required.' });
    return;
  }

  const isDefault = Boolean(body.isDefault);
  if (isDefault) {
    db.update(rpStyles).set({ isDefault: 0 }).run();
  }

  const now = new Date().toISOString();
  const params: InferenceParams = { ...DEFAULT_INFERENCE_PARAMS, ...(body.params ?? {}) };

  const created = db
    .insert(rpStyles)
    .values({
      name,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      directives: typeof body.directives === 'string' ? body.directives.trim() : '',
      scenarioOverride: typeof body.scenarioOverride === 'string' ? body.scenarioOverride.trim() : '',
      sceneNote: typeof body.sceneNote === 'string' ? body.sceneNote.trim() : '',
      cadenceReminder: typeof body.cadenceReminder === 'string' ? body.cadenceReminder.trim() : '',
      suggestPrompt:
        typeof body.suggestPrompt === 'string' && body.suggestPrompt.trim()
          ? body.suggestPrompt.trim()
          : DEFAULT_SUGGEST_PROMPT,
      paramsJson: JSON.stringify(params),
      isDefault: isDefault ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const response: ApiResponse<RpStyle> = {
    success: true,
    data: toStyleDto(created),
  };
  res.status(201).json(response);
});

// PUT /api/styles/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid style ID.' });
    return;
  }

  const existing = db.select().from(rpStyles).where(eq(rpStyles.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Style not found.' });
    return;
  }

  const body: UpdateStyleRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ success: false, error: 'Style name cannot be empty.' });
    return;
  }

  const nextDefault = body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.isDefault;
  if (nextDefault === 1) {
    db.update(rpStyles).set({ isDefault: 0 }).run();
  }

  const now = new Date().toISOString();
  const updated = db
    .update(rpStyles)
    .set({
      name: nextName,
      description:
        typeof body.description === 'string' ? body.description.trim() : existing.description,
      directives: typeof body.directives === 'string' ? body.directives.trim() : existing.directives,
      scenarioOverride:
        typeof body.scenarioOverride === 'string'
          ? body.scenarioOverride.trim()
          : existing.scenarioOverride,
      sceneNote: typeof body.sceneNote === 'string' ? body.sceneNote.trim() : existing.sceneNote,
      cadenceReminder:
        typeof body.cadenceReminder === 'string'
          ? body.cadenceReminder.trim()
          : existing.cadenceReminder,
      suggestPrompt:
        typeof body.suggestPrompt === 'string'
          ? body.suggestPrompt.trim()
          : existing.suggestPrompt,
      paramsJson: body.params !== undefined ? JSON.stringify(body.params) : existing.paramsJson,
      isDefault: nextDefault,
      updatedAt: now,
    })
    .where(eq(rpStyles.id, id))
    .returning()
    .get();

  const response: ApiResponse<RpStyle> = {
    success: true,
    data: toStyleDto(updated),
  };
  res.json(response);
});

// DELETE /api/styles/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid style ID.' });
    return;
  }
  const deleted = db.delete(rpStyles).where(eq(rpStyles.id, id)).returning().get();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Style not found.' });
    return;
  }
  res.json({ success: true });
});

export default router;
