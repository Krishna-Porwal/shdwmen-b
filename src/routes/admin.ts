import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import logger from '../logger';

const router: Router = express.Router();

router.get('/db-status', requireAuth, async (req: Request, res: Response) => {
  try {
    const { validateSchema } = await import('../db/migrate');
    const status = await validateSchema();
    res.json(status);
  } catch (error) {
    logger.error('DB status check failed:', error);
    res.status(500).json({ error: 'DB status check failed', details: error instanceof Error ? error.message : String(error) });
  }
});

export default router;
