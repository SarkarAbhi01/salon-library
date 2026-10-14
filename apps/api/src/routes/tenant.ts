import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, roles, tenantGuard } from '../middleware/auth';
import { parse, tid, DAY, getOffset, toUtc, localDay } from '../lib/util';
import { THEME_MODES, THEME_NAMES } from '../lib/themes';
import { RESERVED, SLUG_RE } from '../lib/site';

const r = Router();
r.use(requireAuth, roles('OWNER'), tenantGuard);

r.get('/dashboard', async (req, res) => {
  const id = tid(req);
  const type = req.user!.tenantType;
  const recent = await prisma.auditLog.findMany({ where: { tenantId: id }, take: 8, orderBy: { createdAt: 'desc' } });
  if (type === 'SALON') {
    const off = await getOffset(id);
    const day = localDay(new Date(), off);
    const s = toUtc(day, '00:00', off), e = new Date(s.getTime() + DAY);
    const [bookings, pending, today, services, rev] = await Promise.all([
      prisma.booking.count({ where: { tenantId: id } }),
      prisma.booking.count({ where: { tenantId: id, status: 'PENDING' } }),
      prisma.booking.count({ where: { tenantId: id, startAt: { gte: s, lt: e }, status: { not: 'CANCELLED' } } }),
      prisma.service.count({ where: { tenantId: id, active: true } }),
      prisma.booking.aggregate({ where: { tenantId: id, status: 'COMPLETED', startAt: { gte: new Date(Date.now() - 30 * DAY) } }, _sum: { agreedPriceCents: true } }),
    ]);
    return res.json({ counts: { bookings, pending_approval: pending, today_bookings: today, services, revenue_30d_inr: Math.round((rev._sum.agreedPriceCents ?? 0) / 100) }, recent });
  }
  // Library dashboards live in /library/dashboard (richer); keep a compact version here for compatibility.
  const [members, batches, students] = await Promise.all([
    prisma.membership.count({ where: { tenantId: id, status: 'ACTIVE' } }),
    prisma.batch.count({ where: { tenantId: id, active: true } }),
    prisma.student.count({ where: { tenantId: id } }),
  ]);
  res.json({ counts: { students, members, batches }, recent });
});

r.get('/profile', async (req, res) => res.json(await prisma.tenant.findUnique({ where: { id: tid(req) } })));
r.patch('/profile', async (req, res) => {
  const d = parse(z.object({
    name: z.string().min(2).optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(),
    chairs: z.number().int().min(1).max(50).optional(), utcOffsetMin: z.number().int().min(-720).max(840).optional(),
    slug: z.string().trim().toLowerCase().optional(),
  }), req.body, res);
  if (!d) return;
  if (d.slug !== undefined) {
    if (!SLUG_RE.test(d.slug)) return res.status(400).json({ error: 'Address must be 3–40 characters: lowercase letters, numbers and hyphens' });
    if (RESERVED.has(d.slug)) return res.status(400).json({ error: 'That address is reserved. Choose another.' });
    const clash = await prisma.tenant.findUnique({ where: { slug: d.slug }, select: { id: true } });
    if (clash && clash.id !== tid(req)) return res.status(409).json({ error: 'That address is already taken' });
  }
  res.json(await prisma.tenant.update({ where: { id: tid(req) }, data: d }));
});

// ── Library theme (only usable while the SuperAdmin has switched the Theme menu on for this library) ──
r.get('/theme', async (req, res) => {
  const t = await prisma.tenant.findUnique({ where: { id: tid(req) }, select: { type: true, themeEnabled: true, themeMode: true, themeName: true } });
  if (!t || t.type !== 'LIBRARY') return res.json({ enabled: false, mode: 'FIXED', name: 'classic' });
  res.json({ enabled: t.themeEnabled, mode: t.themeMode, name: t.themeName });
});
r.put('/theme', async (req, res) => {
  const d = parse(z.object({ mode: z.enum(THEME_MODES), name: z.enum(THEME_NAMES) }), req.body, res);
  if (!d) return;
  const t = await prisma.tenant.findUnique({ where: { id: tid(req) }, select: { type: true, themeEnabled: true } });
  if (!t || t.type !== 'LIBRARY') return res.status(403).json({ error: 'Themes are available for libraries only' });
  if (!t.themeEnabled) return res.status(403).json({ error: 'The Theme option is turned off for your account. Ask the administrator to enable it.' });
  await prisma.tenant.update({ where: { id: tid(req) }, data: { themeMode: d.mode, themeName: d.name } });
  res.json({ enabled: true, mode: d.mode, name: d.name });
});

export default r;
