import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { characters } from '../db/schema';
import { ApiResponse, Character, CreateCharacterRequest, UpdateCharacterRequest } from '@shared/index';

const router = Router();

export function toCharacterDto(row: typeof characters.$inferSelect): Character {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    personality: row.personality,
    speechPatterns: row.speechPatterns,
    scenario: row.scenario,
    firstMessage: row.firstMessage,
    exampleDialogue: row.exampleDialogue,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/characters
router.get('/', (_req: Request, res: Response) => {
  const rows = db.select().from(characters).orderBy(desc(characters.updatedAt)).all();
  const response: ApiResponse<Character[]> = {
    success: true,
    data: rows.map(toCharacterDto),
  };
  res.json(response);
});

// GET /api/characters/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid character ID.' });
    return;
  }
  const row = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!row) {
    res.status(404).json({ success: false, error: 'Character not found.' });
    return;
  }
  const response: ApiResponse<Character> = {
    success: true,
    data: toCharacterDto(row),
  };
  res.json(response);
});

// POST /api/characters
router.post('/', (req: Request, res: Response) => {
  const body: CreateCharacterRequest = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ success: false, error: 'Character name is required.' });
    return;
  }

  const now = new Date().toISOString();
  const created = db
    .insert(characters)
    .values({
      name,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() : '',
      description: typeof body.description === 'string' ? body.description.trim() : '',
      personality: typeof body.personality === 'string' ? body.personality.trim() : '',
      speechPatterns: typeof body.speechPatterns === 'string' ? body.speechPatterns.trim() : '',
      scenario: typeof body.scenario === 'string' ? body.scenario.trim() : '',
      firstMessage: typeof body.firstMessage === 'string' ? body.firstMessage.trim() : '',
      exampleDialogue: typeof body.exampleDialogue === 'string' ? body.exampleDialogue.trim() : '',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  const response: ApiResponse<Character> = {
    success: true,
    data: toCharacterDto(created),
  };
  res.status(201).json(response);
});

// PUT /api/characters/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid character ID.' });
    return;
  }

  const existing = db.select().from(characters).where(eq(characters.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Character not found.' });
    return;
  }

  const body: UpdateCharacterRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ success: false, error: 'Character name cannot be empty.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = db
    .update(characters)
    .set({
      name: nextName,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() : existing.tagline,
      description: typeof body.description === 'string' ? body.description.trim() : existing.description,
      personality: typeof body.personality === 'string' ? body.personality.trim() : existing.personality,
      speechPatterns:
        typeof body.speechPatterns === 'string' ? body.speechPatterns.trim() : existing.speechPatterns,
      scenario: typeof body.scenario === 'string' ? body.scenario.trim() : existing.scenario,
      firstMessage: typeof body.firstMessage === 'string' ? body.firstMessage.trim() : existing.firstMessage,
      exampleDialogue:
        typeof body.exampleDialogue === 'string' ? body.exampleDialogue.trim() : existing.exampleDialogue,
      updatedAt: now,
    })
    .where(eq(characters.id, id))
    .returning()
    .get();

  const response: ApiResponse<Character> = {
    success: true,
    data: toCharacterDto(updated),
  };
  res.json(response);
});

// DELETE /api/characters/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid character ID.' });
    return;
  }
  const deleted = db.delete(characters).where(eq(characters.id, id)).returning().get();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Character not found.' });
    return;
  }
  res.json({ success: true });
});

export default router;
