import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, roles } from '../middleware/auth';
import { parse, pid, audit } from '../lib/util';
import { uniqueSlug } from '../lib/site';

const r = Router();
r.use(requireAuth, roles('SUPER_ADMIN'));

r.get('/dashboard', async (_, res) => {
  const [salons, libraries, users, activeTenants, students, recent] = await Promise.all([
    prisma.tenant.count({ where: { type: 'SALON' } }), prisma.tenant.count({ where: { type: 'LIBRARY' } }),
    prisma.user.count(), prisma.tenant.count({ where: { status: 'ACTIVE' } }), prisma.student.count(),
    prisma.auditLog.findMany({ take: 10, orderBy: { createdAt: 'desc' } }),
  ]);
  res.json({ counts: { salons, libraries, users, activeTenants, students }, recent });
});

r.get('/tenants', async (_, res) => {
  const rows = await prisma.tenant.findMany({
    include: { users: { where: { role: 'OWNER' }, select: { id: true, email: true, name: true, active: true } }, subscription: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows.map(({ users, ...t }) => ({ ...t, owner: users[0] ?? null })));
});

r.post('/tenants', async (req, res) => {
  const d = parse(z.object({
    type: z.enum(['SALON', 'LIBRARY']), name: z.string().min(2), ownerName: z.string().min(2), email: z.string().email(),
    password: z.string().min(8), phone: z.string().optional(), address: z.string().optional(), trialDays: z.number().int().min(0).max(365).default(14),
  }), req.body, res);
  if (!d) return;
  const slug = await uniqueSlug(d.name, undefined, d.type === 'SALON' ? 'salon' : 'library');
  const result = await prisma.$transaction(async tx => {
    const tenant = await tx.tenant.create({ data: { type: d.type, name: d.name, slug, phone: d.phone, address: d.address, trialEndsAt: d.trialDays ? new Date(Date.now() + d.trialDays * 86400000) : null } });
    const owner = await tx.user.create({ data: { tenantId: tenant.id, name: d.ownerName, email: d.email.toLowerCase(), passwordHash: await bcrypt.hash(d.password, 12), role: 'OWNER' } });
    if (d.type === 'LIBRARY') await tx.librarySetting.create({ data: { tenantId: tenant.id } });
    await tx.auditLog.create({ data: { action: 'TENANT_CREATED', actorId: req.user!.id, tenantId: tenant.id, metadata: { type: d.type } } });
    return { tenant, owner: { id: owner.id, email: owner.email } };
  });
  res.status(201).json(result);
});

r.patch('/tenants/:id', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2).optional(), phone: z.string().nullable().optional(), address: z.string().nullable().optional(), trialEndsAt: z.coerce.date().nullable().optional() }), req.body, res);
  if (!d) return;
  const t = await prisma.tenant.update({ where: { id: pid(req) }, data: d });
  await audit(req, 'TENANT_UPDATED', { tenantId: t.id });
  res.json(t);
});

r.patch('/tenants/:id/status', async (req, res) => {
  const d = parse(z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']), enabled: z.boolean().optional() }), req.body, res);
  if (!d) return;
  const t = await prisma.tenant.update({ where: { id: pid(req) }, data: { status: d.status, enabled: d.enabled ?? d.status === 'ACTIVE' } });
  await prisma.auditLog.create({ data: { action: `TENANT_${d.status}`, actorId: req.user!.id, tenantId: t.id } });
  res.json(t);
});

r.post('/tenants/:id/reset-owner-password', async (req, res) => {
  const d = parse(z.object({ password: z.string().min(8) }), req.body, res);
  if (!d) return;
  const owner = await prisma.user.findFirst({ where: { tenantId: pid(req), role: 'OWNER' } });
  if (!owner) return res.status(404).json({ error: 'Owner not found' });
  await prisma.user.update({ where: { id: owner.id }, data: { passwordHash: await bcrypt.hash(d.password, 12) } });
  await prisma.auditLog.create({ data: { action: 'OWNER_PASSWORD_RESET', actorId: req.user!.id, tenantId: pid(req) } });
  res.json({ ok: true });
});

r.post('/tenants/:id/subscription', async (req, res) => {
  const d = parse(z.object({ planId: z.string() }), req.body, res);
  if (!d) return;
  const plan = await prisma.plan.findFirst({ where: { id: d.planId, active: true } });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const tenantId = pid(req);
  res.json(await prisma.tenantSubscription.upsert({ where: { tenantId }, create: { tenantId, planId: plan.id }, update: { planId: plan.id, startedAt: new Date(), status: 'ACTIVE' } }));
});

const planBody = z.object({ name: z.string().min(2), priceCents: z.number().int().nonnegative(), billing: z.enum(['MONTHLY', 'COMMISSION']), commissionPct: z.number().min(0).max(100).optional(), trialDays: z.number().int().min(0).default(0), active: z.boolean().default(true) });
r.post('/plans', async (req, res) => { const d = parse(planBody, req.body, res); if (d) res.status(201).json(await prisma.plan.create({ data: d })); });
r.patch('/plans/:id', async (req, res) => { const d = parse(planBody.partial(), req.body, res); if (d) res.json(await prisma.plan.update({ where: { id: pid(req) }, data: d })); });
r.get('/plans', async (_, res) => res.json(await prisma.plan.findMany({ orderBy: { createdAt: 'desc' } })));

// One row per scope (null tenant = all tenants) so the current state can be read back and toggled.
r.get('/maintenance', async (_, res) => res.json(await prisma.maintenanceSetting.findMany({ orderBy: { createdAt: 'asc' } })));
r.patch('/maintenance', async (req, res) => {
  const d = parse(z.object({ enabled: z.boolean(), tenantId: z.string().nullable().default(null), message: z.string().max(300).optional() }), req.body, res);
  if (!d) return;
  const existing = await prisma.maintenanceSetting.findFirst({ where: { tenantId: d.tenantId } });
  const data = { enabled: d.enabled, message: d.message ?? null };
  const m = existing ? await prisma.maintenanceSetting.update({ where: { id: existing.id }, data }) : await prisma.maintenanceSetting.create({ data: { ...data, tenantId: d.tenantId } });
  await audit(req, d.enabled ? 'MAINTENANCE_ON' : 'MAINTENANCE_OFF', { tenantId: d.tenantId });
  res.json(m);
});

// ── Theme menu (libraries): SuperAdmin decides who sees the "Theme" menu ──
r.patch('/tenants/:id/theme-access', async (req, res) => {
  const d = parse(z.object({ enabled: z.boolean() }), req.body, res);
  if (!d) return;
  const x = await prisma.tenant.updateMany({ where: { id: pid(req), type: 'LIBRARY' }, data: { themeEnabled: d.enabled } });
  if (!x.count) return res.status(404).json({ error: 'Library not found' });
  await audit(req, d.enabled ? 'THEME_ACCESS_ON' : 'THEME_ACCESS_OFF', { tenantId: pid(req) });
  res.json({ ok: true, enabled: d.enabled });
});
r.patch('/theme-access', async (req, res) => {
  const d = parse(z.object({ enabled: z.boolean() }), req.body, res);
  if (!d) return;
  const x = await prisma.tenant.updateMany({ where: { type: 'LIBRARY' }, data: { themeEnabled: d.enabled } });
  await audit(req, d.enabled ? 'THEME_ACCESS_ALL_ON' : 'THEME_ACCESS_ALL_OFF', { libraries: x.count });
  res.json({ ok: true, enabled: d.enabled, libraries: x.count });
});

export default r;
