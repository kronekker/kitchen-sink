import { Router, Request, Response } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db } from '../db';
import { DEFAULT_IMAGE_TEMPLATES } from '../db/init';
import {
  characters,
  generatedImages,
  imagePromptTemplates,
  personas,
  rpMessages,
  rpSessions,
} from '../db/schema';
import {
  ApiResponse,
  AssignImageRequest,
  DraftImagePromptRequest,
  DraftImagePromptResponse,
  GeneratedImage,
  GeneratedImageKind,
  GenerateImageRequest,
  ImageBackgroundMode,
  ImageEntityType,
  ImageOutputFormat,
  ImagePromptTemplate,
  ImageTemplateKey,
  UpdateImageTemplateRequest,
  WiroConfigStatus,
} from '@shared/index';
import { generateWithWiro, getWiroConfigStatus, IMAGES_DIR } from '../services/wiro-client';
import { draftImagePrompt } from '../services/image-prompts';
import { toCharacterDto } from './characters';
import { toPersonaDto } from './personas';
import { toMessageDto, toSessionDto } from './sessions';

const router = Router();

function safeParseIdArray(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export function toGeneratedImageDto(row: typeof generatedImages.$inferSelect): GeneratedImage {
  return {
    id: row.id,
    kind: row.kind as GeneratedImageKind,
    entityType: row.entityType as ImageEntityType,
    entityId: row.entityId ?? null,
    isDefault: row.isDefault === 1,
    filename: row.filename,
    url: `/api/images/file/${encodeURIComponent(row.filename)}`,
    remoteUrl: row.remoteUrl ?? null,
    prompt: row.prompt,
    referenceImageIds: safeParseIdArray(row.referenceImageIdsJson),
    width: row.width,
    height: row.height,
    outputFormat: (row.outputFormat === 'png' ? 'png' : 'jpeg') as ImageOutputFormat,
    wiroTaskId: row.wiroTaskId ?? null,
    elapsedSeconds: row.elapsedSeconds ?? null,
    cost: row.cost ?? null,
    createdAt: row.createdAt,
  };
}

export function getDefaultAvatarMap(
  entityType: 'character' | 'persona'
): Map<number, { id: number; url: string }> {
  const rows = db
    .select()
    .from(generatedImages)
    .where(and(eq(generatedImages.entityType, entityType), eq(generatedImages.isDefault, 1)))
    .all();

  const map = new Map<number, { id: number; url: string }>();
  for (const r of rows) {
    if (r.entityId !== null) {
      map.set(r.entityId, {
        id: r.id,
        url: `/api/images/file/${encodeURIComponent(r.filename)}`,
      });
    }
  }
  return map;
}

// GET /api/images/status
router.get('/status', (_req: Request, res: Response) => {
  const status: WiroConfigStatus = getWiroConfigStatus();
  const response: ApiResponse<WiroConfigStatus> = { success: true, data: status };
  res.json(response);
});

// GET /api/images/file/:filename
router.get('/file/:filename', (req: Request, res: Response) => {
  const safeName = path.basename(String(req.params['filename'] || ''));
  if (!safeName || safeName === '.' || safeName === '..') {
    res.status(400).json({ success: false, error: 'Invalid filename.' });
    return;
  }
  const fullPath = path.join(IMAGES_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ success: false, error: 'Image file not found.' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(fullPath);
});

// GET /api/images/templates
router.get('/templates', (_req: Request, res: Response) => {
  const rows = db.select().from(imagePromptTemplates).orderBy(asc(imagePromptTemplates.id)).all();
  const data: ImagePromptTemplate[] = rows.map((r) => ({
    id: r.id,
    key: r.key as ImageTemplateKey,
    name: r.name,
    description: r.description,
    template: r.template,
    updatedAt: r.updatedAt,
  }));
  res.json({ success: true, data } satisfies ApiResponse<ImagePromptTemplate[]>);
});

// PUT /api/images/templates/:key
router.put('/templates/:key', (req: Request, res: Response) => {
  const key = String(req.params['key'] || '');
  const existing = db
    .select()
    .from(imagePromptTemplates)
    .where(eq(imagePromptTemplates.key, key))
    .get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Template not found.' });
    return;
  }

  const body: UpdateImageTemplateRequest = req.body ?? ({} as UpdateImageTemplateRequest);
  const template = typeof body.template === 'string' ? body.template.trim() : '';
  if (!template) {
    res.status(400).json({ success: false, error: 'Template text cannot be empty.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = db
    .update(imagePromptTemplates)
    .set({ template, updatedAt: now })
    .where(eq(imagePromptTemplates.key, key))
    .returning()
    .get();

  res.json({
    success: true,
    data: {
      id: updated.id,
      key: updated.key as ImageTemplateKey,
      name: updated.name,
      description: updated.description,
      template: updated.template,
      updatedAt: updated.updatedAt,
    },
  } satisfies ApiResponse<ImagePromptTemplate>);
});

// POST /api/images/templates/:key/reset
router.post('/templates/:key/reset', (req: Request, res: Response) => {
  const key = String(req.params['key'] || '') as ImageTemplateKey;
  const def = DEFAULT_IMAGE_TEMPLATES[key];
  if (!def) {
    res.status(404).json({ success: false, error: 'Unknown template key.' });
    return;
  }

  const now = new Date().toISOString();
  const updated = db
    .update(imagePromptTemplates)
    .set({ template: def.template, updatedAt: now })
    .where(eq(imagePromptTemplates.key, key))
    .returning()
    .get();

  res.json({
    success: true,
    data: {
      id: updated.id,
      key: updated.key as ImageTemplateKey,
      name: updated.name,
      description: updated.description,
      template: updated.template,
      updatedAt: updated.updatedAt,
    },
  } satisfies ApiResponse<ImagePromptTemplate>);
});

// POST /api/images/draft-prompt
router.post('/draft-prompt', async (req: Request, res: Response) => {
  const body: DraftImagePromptRequest = req.body ?? ({} as DraftImagePromptRequest);
  const templateKey = body.templateKey;
  if (!templateKey) {
    res.status(400).json({ success: false, error: 'templateKey is required.' });
    return;
  }

  const tplRow = db
    .select()
    .from(imagePromptTemplates)
    .where(eq(imagePromptTemplates.key, templateKey))
    .get();
  const templateText = tplRow?.template || DEFAULT_IMAGE_TEMPLATES[templateKey]?.template || '';
  if (!templateText) {
    res.status(404).json({ success: false, error: 'Image prompt template not found.' });
    return;
  }

  let sessionDto = null;
  let characterDto = null;
  let personaDto = null;
  let messagesDto: ReturnType<typeof toMessageDto>[] = [];

  if (body.sessionId) {
    const sRow = db.select().from(rpSessions).where(eq(rpSessions.id, Number(body.sessionId))).get();
    if (sRow) {
      sessionDto = toSessionDto(sRow);
      const cRow = db.select().from(characters).where(eq(characters.id, sRow.characterId)).get();
      const pRow = db.select().from(personas).where(eq(personas.id, sRow.personaId)).get();
      if (cRow) characterDto = toCharacterDto(cRow);
      if (pRow) personaDto = toPersonaDto(pRow);
      const mRows = db
        .select()
        .from(rpMessages)
        .where(eq(rpMessages.sessionId, sRow.id))
        .orderBy(asc(rpMessages.id))
        .all();
      messagesDto = mRows.map(toMessageDto);
    }
  }

  if (!characterDto && body.characterId) {
    const cRow = db
      .select()
      .from(characters)
      .where(eq(characters.id, Number(body.characterId)))
      .get();
    if (cRow) characterDto = toCharacterDto(cRow);
  }

  if (!personaDto && body.personaId) {
    const pRow = db
      .select()
      .from(personas)
      .where(eq(personas.id, Number(body.personaId)))
      .get();
    if (pRow) personaDto = toPersonaDto(pRow);
  }

  const drafted = await draftImagePrompt({
    template: templateText,
    character: characterDto,
    persona: personaDto,
    session: sessionDto,
    messages: messagesDto,
    extraNotes: body.extraNotes,
    useLlm: Boolean(body.useLlm),
  });

  res.json({
    success: true,
    data: drafted,
  } satisfies ApiResponse<DraftImagePromptResponse>);
});

// GET /api/images (?kind=...&entityType=...&entityId=...)
router.get('/', (req: Request, res: Response) => {
  const kind = typeof req.query['kind'] === 'string' ? req.query['kind'] : undefined;
  const entityType =
    typeof req.query['entityType'] === 'string' ? req.query['entityType'] : undefined;
  const entityIdRaw =
    typeof req.query['entityId'] === 'string' ? Number(req.query['entityId']) : undefined;

  const conditions: any[] = [];
  if (kind) conditions.push(eq(generatedImages.kind, kind));
  if (entityType) conditions.push(eq(generatedImages.entityType, entityType));
  if (entityIdRaw !== undefined && Number.isInteger(entityIdRaw)) {
    conditions.push(eq(generatedImages.entityId, entityIdRaw));
  }

  const rows =
    conditions.length > 0
      ? db
          .select()
          .from(generatedImages)
          .where(and(...conditions))
          .orderBy(desc(generatedImages.isDefault), desc(generatedImages.createdAt))
          .all()
      : db.select().from(generatedImages).orderBy(desc(generatedImages.createdAt)).all();

  res.json({
    success: true,
    data: rows.map(toGeneratedImageDto),
  } satisfies ApiResponse<GeneratedImage[]>);
});

// POST /api/images/generate
router.post('/generate', async (req: Request, res: Response) => {
  const body: GenerateImageRequest = req.body ?? ({} as GenerateImageRequest);
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ success: false, error: 'Prompt is required.' });
    return;
  }

  const kind: GeneratedImageKind = body.kind || 'studio';
  const entityType: ImageEntityType = body.entityType || 'studio';
  const entityId =
    body.entityId !== undefined && body.entityId !== null && Number.isInteger(Number(body.entityId))
      ? Number(body.entityId)
      : null;

  const width = Number(body.width) || 1024;
  const height = Number(body.height) || 1024;
  const outputFormat: ImageOutputFormat = body.outputFormat === 'png' ? 'png' : 'jpeg';
  const background: ImageBackgroundMode =
    body.background === 'transparent' || body.background === 'opaque' ? body.background : 'auto';

  const refIds = Array.isArray(body.referenceImageIds)
    ? body.referenceImageIds.map((n) => Number(n)).filter((n) => Number.isInteger(n))
    : [];

  // Preserve the exact selection order (Image 1, Image 2, ...) for multi-character I2I
  const references = [];
  if (refIds.length > 0) {
    const refRows = db
      .select()
      .from(generatedImages)
      .where(inArray(generatedImages.id, refIds))
      .all();
    const refMap = new Map(refRows.map((r) => [r.id, r]));
    for (const rid of refIds) {
      const r = refMap.get(rid);
      if (r) {
        references.push({
          remoteUrl: r.remoteUrl ?? null,
          localFilePath: path.join(IMAGES_DIR, r.filename),
          filename: r.filename,
        });
      }
    }
  }

  try {
    const result = await generateWithWiro({
      prompt,
      width,
      height,
      outputFormat,
      background,
      references,
    });

    const isAvatarEntity =
      (entityType === 'character' || entityType === 'persona') && entityId !== null;
    let shouldBeDefault = false;

    if (isAvatarEntity) {
      const existingForEntity = db
        .select({ id: generatedImages.id })
        .from(generatedImages)
        .where(
          and(eq(generatedImages.entityType, entityType), eq(generatedImages.entityId, entityId))
        )
        .all();

      shouldBeDefault = Boolean(body.setAsDefault) || existingForEntity.length === 0;

      if (shouldBeDefault) {
        db.update(generatedImages)
          .set({ isDefault: 0 })
          .where(
            and(eq(generatedImages.entityType, entityType), eq(generatedImages.entityId, entityId))
          )
          .run();
      }
    }

    const now = new Date().toISOString();
    const saved = db
      .insert(generatedImages)
      .values({
        kind,
        entityType,
        entityId,
        isDefault: shouldBeDefault ? 1 : 0,
        filename: result.filename,
        remoteUrl: result.remoteUrl,
        prompt,
        referenceImageIdsJson: JSON.stringify(refIds),
        width,
        height,
        outputFormat,
        wiroTaskId: result.wiroTaskId,
        elapsedSeconds: result.elapsedSeconds,
        cost: result.cost,
        createdAt: now,
      })
      .returning()
      .get();

    res.status(201).json({
      success: true,
      data: toGeneratedImageDto(saved),
    } satisfies ApiResponse<GeneratedImage>);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Image generation failed.',
    });
  }
});

// PATCH /api/images/:id/default
router.patch('/:id/default', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid image ID.' });
    return;
  }

  const existing = db.select().from(generatedImages).where(eq(generatedImages.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Image not found.' });
    return;
  }

  if (existing.entityId !== null) {
    db.update(generatedImages)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(generatedImages.entityType, existing.entityType),
          eq(generatedImages.entityId, existing.entityId)
        )
      )
      .run();
  }

  const updated = db
    .update(generatedImages)
    .set({ isDefault: 1 })
    .where(eq(generatedImages.id, id))
    .returning()
    .get();

  res.json({
    success: true,
    data: toGeneratedImageDto(updated),
  } satisfies ApiResponse<GeneratedImage>);
});

// PATCH /api/images/:id/assign
router.patch('/:id/assign', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid image ID.' });
    return;
  }

  const existing = db.select().from(generatedImages).where(eq(generatedImages.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Image not found.' });
    return;
  }

  const body: AssignImageRequest = req.body ?? ({} as AssignImageRequest);
  const entityType = body.entityType;
  const entityId = body.entityId !== null && body.entityId !== undefined ? Number(body.entityId) : null;
  const kind =
    body.kind || (entityType === 'character' || entityType === 'persona' ? 'avatar' : existing.kind);

  let isDefault = 0;
  if ((entityType === 'character' || entityType === 'persona') && entityId !== null) {
    const siblings = db
      .select({ id: generatedImages.id })
      .from(generatedImages)
      .where(
        and(eq(generatedImages.entityType, entityType), eq(generatedImages.entityId, entityId))
      )
      .all();

    if (body.setAsDefault || siblings.length === 0) {
      isDefault = 1;
      db.update(generatedImages)
        .set({ isDefault: 0 })
        .where(
          and(eq(generatedImages.entityType, entityType), eq(generatedImages.entityId, entityId))
        )
        .run();
    }
  }

  const updated = db
    .update(generatedImages)
    .set({ entityType, entityId, kind, isDefault })
    .where(eq(generatedImages.id, id))
    .returning()
    .get();

  res.json({
    success: true,
    data: toGeneratedImageDto(updated),
  } satisfies ApiResponse<GeneratedImage>);
});

// DELETE /api/images/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) {
    res.status(400).json({ success: false, error: 'Invalid image ID.' });
    return;
  }

  const deleted = db.delete(generatedImages).where(eq(generatedImages.id, id)).returning().get();
  if (!deleted) {
    res.status(404).json({ success: false, error: 'Image not found.' });
    return;
  }

  // Delete local image file cleanly
  const filePath = path.join(IMAGES_DIR, path.basename(deleted.filename));
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore fs cleanup error
    }
  }

  // If this was the default avatar, promote the newest remaining image for that entity
  if (deleted.isDefault === 1 && deleted.entityId !== null) {
    const next = db
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.entityType, deleted.entityType),
          eq(generatedImages.entityId, deleted.entityId)
        )
      )
      .orderBy(desc(generatedImages.createdAt))
      .limit(1)
      .get();

    if (next) {
      db.update(generatedImages).set({ isDefault: 1 }).where(eq(generatedImages.id, next.id)).run();
    }
  }

  res.json({ success: true });
});

export default router;
