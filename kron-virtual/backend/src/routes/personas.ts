import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { personas } from '../db/schema';
import { ApiResponse, CreatePersonaRequest, Persona, UpdatePersonaRequest } from '@shared/index';

const router = Router();

export function toPersonaDto(row: typeof personas.$inferSelect): Persona {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    background: row.background,
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/personas
router.get('/', (_req: Request, res: Response) => {
  const rows = db
    .select()
    .from(personas)
    .orderBy(desc(personas.isDefault), desc(personas.updatedAt))
    .all();
  const response: ApiResponse<Persona[]> = {
    success: true,
    data: rows.map(toPersonaDto),
  };
  res.json(response);
});

// GET /api/personas/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid persona ID.' });
    return;
  }
  const row = db.select().from(personas).where(eq(personas.id, id)).get();
  if (!row) {
    res.status(404).json({ success: false, error: 'Persona not found.' });
    return;
  }
  const response: ApiResponse<Persona> = {
    success: true,
    data: toPersonaDto(row),
  };
  res.json(response);
});

// POST /api/personas
router.post('/', (req: Request, res: Response) => {
  const body: CreatePersonaRequest = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ success: false, error: 'Persona name is required.' });
    return;
  }

  const isDefault = Boolean(body.isDefault);
  if (isDefault) {
    db.update(personas).set({ isDefault: 0 }).run();
  }

  const now = new Date().toISOString();
  const created = db
    .insert(personas)
    .values({
      name,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() : '',
      description: typeof body.description === 'string' ? body.description.trim() : '',
      background: typeof body.background === 'string' ? body.background.trim() : '',
      isDefault: isDefault ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const response: ApiResponse<Persona> = {
    success: true,
    data: toPersonaDto(created),
  };
  res.status(201).json(response);
});

// PUT /api/personas/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid persona ID.' });
    return;
  }

  const existing = db.select().from(personas).where(eq(personas.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Persona not found.' });
    return;
  }

  const body: UpdatePersonaRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ success: false, error: 'Persona name cannot be empty.' });
    return;
  }

  const nextDefault = body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.isDefault;
  if (nextDefault === 1) {
    db.update(personas).set({ isDefault: 0 }).run();
  }

  const now = new Date().toISOString();
  const updated = db
    .update(personas)
    .set({
      name: nextName,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() : existing.tagline,
      description: typeof body.description === 'string' ? body.description.trim() : existing.description,
      background: typeof body.background === 'string' ? body.background.trim() : existing.background,
      isDefault: nextDefault,
      updatedAt: now,
    })
    .where(eq(personas.id, id))
    .returning()
    .get();

  const response: ApiResponse<Persona> = {
    success: true,
    data: toPersonaDto(updated),
  };
  res.json(response);
});

// DELETE /api/personas/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid persona ID.' });
    return;
  }
  const deleted = db.delete(personas).where(eq(personas.id, id)).returning().get();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Persona not found.' });
    return;
  }
  res.json({ success: true });
});

export default router;
