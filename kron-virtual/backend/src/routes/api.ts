import { Router, Request, Response } from 'express';
import { AppInfo, ApiResponse } from '@shared/index';
import engineRouter from './engine';
import charactersRouter from './characters';
import personasRouter from './personas';
import stylesRouter from './styles';
import sessionsRouter from './sessions';
import messagesRouter from './messages';
import chatStreamRouter from './chat-stream';

const router = Router();

// GET /api/info
router.get('/info', (_req: Request, res: Response) => {
  const info: AppInfo = {
    name: process.env.APP_NAME || 'Kron Virtual',
    subtitle: process.env.APP_SUBTITLE || 'Local LLM virtual character & roleplay engine',
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

router.use('/engine', engineRouter);
router.use('/characters', charactersRouter);
router.use('/personas', personasRouter);
router.use('/styles', stylesRouter);
router.use('/sessions', sessionsRouter);
router.use('/messages', messagesRouter);
router.use('/chat', chatStreamRouter);

export default router;
