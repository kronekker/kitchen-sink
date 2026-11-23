import { Router, Request, Response } from 'express';
import { ActiveEngineStatus, ApiResponse } from '@shared/index';
import { getActiveEngineStatus } from '../services/inference-router';

const router = Router();

// GET /api/engine/status
router.get('/status', async (req: Request, res: Response) => {
  const forceRefresh = req.query['refresh'] === 'true' || req.query['refresh'] === '1';
  const status = await getActiveEngineStatus(forceRefresh);
  const response: ApiResponse<ActiveEngineStatus> = {
    success: true,
    data: status,
  };
  res.json(response);
});

export default router;
