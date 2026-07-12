import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { createTables } from '../db/migrate';
import { isMissingRelationError, sendServerError } from '../utils/apiError';

const router: Router = express.Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    let result;
    let unreadResult;

    try {
      result = await query(
        `SELECT * FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      );

      unreadResult = await query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      );
    } catch (error) {
      if (!isMissingRelationError(error, 'notifications')) {
        throw error;
      }

      await createTables();
      result = await query(
        `SELECT * FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [userId]
      );

      unreadResult = await query(
        `SELECT COUNT(*) as count FROM notifications
         WHERE user_id = $1 AND is_read = false`,
        [userId]
      );
    }

    res.json({
      unreadCount: parseInt(unreadResult.rows[0].count, 10) || 0,
      notifications: result.rows,
    });
  } catch (error) {
    if (isMissingRelationError(error, 'notifications')) {
      try {
        await createTables();
      } catch (bootstrapError) {
        console.error('Notification table bootstrap failed:', bootstrapError);
      }

      return res.json({ unreadCount: 0, notifications: [] });
    }

    sendServerError(res, error, 'Failed to fetch notifications');
  }
});

router.patch('/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const { id } = req.params;

    const result = await query(
      `UPDATE notifications
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification marked as read', notification: result.rows[0] });
  } catch (error) {
    if (isMissingRelationError(error, 'notifications')) {
      return res.json({ message: 'Notification marked as read', notification: null });
    }

    sendServerError(res, error, 'Failed to update notification');
  }
});

router.patch('/read-all', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    await query(
      `UPDATE notifications
       SET is_read = true, read_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND is_read = false`,
      [userId]
    );

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    if (isMissingRelationError(error, 'notifications')) {
      return res.json({ message: 'All notifications marked as read' });
    }

    sendServerError(res, error, 'Failed to update notifications');
  }
});

export default router;