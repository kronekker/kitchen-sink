import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import {
  ApiResponse,
  ContainerInfo,
  LaunchPersistentContainerResponse,
  TransformContainerCommandResult,
} from '@shared/index';
import { findPort8081Containers } from '../services/container-inspector.service';
import {
  launchPersistentContainer,
  transformContainerCommand,
} from '../services/container-command.service';

const router = Router();

const VALID_CONTAINER_ID = /^[a-fA-F0-9]{12,64}$/;
const ANSI_REGEX = /\x1B\[[0-9;]*[a-zA-Z]/g;

function cleanLogLine(line: string): string {
  return line.replace(ANSI_REGEX, '').replace(/\r/g, '');
}

// GET /api/containers/port-8081
router.get('/port-8081', async (_req: Request, res: Response) => {
  try {
    const containers = await findPort8081Containers();
    res.json({ success: true, data: containers } satisfies ApiResponse<ContainerInfo[]>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/containers/transform (Dry-run preview of persistent flags)
router.post('/transform', (req: Request, res: Response) => {
  try {
    const result = transformContainerCommand(req.body ?? {});
    res.json({
      success: true,
      data: result,
    } satisfies ApiResponse<TransformContainerCommandResult>);
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// POST /api/containers/launch-persistent
router.post('/launch-persistent', async (req: Request, res: Response) => {
  try {
    const result = await launchPersistentContainer(req.body ?? {});
    res.json({
      success: true,
      data: result,
    } satisfies ApiResponse<LaunchPersistentContainerResponse>);
  } catch (err: any) {
    const stderr = err?.stderr ? String(err.stderr).trim() : '';
    const msg = stderr || err?.message || 'Failed to launch container.';
    const status = msg.includes('Command must') || msg.includes('Unsupported') || msg.includes('Invalid') ? 400 : 500;
    res.status(status).json({ success: false, error: msg } satisfies ApiResponse<never>);
  }
});

// GET /api/containers/:runtime/:id/logs?lines=100 (Read-only SSE stream)
router.get('/:runtime/:id/logs', (req: Request, res: Response) => {
  const runtime = String(req.params.runtime);
  const id = String(req.params.id);

  if (runtime !== 'podman' && runtime !== 'docker') {
    res.status(400).json({
      success: false,
      error: 'Runtime must be "podman" or "docker".',
    } satisfies ApiResponse<never>);
    return;
  }

  if (!VALID_CONTAINER_ID.test(id)) {
    res.status(400).json({
      success: false,
      error: 'Invalid container ID format.',
    } satisfies ApiResponse<never>);
    return;
  }

  const rawLines = Number(req.query['lines'] ?? 100);
  const lines = Number.isInteger(rawLines) ? Math.max(10, Math.min(1000, rawLines)) : 100;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const child = spawn(runtime, ['logs', '--tail', String(lines), '-f', id], { shell: false });

  const sendLine = (line: string, stream: 'stdout' | 'stderr') => {
    const cleaned = cleanLogLine(line);
    if (cleaned.length > 0 && !res.writableEnded) {
      res.write(`data: ${JSON.stringify({ line: cleaned, stream })}\n\n`);
    }
  };

  let outBuf = '';
  child.stdout.on('data', (chunk: Buffer) => {
    outBuf += chunk.toString('utf8');
    const parts = outBuf.split('\n');
    outBuf = parts.pop() ?? '';
    for (const part of parts) {
      if (part.length > 0) sendLine(part, 'stdout');
    }
  });

  let errBuf = '';
  child.stderr.on('data', (chunk: Buffer) => {
    errBuf += chunk.toString('utf8');
    const parts = errBuf.split('\n');
    errBuf = parts.pop() ?? '';
    for (const part of parts) {
      if (part.length > 0) sendLine(part, 'stderr');
    }
  });

  child.on('error', (err) => {
    sendLine(`[${runtime} logs error] ${err.message}`, 'stderr');
    if (!res.writableEnded) res.end();
  });

  child.on('close', () => {
    if (!res.writableEnded) res.end();
  });

  res.on('close', () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  });
});

export default router;
