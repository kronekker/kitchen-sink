import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ImageBackgroundMode, ImageOutputFormat, WiroConfigStatus } from '@shared/index';
import { Secrets } from '../secrets';

const WIRO_MODEL_SLUG = 'bytedance/seedream-5-5-uncensored-advanced';
const WIRO_RUN_URL = `https://api.wiro.ai/v1/Run/${WIRO_MODEL_SLUG}`;
const WIRO_DETAIL_URL = 'https://api.wiro.ai/v1/Task/Detail';
const WIRO_CANCEL_URL = 'https://api.wiro.ai/v1/Task/Cancel';

const MIN_PIXELS = 921_600;
const MAX_PIXELS = 4_624_220;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_WAIT_MS = 180_000;

export const IMAGES_DIR = path.resolve(__dirname, '../../data/images');

function ensureImagesDir(): void {
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

export function getWiroConfigStatus(): WiroConfigStatus {
  const apiKey = Secrets.resolveSecret('WIRO_API_KEY')?.trim();
  const apiSecret = Secrets.resolveSecret('WIRO_API_SECRET')?.trim();

  if (!apiKey || !apiSecret) {
    return {
      configured: false,
      model: WIRO_MODEL_SLUG,
      message: 'Set WIRO_API_KEY and WIRO_API_SECRET in kron-virtual/backend/.env to enable image generation.',
    };
  }

  return {
    configured: true,
    model: WIRO_MODEL_SLUG,
  };
}

function buildAuthHeaders(): Record<string, string> {
  const apiKey = Secrets.resolveSecret('WIRO_API_KEY')?.trim();
  const apiSecret = Secrets.resolveSecret('WIRO_API_SECRET')?.trim();

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Wiro API credentials are not configured. Set WIRO_API_KEY and WIRO_API_SECRET in backend/.env.'
    );
  }

  const nonce = `${Math.floor(Date.now() / 1000)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
  const signature = crypto
    .createHmac('sha256', apiKey)
    .update(`${apiSecret}${nonce}`)
    .digest('hex');

  return {
    'x-api-key': apiKey,
    'x-nonce': nonce,
    'x-signature': signature,
  };
}

export interface WiroReferenceInput {
  remoteUrl: string | null;
  localFilePath: string;
  filename: string;
}

export interface WiroRunOptions {
  prompt: string;
  width: number;
  height: number;
  outputFormat: ImageOutputFormat;
  background: ImageBackgroundMode;
  references: WiroReferenceInput[];
}

export interface WiroRunResult {
  filename: string;
  remoteUrl: string;
  wiroTaskId: string;
  elapsedSeconds: string | null;
  cost: string | null;
}

function validateDimensions(width: number, height: number): { width: number; height: number } {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('Width and height must be positive numbers.');
  }
  const pixels = w * h;
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS) {
    throw new Error(
      `Image area (${pixels.toLocaleString()} px) must be between ${MIN_PIXELS.toLocaleString()} and ${MAX_PIXELS.toLocaleString()} pixels.`
    );
  }
  const ratio = w / h;
  if (ratio < 1 / 16 || ratio > 16) {
    throw new Error('Aspect ratio must be between 1:16 and 16:1.');
  }
  return { width: w, height: h };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateWithWiro(opts: WiroRunOptions): Promise<WiroRunResult> {
  ensureImagesDir();

  const { width, height } = validateDimensions(opts.width, opts.height);
  const refs = opts.references.slice(0, 10);
  const canUseJsonUrls = refs.every((r) => Boolean(r.remoteUrl));

  let runResponse: Response;

  if (canUseJsonUrls) {
    const body: Record<string, any> = {
      prompt: opts.prompt,
      width,
      height,
      background: opts.background,
      outputFormat: opts.outputFormat,
      watermark: 'false',
    };
    if (refs.length > 0) {
      body['inputImage'] = refs.map((r) => r.remoteUrl as string);
    }

    runResponse = await fetch(WIRO_RUN_URL, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } else {
    // Fallback to multipart/form-data when any reference image only exists locally
    const form = new FormData();
    form.append('prompt', opts.prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    form.append('background', opts.background);
    form.append('outputFormat', opts.outputFormat);
    form.append('watermark', 'false');

    for (const ref of refs) {
      if (fs.existsSync(ref.localFilePath)) {
        const buf = fs.readFileSync(ref.localFilePath);
        const ext = path.extname(ref.filename).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        form.append('inputImage', new Blob([buf], { type: mime }), ref.filename);
      } else if (ref.remoteUrl) {
        form.append('inputImage', ref.remoteUrl);
      }
    }

    runResponse = await fetch(WIRO_RUN_URL, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: form,
    });
  }

  const runJson: any = await runResponse.json().catch(() => null);
  if (!runResponse.ok || !runJson?.result || !runJson?.taskid) {
    const errList = Array.isArray(runJson?.errors) ? runJson.errors.join('; ') : '';
    throw new Error(
      `Wiro Run failed (HTTP ${runResponse.status}): ${errList || runJson?.message || runResponse.statusText}`
    );
  }

  const taskId = String(runJson.taskid);
  const startMs = Date.now();

  while (Date.now() - startMs < MAX_POLL_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const detailRes = await fetch(WIRO_DETAIL_URL, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskid: taskId }),
    });

    const detailJson: any = await detailRes.json().catch(() => null);
    if (!detailRes.ok || !detailJson) {
      continue;
    }

    const task = Array.isArray(detailJson.tasklist) ? detailJson.tasklist[0] : null;
    if (!task) continue;

    const status = String(task.status || '');
    if (status === 'task_cancel') {
      throw new Error(task.debugerror || 'Wiro image generation task was cancelled or failed.');
    }

    if (status === 'task_postprocess_end') {
      const firstOutput = Array.isArray(task.outputs) ? task.outputs[0] : null;
      const remoteUrl = typeof firstOutput?.url === 'string' ? firstOutput.url : '';
      if (!remoteUrl) {
        throw new Error('Wiro task completed but returned no output image URL.');
      }

      // Download and persist locally
      const imgRes = await fetch(remoteUrl);
      if (!imgRes.ok) {
        throw new Error(`Failed to download generated image from Wiro CDN (HTTP ${imgRes.status}).`);
      }

      const arrayBuf = await imgRes.arrayBuffer();
      const ct = (imgRes.headers.get('content-type') || firstOutput?.contenttype || '').toLowerCase();
      const ext = ct.includes('png')
        ? 'png'
        : ct.includes('webp')
        ? 'webp'
        : opts.outputFormat === 'png'
        ? 'png'
        : 'jpg';
      const filename = `${crypto.randomUUID()}.${ext}`;
      const localPath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(localPath, Buffer.from(arrayBuf));

      return {
        filename,
        remoteUrl,
        wiroTaskId: taskId,
        elapsedSeconds: task.elapsedseconds ? String(task.elapsedseconds) : null,
        cost: task.chargedcost || task.totalcost ? String(task.chargedcost || task.totalcost) : null,
      };
    }
  }

  // Timeout — attempt cancel
  await fetch(WIRO_CANCEL_URL, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ taskid: taskId }),
  }).catch(() => null);

  throw new Error('Timed out waiting for Wiro image generation task to finish.');
}
