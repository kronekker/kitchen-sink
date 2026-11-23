import { Router, Request, Response } from 'express';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '../db';
import { rpMessages, rpSessions } from '../db/schema';
import { ApiResponse, RpMessage, UpdateMessageRequest } from '@shared/index';
import { toMessageDto } from './sessions';

const router = Router();

// PATCH /api/messages/:id
router.patch('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid message ID.' });
    return;
  }

  const existing = db.select().from(rpMessages).where(eq(rpMessages.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Message not found.' });
    return;
  }

  const body: UpdateMessageRequest = req.body ?? ({} as UpdateMessageRequest);
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!content) {
    res.status(400).json({ success: false, error: 'Message content cannot be empty.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = db
    .update(rpMessages)
    .set({ content, updatedAt: now })
    .where(eq(rpMessages.id, id))
    .returning()
    .get();

  db.update(rpSessions).set({ updatedAt: now }).where(eq(rpSessions.id, existing.sessionId)).run();

  const response: ApiResponse<RpMessage> = {
    success: true,
    data: toMessageDto(updated),
  };
  res.json(response);
});

// DELETE /api/messages/:id (?truncateAfter=true to rewind from this message)
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid message ID.' });
    return;
  }

  const existing = db.select().from(rpMessages).where(eq(rpMessages.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Message not found.' });
    return;
  }

  const truncateAfter = req.query['truncateAfter'] === 'true' || req.query['truncateAfter'] === '1';
  if (truncateAfter) {
    db.delete(rpMessages)
      .where(and(eq(rpMessages.sessionId, existing.sessionId), gte(rpMessages.id, id)))
      .run();
  } else {
    db.delete(rpMessages).where(eq(rpMessages.id, id)).run();
  }

  db.update(rpSessions)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(rpSessions.id, existing.sessionId))
    .run();

  res.json({ success: true });
});

export default router;
