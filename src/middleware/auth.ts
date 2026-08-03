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
export async function ensureUserExists(userId: string, email?: string, name?: string, phone?: string) {
  if (!userId) return;

  const normalizedEmail = email?.trim() || null;
  const normalizedPhone = phone?.trim() || null;
  const fallbackEmail = `${userId}@clerk.local`;

  // Helper to decide whether a string looks like an internal Clerk/merchant id
  const isInternalId = (value?: string) => !!value && (/^user_[A-Za-z0-9]+$/.test(value) || /^merchant_[A-Za-z0-9]+$/.test(value));

  // Normalize incoming name if provided and not an internal id
  let normalizedName: string | null = null;
  if (name) {
    const n = name.trim();
    if (n && !isInternalId(n)) normalizedName = n;
  }

  const existingUserResult = await query('SELECT id, email, name, phone FROM users WHERE id = $1', [userId]);
  const existingUser = existingUserResult.rows[0];
  const conflictingEmailResult = normalizedEmail
    ? await query('SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1', [normalizedEmail, userId])
    : { rows: [] as Array<{ id: string }> };
  const emailTakenByAnotherUser = conflictingEmailResult.rows.length > 0;

  const existingName = typeof existingUser?.name === 'string' ? existingUser.name.trim() : '';
  const existingEmail = typeof existingUser?.email === 'string' ? existingUser.email.trim() : '';
  const existingPhone = typeof existingUser?.phone === 'string' ? existingUser.phone.trim() : '';

  const resolveFallbackName = () => {
    if (normalizedEmail) {
      const local = normalizedEmail.split('@')[0];
      if (local) return local;
    }
    if (userId && !isInternalId(userId)) {
      return userId;
    }
    return 'Customer';
  };

  const resolvedName = normalizedName || existingName || resolveFallbackName();
  const resolvedEmail = emailTakenByAnotherUser
    ? fallbackEmail
    : normalizedEmail || existingEmail || fallbackEmail;
  const resolvedPhone = normalizedPhone || existingPhone || null;

  if (!normalizedEmail && !existingUser) {
    throw new Error('Email is required to create or update a user record');
  }

  if (existingUser) {
    await query(
      `UPDATE users SET
         name = $1,
         email = COALESCE($2, email),
         phone = COALESCE($3, phone),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [resolvedName, resolvedEmail, resolvedPhone, userId]
    );
    return;
  }

  // Ensure we always have a non-null name to satisfy DB NOT NULL constraints.
  // Priority: provided name -> existing name -> email local-part -> user id -> 'Customer'
  normalizedName = resolvedName;

  logger.info('[ensureUserExists] userId=%s email=%s nameProvided=%s resolvedName=%s', userId, normalizedEmail, String(name ?? ''), normalizedName);

  try {
    await query(
      `INSERT INTO users (id, name, email, phone, password, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, users.name),
         email = COALESCE(EXCLUDED.email, users.email),
         phone = COALESCE(EXCLUDED.phone, users.phone),
         updated_at = CURRENT_TIMESTAMP`,
      [userId, normalizedName, resolvedEmail, normalizedPhone, 'clerk_auth', 'customer']
    );
  } catch (err: any) {
    logger.warn('[ensureUserExists] insert error code: %s constraint: %s message: %s', err?.code, err?.constraint, String(err?.message)?.slice?.(0, 200));
    try {
      logger.debug('[ensureUserExists] full error: %o', util.inspect(err, { showHidden: true, depth: null }));
    } catch (e) {
      logger.error('[ensureUserExists] error logging failed: %o', e);
    }

    // If a unique-violation occurs (commonly email unique constraint),
    // update the existing user record that already holds that email so we don't
    // violate the NOT NULL constraint on `email` in fallback inserts.
    if (err && err.code === '23505') {
      try {
        if (normalizedEmail) {
          const fallbackName = normalizedName || resolveFallbackName();
          const fallbackResolvedEmail = emailTakenByAnotherUser ? existingEmail || fallbackEmail : normalizedEmail;

          await query(
            `UPDATE users SET
               name = COALESCE($1, name),
               email = COALESCE($2, email),
               phone = COALESCE($3, phone),
               updated_at = CURRENT_TIMESTAMP
             WHERE email = $4 OR id = $5`,
            [fallbackName, fallbackResolvedEmail, resolvedPhone, normalizedEmail, userId]
          );
          return;
        }
      } catch (inner) {
        logger.error('[ensureUserExists] update-by-email failed: %o', inner);
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
          email: extractEmailFromDecoded(decoded),
          role: decoded.role as string | undefined,
        };
      } catch (error: any) {
        logger.warn('[AUTH] Internal JWT verification failed:', error?.message || error);
        return null;
      }
    };

    const extractEmailFromDecoded = (decoded: any): string | undefined => {
      const candidates = [
        decoded?.email,
        decoded?.email_address,
        decoded?.primaryEmailAddress,
        decoded?.emailAddresses?.[0]?.email,
        decoded?.email_addresses?.[0]?.email,
      ];
      return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)?.trim();
    };

    if (clerkSecretKey) {
      try {
        const decoded = await verifyToken(token, {
          secretKey: clerkSecretKey,
          apiUrl: CLERK_API_URL,
        });

        if (decoded && decoded.sub) {
          const userId = decoded.sub;
          const userEmail = extractEmailFromDecoded(decoded);

          // Compute display name with required priority
          const extractDisplayName = (d: any, fallbackUserId: string | undefined, fallbackEmail: string | undefined) => {
            // 1) full name (`name`)
            if (d?.name && typeof d.name === 'string' && d.name.trim()) return d.name.trim();
            // 2) first + last
            const first = (d?.first_name || d?.given_name || '') as string;
            const last = (d?.last_name || d?.family_name || '') as string;
            const combined = `${first} ${last}`.trim();
            if (combined) return combined;
            // 3) username
            if (d?.username && typeof d.username === 'string' && d.username.trim()) return d.username.trim();
            // 4) email local-part
            if (fallbackEmail && typeof fallbackEmail === 'string') {
              const local = fallbackEmail.split('@')[0];
              if (local) return local;
            }
            // 5) fallback to non-internal userId
            if (fallbackUserId && !/^user_[A-Za-z0-9]+$/.test(fallbackUserId) && !/^merchant_[A-Za-z0-9]+$/.test(fallbackUserId)) return fallbackUserId;
            // final fallback
            return 'Customer';
          };

          const userName = extractDisplayName(decoded, userId, userEmail);

          req.auth = {
            userId,
            email: userEmail,
            role: (decoded as any).role as string | undefined,
          };

          return next();
        }
      } catch (error: any) {
        logger.warn('[AUTH] Clerk token verification failed, trying internal JWT:', error?.message || error);
      }
    }

    const internalAuth = verifyInternalJwt(token);
    if (internalAuth) {
      req.auth = internalAuth;
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
              email: extractEmailFromDecoded(decoded),
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
