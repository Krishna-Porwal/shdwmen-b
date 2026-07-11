import express, { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router: Router = express.Router();

// Sync user from Clerk webhook
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { clerkId, email, firstName, lastName, imageUrl, role = 'customer' } = req.body;

    if (!clerkId || !email) {
      return res.status(400).json({ error: 'Clerk ID and email required' });
    }

    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || email;

    // Upsert user (insert or update)
    const result = await query(
      `INSERT INTO users (id, name, email, password, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [clerkId, fullName, email, 'clerk_auth', role]
    );

    console.log('User synced from Clerk:', result.rows[0].id);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('User sync error:', error);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

// Get user profile
router.get('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;

    const result = await query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const { name, email } = req.body;

    const updates: string[] = [];
    const params: any[] = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount}`);
      params.push(name);
      paramCount++;
    }

    if (email) {
      updates.push(`email = $${paramCount}`);
      params.push(email);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(userId);

    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);

    const result = await query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      message: 'Profile updated',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    // Get user
    const userResult = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      hashedPassword,
      userId,
    ]);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get user by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Save or update user phone number
router.post('/phone', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId;
    const email = req.auth?.email;
    const { phone } = req.body;

    if (!phone || phone.trim().length === 0) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const phoneNumber = phone.trim();
    const fullName = email || userId;
    const fallbackEmail = email || `${userId}@clerk.local`;

    const result = await query(
      `INSERT INTO users (id, name, email, password, role, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         phone = EXCLUDED.phone,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, name, email, phone, role`,
      [userId, fullName, fallbackEmail, 'clerk_auth', 'customer', phoneNumber]
    );

    res.json({
      message: 'Phone number saved successfully',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Save phone error:', error);
    res.status(500).json({ error: 'Failed to save phone number' });
  }
});

export default router;
