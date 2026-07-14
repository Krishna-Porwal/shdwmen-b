import express, { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/connection';
import { requireAuth } from '../middleware/auth';
import { JWT_SECRET } from '../config';
import logger from '../logger';

const router: Router = express.Router();

interface LoginRequest {
  email: string;
  password: string;
}

interface SignupRequest {
  name: string;
  email: string;
  password: string;
  role?: string;
}

// Register user
router.post('/signup', async (req: Request<{}, {}, SignupRequest>, res: Response) => {
  try {
    const { name, email, password, role = 'customer' } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    const existingUser = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    await query(
      'INSERT INTO users (id, name, email, password, role) VALUES ($1, $2, $3, $4, $5)',
      [userId, name, email, hashedPassword, role]
    );

    // Generate token
    const token = jwt.sign(
      { userId, email, role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: userId, name, email, role },
    });
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Merchant login - single merchant with hardcoded credentials
router.post('/merchant/login', async (req: Request<{}, {}, { username: string; password: string }>, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Check credentials
    if (username !== 'omshdw' || password !== '14082004') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Ensure merchant user row exists for requireMerchant role checks
    const merchantId = 'merchant_omshdw'; // Fixed merchant ID
    const merchantEmail = 'merchant@shdwmen.com';
    await query(
      `INSERT INTO users (id, name, email, password, role, shop_name, owner_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         password = EXCLUDED.password,
         role = EXCLUDED.role,
         shop_name = EXCLUDED.shop_name,
         owner_name = EXCLUDED.owner_name,
         updated_at = CURRENT_TIMESTAMP`,
      [merchantId, 'Om Shdw', merchantEmail, 'merchant_login', 'merchant', 'SHDWMEN Store', 'Om Shdw']
    );

    const token = jwt.sign(
      { userId: merchantId, username, role: 'merchant' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: merchantId,
        name: 'Om Shdw',
        username,
        role: 'merchant',
      },
    });
  } catch (error) {
    logger.error('Merchant login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Login user
router.post('/login', async (req: Request<{}, {}, LoginRequest>, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token
router.get('/verify', requireAuth, (req: Request, res: Response) => {
  res.json({ valid: true, user: req.auth });
});

export default router;
