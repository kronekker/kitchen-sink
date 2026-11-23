import { Router, Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { modelPresets } from '../db/schema';
import {
  ApiResponse,
  CreateModelPresetRequest,
  IsMtpMode,
  LlamaScriptConfig,
  ModelPreset,
  SystemdServiceStatus,
  UpdateModelPresetRequest,
} from '@shared/index';
import {
  controlLlamaService,
  validateLlamaConfigInput,
  writeLlamaScriptConfig,
} from '../services/llama-systemd.service';

const router = Router();

function toDto(row: typeof modelPresets.$inferSelect): ModelPreset {
  return {
    id: row.id,
    name: row.name,
    modelName: row.modelName,
    modelQuant: row.modelQuant,
    modelCtx: row.modelCtx,
    isMtp: row.isMtp as IsMtpMode,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// GET /api/presets/models
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .select()
      .from(modelPresets)
      .orderBy(desc(modelPresets.updatedAt), desc(modelPresets.id))
      .all();

    res.json({ success: true, data: rows.map(toDto) } satisfies ApiResponse<ModelPreset[]>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/presets/models
router.post('/', (req: Request, res: Response) => {
  const body: CreateModelPresetRequest = req.body ?? {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    res.status(400).json({ success: false, error: 'Preset name is required.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    const validated = validateLlamaConfigInput(body);
    const now = new Date().toISOString();
    const inserted = db
      .insert(modelPresets)
      .values({
        name,
        modelName: validated.modelName,
        modelQuant: validated.modelQuant,
        modelCtx: validated.modelCtx,
        isMtp: validated.isMtp,
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    res.status(201).json({ success: true, data: toDto(inserted) } satisfies ApiResponse<ModelPreset>);
  } catch (err: any) {
    const status = err.message?.includes('must') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// PUT /api/presets/models/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid preset ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(modelPresets).where(eq(modelPresets.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Model preset not found.' } satisfies ApiResponse<never>);
    return;
  }

  const body: UpdateModelPresetRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  if (!nextName) {
    res.status(400).json({ success: false, error: 'Preset name cannot be empty.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    const validated = validateLlamaConfigInput({
      modelName: body.modelName ?? existing.modelName,
      modelQuant: body.modelQuant ?? existing.modelQuant,
      modelCtx: body.modelCtx ?? existing.modelCtx,
      isMtp: body.isMtp ?? existing.isMtp,
    });

    const updated = db
      .update(modelPresets)
      .set({
        name: nextName,
        modelName: validated.modelName,
        modelQuant: validated.modelQuant,
        modelCtx: validated.modelCtx,
        isMtp: validated.isMtp,
        notes:
          body.notes === undefined
            ? existing.notes
            : body.notes && body.notes.trim()
              ? body.notes.trim()
              : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(modelPresets.id, id))
      .returning()
      .get();

    res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<ModelPreset>);
  } catch (err: any) {
    const status = err.message?.includes('must') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// DELETE /api/presets/models/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid preset ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(modelPresets).where(eq(modelPresets.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Model preset not found.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    db.delete(modelPresets).where(eq(modelPresets.id, id)).run();
    res.json({ success: true } satisfies ApiResponse<void>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/presets/models/:id/apply?restart=true
router.post('/:id/apply', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid preset ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(modelPresets).where(eq(modelPresets.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Model preset not found.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    const config = writeLlamaScriptConfig({
      modelName: existing.modelName,
      modelQuant: existing.modelQuant,
      modelCtx: existing.modelCtx,
      isMtp: existing.isMtp,
    });

    let serviceStatus: SystemdServiceStatus | undefined;
    if (req.query['restart'] === 'true') {
      serviceStatus = await controlLlamaService('restart');
    }

    res.json({
      success: true,
      data: { config, serviceStatus },
    } satisfies ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

export default router;
