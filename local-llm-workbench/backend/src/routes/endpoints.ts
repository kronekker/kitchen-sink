import { Router, Request, Response } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { endpoints } from '../db/schema';
import {
  ApiResponse,
  CreateEndpointRequest,
  EndpointProbeResult,
  LlmEndpoint,
  UpdateEndpointRequest,
} from '@shared/index';
import { probeEndpoint } from '../services/endpoint-probe.service';

const router = Router();

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toDto(row: typeof endpoints.$inferSelect): LlmEndpoint {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey ?? null,
    isBuiltIn: Boolean(row.isBuiltIn),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

// GET /api/endpoints
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db
      .select()
      .from(endpoints)
      .orderBy(asc(endpoints.sortOrder), asc(endpoints.id))
      .all();

    const response: ApiResponse<LlmEndpoint[]> = {
      success: true,
      data: rows.map(toDto),
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// GET /api/endpoints/status-all
router.get('/status-all', async (_req: Request, res: Response) => {
  try {
    const rows = db
      .select()
      .from(endpoints)
      .orderBy(asc(endpoints.sortOrder), asc(endpoints.id))
      .all();

    const results = await Promise.all(rows.map((row) => probeEndpoint(toDto(row))));
    const response: ApiResponse<EndpointProbeResult[]> = {
      success: true,
      data: results,
    };
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// GET /api/endpoints/:id/status
router.get('/:id/status', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid endpoint ID.' } satisfies ApiResponse<never>);
    return;
  }

  try {
    const row = db.select().from(endpoints).where(eq(endpoints.id, id)).get();
    if (!row) {
      res.status(404).json({ success: false, error: 'Endpoint not found.' } satisfies ApiResponse<never>);
      return;
    }

    const result = await probeEndpoint(toDto(row));
    res.json({ success: true, data: result } satisfies ApiResponse<EndpointProbeResult>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/endpoints
router.post('/', (req: Request, res: Response) => {
  const { name, baseUrl, apiKey }: CreateEndpointRequest = req.body ?? {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedUrl = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';

  if (!trimmedName || !trimmedUrl) {
    res.status(400).json({
      success: false,
      error: 'Both name and baseUrl are required.',
    } satisfies ApiResponse<never>);
    return;
  }

  if (!isValidHttpUrl(trimmedUrl)) {
    res.status(400).json({
      success: false,
      error: 'baseUrl must be a valid http:// or https:// URL.',
    } satisfies ApiResponse<never>);
    return;
  }

  try {
    const inserted = db
      .insert(endpoints)
      .values({
        name: trimmedName,
        baseUrl: trimmedUrl,
        apiKey: apiKey && apiKey.trim() ? apiKey.trim() : null,
        isBuiltIn: false,
        sortOrder: 100,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();

    res.status(201).json({ success: true, data: toDto(inserted) } satisfies ApiResponse<LlmEndpoint>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// PUT /api/endpoints/:id
router.put('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid endpoint ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(endpoints).where(eq(endpoints.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Endpoint not found.' } satisfies ApiResponse<never>);
    return;
  }

  const body: UpdateEndpointRequest = req.body ?? {};
  const nextName = typeof body.name === 'string' ? body.name.trim() : existing.name;
  const nextUrl =
    typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : existing.baseUrl;
  const nextApiKey =
    body.apiKey === undefined
      ? existing.apiKey
      : body.apiKey && body.apiKey.trim()
        ? body.apiKey.trim()
        : null;

  if (!nextName || !isValidHttpUrl(nextUrl)) {
    res.status(400).json({
      success: false,
      error: 'Valid name and http(s) baseUrl are required.',
    } satisfies ApiResponse<never>);
    return;
  }

  try {
    const updated = db
      .update(endpoints)
      .set({ name: nextName, baseUrl: nextUrl, apiKey: nextApiKey })
      .where(eq(endpoints.id, id))
      .returning()
      .get();

    res.json({ success: true, data: toDto(updated) } satisfies ApiResponse<LlmEndpoint>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// DELETE /api/endpoints/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'Invalid endpoint ID.' } satisfies ApiResponse<never>);
    return;
  }

  const existing = db.select().from(endpoints).where(eq(endpoints.id, id)).get();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Endpoint not found.' } satisfies ApiResponse<never>);
    return;
  }

  if (existing.isBuiltIn) {
    res.status(400).json({
      success: false,
      error: 'Built-in endpoints (8080 / 8081) cannot be deleted.',
    } satisfies ApiResponse<never>);
    return;
  }

  try {
    db.delete(endpoints).where(eq(endpoints.id, id)).run();
    res.json({ success: true } satisfies ApiResponse<void>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

export default router;
