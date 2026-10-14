import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db';
import { parse, pid, DATE_RE } from '../lib/util';
import { withDefaults } from '../lib/site';
import { createSalonBooking, salonSlots } from '../lib/salon';
import { normaliseCode } from '../lib/codes';
import { vapid } from '../env';
import { pushEnabled } from '../lib/push';
import { saveSubscription } from '../lib/subscribe';

const r = Router();
r.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));
const live = { status: 'ACTIVE' as const, enabled: true };

r.get('/salons', async (_, res) => res.json(await prisma.tenant.findMany({ where: { type: 'SALON', ...live }, select: { id: true, name: true, address: true, phone: true }, orderBy: { name: 'asc' } })));
r.get('/libraries', async (_, res) => res.json(await prisma.tenant.findMany({ where: { type: 'LIBRARY', ...live }, select: { id: true, name: true, address: true }, orderBy: { name: 'asc' } })));

r.get('/salons/:id', async (req, res) => {
  const t = await prisma.tenant.findFirst({ where: { id: pid(req), type: 'SALON', ...live }, select: { id: true, name: true, address: true, phone: true } });
  if (!t) return res.status(404).json({ error: 'Salon not found' });
  const closure = await prisma.closure.findFirst({ where: { tenantId: t.id, from: { lte: new Date() }, to: { gte: new Date() } } });
  const services = await prisma.service.findMany({ where: { tenantId: t.id, active: true }, orderBy: { name: 'asc' } });
  // The flexible minimum is deliberately not exposed to customers.
  res.json({ ...t, closedNow: closure ? { message: closure.message, until: closure.to } : null, services: services.map(s => ({ id: s.id, name: s.name, durationMin: s.durationMin, basePriceCents: s.basePriceCents, flexible: s.flexiblePriceMinCents != null })) });
});

r.get('/salons/:id/availability', async (req, res) => {
  const q = parse(z.object({ date: z.string().regex(DATE_RE), serviceId: z.string() }), req.query, res);
  if (!q) return;
  const s = await prisma.service.findFirst({ where: { id: q.serviceId, tenantId: pid(req), active: true, tenant: live } });
  if (!s) return res.status(404).json({ error: 'Service not found' });
  res.json(await salonSlots(pid(req), q.date, s.durationMin));
});

r.post('/salons/:id/bookings', async (req, res) => {
  const d = parse(z.object({ serviceId: z.string(), customerName: z.string().min(2).max(80), customerPhone: z.string().min(8).max(20), startAt: z.coerce.date(), offeredPriceCents: z.number().int().positive().optional(), notes: z.string().trim().max(300).optional() }), req.body, res);
  if (!d) return;
  const b = await createSalonBooking({ tenantId: pid(req), ...d, source: 'PUBLIC' });
  res.status(201).json({ id: b.id, code: b.code, status: b.status, startAt: b.startAt, service: b.service.name, priceCents: b.agreedPriceCents, message: 'Request received. The salon will confirm shortly.' });
});

// ── Booking status / tracking ──
// A booking is looked up by its id OR its tracking code (SB-XXXXXX). The customer must also give the phone number used for the
// booking, so nobody can read another customer's booking by guessing a code.
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);
const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many lookups. Please try again in a few minutes.' } });

async function findSalonBooking(idOrCode: string, phone: string) {
  const p = last10(phone);
  if (p.length < 8) return null;
  const code = normaliseCode(idOrCode);
  const b = await prisma.booking.findFirst({
    where: { OR: [{ id: idOrCode }, { code }], tenant: { type: 'SALON' } },
    include: { service: { select: { name: true } }, tenant: { select: { name: true, phone: true, slug: true } } },
  });
  return b && last10(b.customerPhone).endsWith(p) ? b : null;
}
const salonView = (b: NonNullable<Awaited<ReturnType<typeof findSalonBooking>>>) => ({ kind: 'SALON', id: b.id, code: b.code, status: b.status, startAt: b.startAt, endAt: b.endAt, service: b.service.name, priceCents: b.agreedPriceCents, salon: b.tenant.name, salonPhone: b.tenant.phone, salonSlug: b.tenant.slug, customerName: b.customerName });

r.get('/bookings/:id', trackLimiter, async (req, res) => {
  const b = await findSalonBooking(pid(req), String(req.query.phone || ''));
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  res.json(salonView(b));
});

/** One tracking page for both products: SB-… = salon appointment, LB-… = library seat. Phone (or library card no.) proves it is yours. */
r.get('/track', trackLimiter, async (req, res) => {
  const q = parse(z.object({ code: z.string().min(3).max(40), phone: z.string().min(3).max(30) }), req.query, res);
  if (!q) return;
  const code = normaliseCode(q.code);
  if (code.startsWith('LB-')) {
    const b = await prisma.seatBooking.findUnique({ where: { code }, include: { student: { select: { name: true, phone: true, cardNo: true } }, seat: { select: { label: true, room: { select: { name: true } } } }, tenant: { select: { name: true, phone: true, status: true, enabled: true } } } });
    const proof = q.phone.trim().toUpperCase();
    const ok = !!b && (proof === b.student.cardNo.toUpperCase() || (last10(proof).length >= 8 && last10(b.student.phone).endsWith(last10(proof))));
    if (!b || !ok) return res.status(404).json({ error: 'Booking not found. Check the code and your mobile number / library card number.' });
    return res.json({ kind: 'LIBRARY', id: b.id, code: b.code, status: b.status, startAt: b.startAt, endAt: b.endAt, seat: `${b.seat.room.name} · ${b.seat.label}`, library: b.tenant.name, libraryPhone: b.tenant.phone, checkInAt: b.checkInAt, checkOutAt: b.checkOutAt });
  }
  const b = await findSalonBooking(q.code, q.phone);
  if (!b) return res.status(404).json({ error: 'Booking not found. Check the code and the phone number used for the booking.' });
  res.json(salonView(b));
});

// ── Push notifications (customer opts in on the tracking page) ──
r.get('/push/key', (_, res) => res.json({ enabled: pushEnabled, publicKey: pushEnabled ? vapid.publicKey : null }));
r.post('/push/subscribe', trackLimiter, async (req, res) => {
  const d = parse(z.object({ code: z.string().min(3), phone: z.string().min(3), subscription: z.any() }), req.body, res);
  if (!d) return;
  const b = await findSalonBooking(d.code, d.phone);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (await saveSubscription(req, res, { tenantId: b.tenantId, bookingId: b.id }, d.subscription)) res.json({ ok: true });
});

// ── Public salon website (/<slug>) — only this salon's own data is ever returned ──
r.get('/site/:slug', async (req, res) => {
  const t = await prisma.tenant.findFirst({ where: { slug: String(req.params.slug).toLowerCase(), ...live }, select: { type: true } });
  if (!t) return res.status(404).json({ error: 'Page not found' });
  res.json({ type: t.type });
});

r.get('/salon-site/:slug', async (req, res) => {
  const t = await prisma.tenant.findFirst({ where: { slug: String(req.params.slug).toLowerCase(), type: 'SALON', ...live }, select: { id: true, name: true, slug: true, address: true, phone: true } });
  if (!t) return res.status(404).json({ error: 'Salon not found' });
  const [closure, services, hours] = await Promise.all([
    prisma.closure.findFirst({ where: { tenantId: t.id, from: { lte: new Date() }, to: { gte: new Date() } } }),
    prisma.service.findMany({ where: { tenantId: t.id, active: true }, orderBy: { name: 'asc' } }),
    prisma.businessHours.findMany({ where: { tenantId: t.id }, orderBy: { dayOfWeek: 'asc' } }),
  ]);
  res.json({
    ...t,
    closedNow: closure ? { message: closure.message, until: closure.to } : null,
    // The flexible minimum price stays private; customers only learn that an offer is allowed.
    services: services.map(s => ({ id: s.id, name: s.name, durationMin: s.durationMin, basePriceCents: s.basePriceCents, flexible: s.flexiblePriceMinCents != null })),
    hours: hours.map(h => ({ dayOfWeek: h.dayOfWeek, open: h.open, windows: ([[h.morningStart, h.morningEnd], [h.noonStart, h.noonEnd], [h.eveningStart, h.eveningEnd]] as [string | null, string | null][]).filter(w => w[0] && w[1]) })),
  });
});

// ── Public library website (/<slug>) ──
const siteLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions. Please try again later.' } });
const noPage = (slug: string) => prisma.tenant.findFirst({ where: { slug: slug.toLowerCase(), type: 'LIBRARY', ...live }, include: { libraryPage: true } });

r.get('/library-site/:slug', async (req, res) => {
  // Libraries that never opened the Website editor still get a page with sensible defaults.
  const t = (await noPage(String(req.params.slug)));
  if (!t || (t.libraryPage && !t.libraryPage.published)) return res.status(404).json({ error: 'Library page not found' });
  const [plans, feedback] = await Promise.all([
    prisma.membershipPlan.findMany({ where: { tenantId: t.id, active: true }, orderBy: { months: 'asc' }, select: { id: true, name: true, months: true, priceCents: true, description: true } }),
    prisma.feedback.findMany({ where: { tenantId: t.id, approved: true }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, name: true, rating: true, message: true } }),
  ]);
  res.json({ id: t.id, name: t.name, slug: t.slug, phone: t.phone, address: t.address, content: withDefaults(t.libraryPage?.content), plans, feedback });
});

r.post('/library-site/:slug/enquiries', siteLimiter, async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(80), mobile: z.string().regex(/^[0-9]{10}$/, 'Enter a 10-digit mobile number'), email: z.union([z.string().email(), z.literal('')]).optional(), person: z.enum(['Student', 'Parent / Guardian', 'Other']).default('Student'), message: z.string().trim().min(5).max(1000), hp: z.string().optional() }), req.body, res);
  if (!d) return;
  if (d.hp) return res.status(201).json({ ok: true }); // honeypot: bots fill hidden fields
  const t = await noPage(String(req.params.slug));
  if (!t || (t.libraryPage && !t.libraryPage.published)) return res.status(404).json({ error: 'Library not found' });
  await prisma.enquiry.create({ data: { tenantId: t.id, name: d.name, mobile: d.mobile, email: d.email || null, person: d.person, message: d.message } });
  res.status(201).json({ ok: true });
});

r.post('/library-site/:slug/feedback', siteLimiter, async (req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(2).max(80), rating: z.number().int().min(1).max(5), message: z.string().trim().min(5).max(1000), hp: z.string().optional() }), req.body, res);
  if (!d) return;
  if (d.hp) return res.status(201).json({ ok: true });
  const t = await noPage(String(req.params.slug));
  if (!t || (t.libraryPage && !t.libraryPage.published)) return res.status(404).json({ error: 'Library not found' });
  await prisma.feedback.create({ data: { tenantId: t.id, name: d.name, rating: d.rating, message: d.message } });
  res.status(201).json({ ok: true });
});

export default r;
