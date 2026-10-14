import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, roles, tenantGuard, tenantType } from '../middleware/auth';
import { parse, tid, pid, DAY, DATE_RE, TIME_RE, toMin, toUtc, getOffset, audit } from '../lib/util';
import { createSalonBooking, salonSlots } from '../lib/salon';
import { pushToBooking, pushEnabled } from '../lib/push';
import { saveSubscription } from '../lib/subscribe';

const r = Router();
r.use(requireAuth, roles('OWNER'), tenantGuard, tenantType('SALON'));

// ── Services ──
const svc = z.object({ name: z.string().min(2), durationMin: z.number().int().min(5).max(600), basePriceCents: z.number().int().nonnegative(), flexiblePriceMinCents: z.number().int().nonnegative().nullable().optional(), active: z.boolean().optional() })
  .refine(v => v.flexiblePriceMinCents == null || v.basePriceCents == null || v.flexiblePriceMinCents <= v.basePriceCents, { message: 'Flexible minimum cannot exceed base price' });
r.get('/services', async (req, res) => res.json(await prisma.service.findMany({ where: { tenantId: tid(req) }, orderBy: { name: 'asc' } })));
r.post('/services', async (req, res) => { const d = parse(svc, req.body, res); if (d) res.status(201).json(await prisma.service.create({ data: { ...d, tenantId: tid(req) } })); });
r.patch('/services/:id', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2), durationMin: z.number().int().min(5).max(600), basePriceCents: z.number().int().nonnegative(), flexiblePriceMinCents: z.number().int().nonnegative().nullable(), active: z.boolean() }).partial(), req.body, res);
  if (!d) return;
  const x = await prisma.service.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  if (!x.count) return res.status(404).json({ error: 'Service not found' });
  res.json(await prisma.service.findUnique({ where: { id: pid(req) } }));
});

// ── Hours & closures ──
r.get('/hours', async (req, res) => res.json(await prisma.businessHours.findMany({ where: { tenantId: tid(req) }, orderBy: { dayOfWeek: 'asc' } })));
const tm = z.string().regex(TIME_RE, 'use HH:mm').nullable();
r.put('/hours', async (req, res) => {
  const d = parse(z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), open: z.boolean(), morningStart: tm, morningEnd: tm, noonStart: tm, noonEnd: tm, eveningStart: tm, eveningEnd: tm })).max(7), req.body, res);
  if (!d) return;
  for (const x of d) for (const [a, b] of [[x.morningStart, x.morningEnd], [x.noonStart, x.noonEnd], [x.eveningStart, x.eveningEnd]])
    if ((a && !b) || (!a && b) || (a && b && toMin(b) <= toMin(a))) return res.status(400).json({ error: 'Each time window needs a start before its end' });
  const tenantId = tid(req);
  await prisma.$transaction(d.map(x => prisma.businessHours.upsert({ where: { tenantId_dayOfWeek: { tenantId, dayOfWeek: x.dayOfWeek } }, create: { ...x, tenantId }, update: x })));
  res.json({ ok: true });
});

r.get('/closures', async (req, res) => res.json(await prisma.closure.findMany({ where: { tenantId: tid(req), to: { gte: new Date() } }, orderBy: { from: 'asc' } })));
r.post('/emergency-close', async (req, res) => {
  const d = parse(z.object({ from: z.coerce.date(), to: z.coerce.date(), message: z.string().max(300).optional(), cancelBookings: z.boolean().default(false) }), req.body, res);
  if (!d) return;
  if (d.to <= d.from) return res.status(400).json({ error: 'End must be after start' });
  const tenantId = tid(req);
  const closure = await prisma.closure.create({ data: { tenantId, from: d.from, to: d.to, message: d.message } });
  const clash = { tenantId, status: { in: ['PENDING', 'CONFIRMED'] as ('PENDING' | 'CONFIRMED')[] }, startAt: { lt: d.to }, endAt: { gt: d.from } };
  const affected = d.cancelBookings ? (await prisma.booking.updateMany({ where: clash, data: { status: 'CANCELLED' } })).count : await prisma.booking.count({ where: clash });
  await audit(req, 'EMERGENCY_CLOSURE', { from: d.from, to: d.to, cancelled: d.cancelBookings ? affected : 0 });
  res.status(201).json({ closure, affectedBookings: affected, cancelled: d.cancelBookings });
});
r.delete('/closures/:id', async (req, res) => { const x = await prisma.closure.deleteMany({ where: { id: pid(req), tenantId: tid(req) } }); res.status(x.count ? 200 : 404).json({ ok: !!x.count }); });

// ── Bookings (owner view) ──
r.get('/bookings', async (req, res) => {
  const q = parse(z.object({ from: z.string().regex(DATE_RE).optional(), to: z.string().regex(DATE_RE).optional(), status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(), q: z.string().optional() }), req.query, res);
  if (!q) return;
  const off = await getOffset(tid(req));
  const where: any = { tenantId: tid(req) };
  if (q.from || q.to) where.startAt = { ...(q.from && { gte: toUtc(q.from, '00:00', off) }), ...(q.to && { lt: new Date(toUtc(q.to, '00:00', off).getTime() + DAY) }) };
  if (q.status) where.status = q.status;
  if (q.q) where.OR = [{ customerName: { contains: q.q, mode: 'insensitive' } }, { customerPhone: { contains: q.q } }, { code: { contains: q.q.replace(/\s+/g, '').toUpperCase() } }];
  res.json(await prisma.booking.findMany({ where, include: { service: { select: { name: true, durationMin: true } } }, orderBy: { startAt: 'asc' }, take: 500 }));
});

// Backwards-compatible: bookings for one local day
r.get('/slots', async (req, res) => {
  const q = parse(z.object({ date: z.string().regex(DATE_RE) }), req.query, res);
  if (!q) return;
  const off = await getOffset(tid(req));
  const s = toUtc(q.date, '00:00', off);
  res.json(await prisma.booking.findMany({ where: { tenantId: tid(req), startAt: { gte: s, lt: new Date(s.getTime() + DAY) } }, include: { service: true }, orderBy: { startAt: 'asc' } }));
});

r.get('/availability', async (req, res) => {
  const q = parse(z.object({ date: z.string().regex(DATE_RE), serviceId: z.string() }), req.query, res);
  if (!q) return;
  const s = await prisma.service.findFirst({ where: { id: q.serviceId, tenantId: tid(req) } });
  if (!s) return res.status(404).json({ error: 'Service not found' });
  res.json(await salonSlots(tid(req), q.date, s.durationMin));
});

r.post('/bookings', async (req, res) => {
  const d = parse(z.object({ serviceId: z.string(), customerName: z.string().min(2), customerPhone: z.string().min(6).optional(), startAt: z.coerce.date(), priceCents: z.number().int().nonnegative().optional(), notes: z.string().max(300).optional(), force: z.boolean().default(false) }), req.body, res);
  if (!d) return;
  const b = await createSalonBooking({ tenantId: tid(req), serviceId: d.serviceId, customerName: d.customerName, customerPhone: d.customerPhone, startAt: d.startAt, offeredPriceCents: d.priceCents, source: 'OWNER', force: d.force, notes: d.notes });
  await audit(req, 'BOOKING_CREATED', { id: b.id });
  res.status(201).json(b);
});

const NEXT: Record<string, string[]> = { PENDING: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['COMPLETED', 'CANCELLED'], CANCELLED: [], COMPLETED: [] };
r.patch('/bookings/:id', async (req, res) => {
  const d = parse(z.object({ status: z.enum(['CONFIRMED', 'CANCELLED', 'COMPLETED']) }), req.body, res);
  if (!d) return;
  const b = await prisma.booking.findFirst({ where: { id: pid(req), tenantId: tid(req) } });
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (!NEXT[b.status].includes(d.status)) return res.status(409).json({ error: `Cannot change a ${b.status.toLowerCase()} booking to ${d.status.toLowerCase()}` });
  const u = await prisma.booking.update({ where: { id: b.id }, data: { status: d.status }, include: { service: true } });
  await audit(req, `BOOKING_${d.status}`, { id: b.id });
  const say = { CONFIRMED: ['Booking confirmed ✅', `${u.service.name} is confirmed. See you there!`], CANCELLED: ['Booking cancelled', 'The salon could not take this appointment. Please book another time.'], COMPLETED: ['Thank you for visiting!', 'Your appointment is complete.'] }[d.status];
  void pushToBooking(b.id, { title: say[0], body: say[1], url: `/track?code=${b.code ?? ''}`, tag: b.code ?? b.id });
  res.json(u);
});

// Salon owner: allow browser alerts for new booking requests
r.get('/push/status', (_, res) => res.json({ enabled: pushEnabled }));
r.post('/push/subscribe', async (req, res) => { if (await saveSubscription(req, res, { tenantId: tid(req), userId: req.user!.id })) res.json({ ok: true }); });

export default r;
