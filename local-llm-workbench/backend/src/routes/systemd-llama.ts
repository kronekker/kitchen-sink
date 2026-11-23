import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { ApiResponse, LlamaScriptConfig, SystemdServiceStatus } from '@shared/index';
import {
  LLAMA_SYSTEMD_UNIT,
  SystemdAction,
  controlLlamaService,
  getLlamaServiceStatus,
  readLlamaScriptConfig,
  writeLlamaScriptConfig,
} from '../services/llama-systemd.service';

const router = Router();

// GET /api/systemd/llama/status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getLlamaServiceStatus();
    res.json({ success: true, data: status } satisfies ApiResponse<SystemdServiceStatus>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// GET /api/systemd/llama/config
router.get('/config', (_req: Request, res: Response) => {
  try {
    const config = readLlamaScriptConfig();
    res.json({ success: true, data: config } satisfies ApiResponse<LlamaScriptConfig>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// PUT /api/systemd/llama/config?restart=true
router.put('/config', async (req: Request, res: Response) => {
  try {
    const config = writeLlamaScriptConfig(req.body ?? {});
    let serviceStatus: SystemdServiceStatus | undefined;

    if (req.query['restart'] === 'true') {
      serviceStatus = await controlLlamaService('restart');
    }

    res.json({
      success: true,
      data: { config, serviceStatus },
    } satisfies ApiResponse<{ config: LlamaScriptConfig; serviceStatus?: SystemdServiceStatus }>);
  } catch (err: any) {
    const status = err.message?.includes('must') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

// GET /api/systemd/llama/logs?lines=100 (SSE stream)
router.get('/logs', (req: Request, res: Response) => {
  const rawLines = Number(req.query['lines'] ?? 100);
  const lines = Number.isInteger(rawLines) ? Math.max(10, Math.min(1000, rawLines)) : 100;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const child = spawn(
    'journalctl',
    ['--user', '-u', LLAMA_SYSTEMD_UNIT, '-n', String(lines), '-f', '--no-pager', '-o', 'short-iso'],
    { shell: false }
  );

  const sendLine = (line: string, stream: 'stdout' | 'stderr' = 'stdout') => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ line, stream })}\n\n`);
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
    sendLine(`[journalctl error] ${err.message}`, 'stderr');
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

// POST /api/systemd/llama/:action (start | stop | restart)
router.post('/:action', async (req: Request, res: Response) => {
  const action = String(req.params.action) as SystemdAction;
  if (action !== 'start' && action !== 'stop' && action !== 'restart') {
    res.status(400).json({
      success: false,
      error: 'Action must be one of: start, stop, restart.',
    } satisfies ApiResponse<never>);
    return;
  }

  try {
    const status = await controlLlamaService(action);
    res.json({ success: true, data: status } satisfies ApiResponse<SystemdServiceStatus>);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message } satisfies ApiResponse<never>);
  }
});

export default router;
