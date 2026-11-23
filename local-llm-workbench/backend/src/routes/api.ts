import { Router, Request, Response } from 'express';
import { AppInfo, ApiResponse } from '@shared/index';
import endpointsRouter from './endpoints';
import promptsRouter from './prompts';
import chatsRouter from './chats';
import chatStreamRouter from './chat-stream';
import systemdLlamaRouter from './systemd-llama';
import modelPresetsRouter from './model-presets';
import containersRouter from './containers';

const router = Router();

// GET /api/info
router.get('/info', (_req: Request, res: Response) => {
  const info: AppInfo = {
    name: process.env.APP_NAME || 'Local LLM Workbench',
    subtitle: process.env.APP_SUBTITLE || 'Local model server manager & streaming chat tester',
    version: '1.0.0',
    runtime: 'Node ' + process.version,
    dbType: process.env.DB_TYPE || 'sqlite',
  };

  const response: ApiResponse<AppInfo> = {
    success: true,
    data: info,
  };
  res.json(response);
});

router.use('/endpoints', endpointsRouter);
router.use('/prompts', promptsRouter);
router.use('/chats', chatsRouter);
router.use('/chat', chatStreamRouter);
router.use('/systemd/llama', systemdLlamaRouter);
router.use('/presets/models', modelPresetsRouter);
router.use('/containers', containersRouter);

export default router;
