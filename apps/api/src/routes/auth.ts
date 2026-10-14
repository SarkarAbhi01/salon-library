import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { sign, requireAuth } from '../middleware/auth';
import { parse } from '../lib/util';

const r = Router();
export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again later.' } });

r.post('/login', authLimiter, async (req, res) => {
  const d = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body, res);
  if (!d) return;
  const u = await prisma.user.findUnique({ where: { email: d.email.toLowerCase() }, include: { tenant: true } });
  if (!u || !u.active || !(await bcrypt.compare(d.password, u.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  if (u.role !== 'SUPER_ADMIN' && (u.tenant?.status !== 'ACTIVE' || !u.tenant.enabled)) return res.status(403).json({ error: 'Tenant is not active' });
  res.json({
    token: sign({ id: u.id, role: u.role, tenantId: u.tenantId ?? undefined, tenantType: u.tenant?.type }),
    user: { id: u.id, email: u.email, name: u.name, role: u.role, tenant: u.tenant && { id: u.tenant.id, type: u.tenant.type, name: u.tenant.name } },
  });
});

r.post('/forgot-password', authLimiter, async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });
  const u = await prisma.user.findUnique({ where: { email } });
  if (u) {
    const token = crypto.randomUUID();
    await prisma.passwordReset.create({ data: { userId: u.id, token, expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
    // TODO: send by email. Never log tokens in production.
    if (process.env.NODE_ENV !== 'production') console.log(`[DEV RESET] ${email}: ${token}`);
  }
  res.json({ message: 'If the account exists, a reset link has been generated.' });
});

r.post('/reset-password', authLimiter, async (req, res) => {
  const d = parse(z.object({ token: z.string(), password: z.string().min(8) }), req.body, res);
  if (!d) return;
  const t = await prisma.passwordReset.findUnique({ where: { token: d.token } });
  if (!t || t.usedAt || t.expiresAt < new Date()) return res.status(400).json({ error: 'Reset token invalid or expired' });
  await prisma.$transaction([
    prisma.user.update({ where: { id: t.userId }, data: { passwordHash: await bcrypt.hash(d.password, 12) } }),
    prisma.passwordReset.update({ where: { id: t.id }, data: { usedAt: new Date() } }),
  ]);
  res.json({ message: 'Password reset successful' });
});

r.post('/change-password', requireAuth, async (req, res) => {
  const d = parse(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }), req.body, res);
  if (!d) return;
  if (req.user!.role === 'STUDENT') {
    const s = await prisma.student.findUnique({ where: { id: req.user!.id } });
    if (!s || !(await bcrypt.compare(d.currentPassword, s.passwordHash))) return res.status(400).json({ error: 'Current password incorrect' });
    await prisma.student.update({ where: { id: s.id }, data: { passwordHash: await bcrypt.hash(d.newPassword, 12) } });
    return res.json({ message: 'Password changed' });
  }
  const u = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!u || !(await bcrypt.compare(d.currentPassword, u.passwordHash))) return res.status(400).json({ error: 'Current password incorrect' });
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(d.newPassword, 12) } });
  res.json({ message: 'Password changed' });
});

export default r;
