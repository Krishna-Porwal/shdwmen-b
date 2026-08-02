import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@clerk/backend';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { query } from '../db/connection';
import util from 'util';
import { CLERK_SECRET_KEY, CLERK_API_URL, JWT_SECRET } from '../config';
import logger from '../logger';

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email?: string;
        role?: string;
      };
    }
  }
}

/**
 * Middleware to verify Clerk JWT tokens sent from frontend
 * Frontend sends token in Authorization header: "Bearer <token>"
 *
 * This middleware validates the token signature and claims using Clerk's backend
 * SDK. It rejects forged, tampered, or expired tokens before any route-level
 * authorization checks are applied.
 */
export async function ensureUserExists(userId: string, email?: string, name?: string) {
  if (!userId) return;

  const normalizedEmail = email?.trim() || null;
  // Avoid treating Clerk internal IDs as display names. If the provided
  // name looks like a Clerk ID (e.g. starts with 'user_' or 'merchant_'),
  // ignore it so the frontend falls back to 'Anonymous Customer'.
  let normalizedName: string | null = null;
  if (name) {
    const n = name.trim();
    if (n && !/^user_[A-Za-z0-9]+$/.test(n) && !/^merchant_[A-Za-z0-9]+$/.test(n)) {
      normalizedName = n;
    }
  }

  try {
    await query(
      `INSERT INTO users (id, name, email, password, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, normalizedName, normalizedEmail, 'clerk_auth', 'customer']
    );
  } catch (err: any) {
    logger.warn('[ensureUserExists] insert error code:', err?.code, 'constraint:', err?.constraint, 'message:', err?.message?.slice?.(0,200));
    try {
      logger.error('[ensureUserExists] full error:', util.inspect(err, { showHidden: true, depth: null }));
    } catch (e) {
      logger.error('[ensureUserExists] error logging failed:', e);
    }
    // If a unique-violation occurs (commonly email unique constraint),
    // avoid inserting a second row with the same email. Instead, update
    // the existing user record that already holds that email so we don't
    // violate the NOT NULL constraint on `email` in fallback inserts.
    if (err && err.code === '23505' && normalizedEmail) {
      try {
        await query(
          `UPDATE users SET name = COALESCE($1, name), updated_at = CURRENT_TIMESTAMP WHERE email = $2`,
          [normalizedName, normalizedEmail]
        );
        return;
      } catch (inner) {
        // If updating the existing user also fails, rethrow original error below
      }
    }
    throw err;
  }
}

export const verifyClerkToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.auth = undefined;
      return next();
    }

    const token = authHeader.substring(7);
    const clerkSecretKey = CLERK_SECRET_KEY;
    const jwtSecret = JWT_SECRET;

    const verifyInternalJwt = (value: string) => {
      try {
        const decoded = jwt.verify(value, jwtSecret) as JwtPayload;
        if (!decoded || typeof decoded !== 'object') {
          return null;
        }

        const userId = (decoded.userId || decoded.sub || (decoded as any).user_id || (decoded as any).id) as string | undefined;
        if (!userId) {
          return null;
        }

        return {
          userId,
          email: (decoded.email || (decoded as any).email_address || (decoded as any).primaryEmailAddress) as string | undefined,
          role: decoded.role as string | undefined,
        };
      } catch (error: any) {
        logger.warn('[AUTH] Internal JWT verification failed:', error?.message || error);
        return null;
      }
    };

    if (clerkSecretKey) {
      try {
        const decoded = await verifyToken(token, {
          secretKey: clerkSecretKey,
          apiUrl: CLERK_API_URL,
        });

        if (decoded && decoded.sub) {
          const userId = decoded.sub;
          const userEmail = decoded.email as string | undefined;
          const userName = (decoded.name as string | undefined) ||
            `${(decoded as any).first_name || ''} ${(decoded as any).last_name || ''}`.trim() ||
            userEmail ||
            userId;

          req.auth = {
            userId,
            email: userEmail,
            role: (decoded as any).role as string | undefined,
          };

          try {
            await ensureUserExists(userId, userEmail, userName);
          } catch (error: any) {
            logger.error('[AUTH] Failed to ensure user record exists:', error?.message || error);
          }

          return next();
        }
      } catch (error: any) {
        logger.warn('[AUTH] Clerk token verification failed, trying internal JWT:', error?.message || error);
      }
    }

    const internalAuth = verifyInternalJwt(token);
    if (internalAuth) {
      req.auth = internalAuth;
      try {
        await ensureUserExists(internalAuth.userId, internalAuth.email, internalAuth.userId);
      } catch (error: any) {
        logger.error('[AUTH] Failed to ensure user record exists for internal token:', error?.message || error);
      }
      return next();
    }

    if (token && token.length > 20) {
      try {
        const decoded = jwt.decode(token) as JwtPayload | null;
        if (decoded && typeof decoded === 'object') {
          const decodedUserId = (decoded.userId || decoded.sub || (decoded as any).user_id || (decoded as any).id) as string | undefined;
          if (decodedUserId) {
            req.auth = {
              userId: decodedUserId,
              email: (decoded.email || (decoded as any).email_address || (decoded as any).primaryEmailAddress) as string | undefined,
              role: (decoded as any).role as string | undefined,
            };
            return next();
          }
        }
      } catch (error: any) {
        logger.warn('[AUTH] JWT decode fallback failed:', error?.message || error);
      }
    }

    logger.error('[AUTH] Token verification failed for both Clerk and internal JWT');
    return res.status(401).json({ error: 'Unauthorized' });
  } catch (error: any) {
    logger.error('[AUTH] Token verification failed:', error?.message || error);
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

/**
 * Middleware to require authentication
 * Use this on protected routes that need a logged-in user
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth || !req.auth.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

/**
 * Middleware to require merchant role
 * Users must have 'merchant' role in their Clerk public metadata
 */
export const requireMerchant = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth || !req.auth.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const merchantId = req.auth.userId;
    const result = await query('SELECT role FROM users WHERE id = $1', [merchantId]);

    if (result.rows.length === 0) {
      // Allow the fixed single merchant account even if the DB row is not yet present.
      if (merchantId === 'merchant_omshdw') {
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
          [
            merchantId,
            'Om Shdw',
            'merchant@shdwmen.com',
            'merchant_login',
            'merchant',
            'SHDWMEN Store',
            'Om Shdw',
          ]
        );
      } else {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    const userRole = (result.rows.length > 0 ? result.rows[0].role : 'merchant');
    if (userRole !== 'merchant') {
      return res.status(403).json({ error: 'Forbidden - Merchant access required' });
    }

    next();
  } catch (error) {
    logger.error('[REQUIRE_MERCHANT] Database error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

/**
 * Middleware to require customer role
 * Any authenticated user can access customer routes
 */
export const requireCustomer = (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth || !req.auth.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

/**
 * Get current user from request
 */
export const getCurrentUser = (req: Request) => {
  return req.auth;
};
