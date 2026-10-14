import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env';
import { prisma } from '../db';

export type Role = 'SUPER_ADMIN' | 'OWNER' | 'STUDENT';
export type AuthUser = { id: string; role: Role; tenantId?: string; tenantType?: 'SALON' | 'LIBRARY' };
declare global { namespace Express { interface Request { user?: AuthUser } } }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(h.slice(7), env.jwtSecret) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export const roles = (...allowed: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || !allowed.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

/** Owner/student must belong to a tenant of the given type (stops a salon owner calling library APIs and vice-versa). */
export const tenantType = (type: 'SALON' | 'LIBRARY') => (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.tenantType !== type || !req.user.tenantId) return res.status(403).json({ error: 'Forbidden for this account type' });
  next();
};

/** Re-checks tenant status + maintenance mode on every request, so suspending a tenant takes effect immediately. */
export async function tenantGuard(req: Request, res: Response, next: NextFunction) {
  const tenantId = req.user?.tenantId;
  if (!tenantId) return res.status(403).json({ error: 'No tenant' });
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true, enabled: true } });
  if (!t || t.status !== 'ACTIVE' || !t.enabled) return res.status(403).json({ error: 'This account is not active' });
  const m = await prisma.maintenanceSetting.findFirst({ where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] } });
  if (m) return res.status(503).json({ error: m.message || 'Under maintenance. Please try again later.' });
  next();
}

export const sign = (u: AuthUser) => jwt.sign(u, env.jwtSecret, { expiresIn: '8h' });
