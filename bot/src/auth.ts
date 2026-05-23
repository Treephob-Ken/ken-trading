// JWT authentication middleware and helpers for multi-user mode.
//
// When MULTI_USER=true:
//   - All /api/* routes require a valid JWT in `Authorization: Bearer <token>`.
//   - /auth/register, /auth/login, /auth/me are public.
//   - /admin/* additionally requires is_admin=true in the payload.
//
// When MULTI_USER is not set: this module exports no-op pass-through middleware
// so single-tenant behavior is preserved without code changes elsewhere.

import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { User } from './users.js'

export const MULTI_USER = (process.env.MULTI_USER ?? '').toLowerCase() === 'true'

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) {
    throw new Error(
      'JWT_SECRET is not set. Multi-user mode requires this env var. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
  }
  return s
}

export interface JwtPayload {
  sub: string   // userId
  email: string
  isAdmin: boolean
  iat?: number
  exp?: number
}

// Augment Express request so TypeScript knows req.user is always populated
// inside routes guarded by requireAuth.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export function signToken(user: Pick<User, 'id' | 'email' | 'isAdmin'>): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, isAdmin: user.isAdmin }
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// When MULTI_USER is off, these are no-ops (single-tenant pass-through).
// When on, the token must be valid or we return 401.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!MULTI_USER) {
    next()
    return
  }
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ error: 'Unauthorized — missing Bearer token' })
    return
  }
  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Unauthorized — invalid or expired token' })
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!MULTI_USER) {
    next()
    return
  }
  // requireAdmin always comes after requireAuth, so req.user is set if we're here
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: 'Forbidden — admin access required' })
    return
  }
  next()
}
