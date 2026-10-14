import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../env';
import { requireAuth, roles, tenantGuard, tenantType } from '../middleware/auth';
import { parse, tid, pid, DAY, MIN, getSettings, getOffset, localDay, toUtc, fineFor, nextInvoiceNo, computeRefund } from '../lib/util';
import { seatMap, createSeatBooking, checkIn, checkOut, closeOpenSessions } from '../lib/seats';
import { admit, cancelMembership } from '../lib/members';
import { sweep } from '../lib/jobs';
import { pushEnabled } from '../lib/push';
import { saveSubscription } from '../lib/subscribe';

const r = Router();
r.use(requireAuth, roles('STUDENT'), tenantGuard, tenantType('LIBRARY'));
const sid = (req: any) => req.user!.id as string;

// ───────────── Browser push (opt-in) ─────────────
r.get('/push/status', (_, res) => res.json({ enabled: pushEnabled }));
r.post('/push/subscribe', async (req, res) => { if (await saveSubscription(req, res, { tenantId: tid(req), studentId: sid(req) })) res.json({ ok: true }); });

// ───────────── Profile, card, goals ─────────────
r.get('/me', async (req, res) => {
  const s = await prisma.student.findFirst({ where: { id: sid(req), tenantId: tid(req) }, omit: { passwordHash: true }, include: { tenant: { select: { name: true, phone: true, address: true } } } });
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});
r.patch('/me', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2), phone: z.string().min(6).nullable(), address: z.string().max(200).nullable(), examGoal: z.string().max(100).nullable() }).partial(), req.body, res);
  if (d) res.json(await prisma.student.update({ where: { id: sid(req) }, data: d, omit: { passwordHash: true } }));
});
r.get('/card', async (req, res) => {
  const s = await prisma.student.findUniqueOrThrow({ where: { id: sid(req) }, include: { tenant: { select: { name: true } }, memberships: { where: { status: 'ACTIVE' }, orderBy: { endDate: 'desc' }, take: 1 } } });
  const m = s.memberships[0];
  res.json({ library: s.tenant.name, name: s.name, cardNo: s.cardNo, memberSince: s.createdAt, validUntil: m?.endDate ?? null, status: m ? 'ACTIVE' : 'NO_ACTIVE_MEMBERSHIP' });
});
r.patch('/goals', async (req, res) => {
  const d = parse(z.object({ dailyGoalMin: z.number().int().min(15).max(1440), weeklyGoalMin: z.number().int().min(15).max(10080) }).partial(), req.body, res);
  if (d) { const s = await prisma.student.update({ where: { id: sid(req) }, data: d }); res.json({ dailyGoalMin: s.dailyGoalMin, weeklyGoalMin: s.weeklyGoalMin }); }
});

// ───────────── Membership plans, purchase, cancel ─────────────
r.get('/plans', async (req, res) => res.json({
  plans: await prisma.membershipPlan.findMany({ where: { tenantId: tid(req), active: true }, orderBy: { months: 'asc' } }),
  batches: await prisma.batch.findMany({ where: { tenantId: tid(req), active: true }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] }),
  rules: await getSettings(tid(req)).then(s => ({ refundFullHours: s.refundFullHours, refundProratePct: s.refundProratePct, bookingCancelMinBefore: s.bookingCancelMinBefore, bookingGraceMin: s.bookingGraceMin })),
}));
r.get('/memberships', async (req, res) => res.json(await prisma.membership.findMany({ where: { studentId: sid(req) }, include: { plan: { select: { name: true } }, batch: { select: { name: true, startTime: true, endTime: true } } }, orderBy: { createdAt: 'desc' } })));
r.post('/memberships/:id/cancel', async (req, res) => {
  const m = await prisma.membership.findFirst({ where: { id: pid(req), studentId: sid(req) } });
  if (!m) return res.status(404).json({ error: 'Membership not found' });
  res.json(await cancelMembership(tid(req), m.id, { reason: 'Cancelled by student' }));
});
r.get('/memberships/:id/refund-preview', async (req, res) => {
  const m = await prisma.membership.findFirst({ where: { id: pid(req), studentId: sid(req), status: 'ACTIVE' }, include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } } });
  if (!m) return res.status(404).json({ error: 'Active membership not found' });
  const paid = m.payments.reduce((n, p) => n + p.amountCents - p.refundedCents, 0);
  res.json({ paidCents: paid, refundCents: computeRefund(m, paid, await getSettings(tid(req))) });
});

// ───────────── Payments (online) ─────────────
r.post('/payments/checkout', async (req, res) => {
  const d = parse(z.object({ kind: z.enum(['MEMBERSHIP', 'FINE']), planId: z.string().optional(), batchId: z.string().optional(), issueId: z.string().optional(), startDate: z.coerce.date().optional() }), req.body, res);
  if (!d) return;
  const tenantId = tid(req);
  let amount = 0; const meta: any = { kind: d.kind };
  let issueId: string | undefined;
  if (d.kind === 'MEMBERSHIP') {
    const p = d.planId && await prisma.membershipPlan.findFirst({ where: { id: d.planId, tenantId, active: true } });
    if (!p) return res.status(404).json({ error: 'Plan not found' });
    amount = p.priceCents; Object.assign(meta, { planId: p.id, months: p.months, batchId: d.batchId ?? null, startDate: (d.startDate && d.startDate > new Date() ? d.startDate : new Date()).toISOString() });
  } else {
    const i = d.issueId && await prisma.bookIssue.findFirst({ where: { id: d.issueId, studentId: sid(req), finePaid: false, fineCents: { gt: 0 }, returnedAt: { not: null } } });
    if (!i) return res.status(404).json({ error: 'No unpaid fine found' });
    amount = i.fineCents; issueId = i.id;
  }
  if (amount <= 0) return res.status(400).json({ error: 'Nothing to pay' });
  const p = await prisma.payment.create({ data: { tenantId, studentId: sid(req), kind: d.kind, amountCents: amount, method: 'ONLINE', status: 'PENDING', gatewayRef: `mock_${crypto.randomUUID()}`, meta, issueId } });
  res.status(201).json({ paymentId: p.id, amountCents: amount, provider: env.paymentProvider, gatewayRef: p.gatewayRef });
});
/** DEV ONLY gateway: marks the payment as paid. For production, replace with a verified gateway webhook (e.g. Razorpay/Stripe signature check). */
r.post('/payments/:id/confirm', async (req, res) => {
  if (env.paymentProvider !== 'mock') return res.status(501).json({ error: 'Online payments are confirmed by the payment gateway webhook' });
  const p = await prisma.payment.findFirst({ where: { id: pid(req), studentId: sid(req), tenantId: tid(req), status: 'PENDING' } });
  if (!p) return res.status(404).json({ error: 'Pending payment not found' });
  const meta = (p.meta ?? {}) as any;
  if (p.kind === 'MEMBERSHIP') {
    const out = await admit({ tenantId: p.tenantId, studentId: sid(req), planId: meta.planId, batchId: meta.batchId, months: meta.months, feeCents: p.amountCents, startDate: new Date(meta.startDate), method: 'ONLINE', paymentId: p.id, gatewayRef: p.gatewayRef ?? undefined });
    return res.json(out.payment);
  }
  const [, paid] = await prisma.$transaction(async tx => [
    await tx.bookIssue.update({ where: { id: p.issueId! }, data: { finePaid: true } }),
    await tx.payment.update({ where: { id: p.id }, data: { status: 'PAID', paidAt: new Date(), invoiceNo: await nextInvoiceNo(p.tenantId) } }),
  ]);
  res.json(paid);
});
r.post('/payments/:id/fail', async (req, res) => { await prisma.payment.updateMany({ where: { id: pid(req), studentId: sid(req), status: 'PENDING' }, data: { status: 'FAILED' } }); res.json({ ok: true }); });
r.get('/payments', async (req, res) => res.json(await prisma.payment.findMany({ where: { studentId: sid(req) }, orderBy: { createdAt: 'desc' }, take: 100 })));
r.get('/payments/:id/invoice', async (req, res) => {
  const p = await prisma.payment.findFirst({ where: { id: pid(req), studentId: sid(req), status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, include: { student: { select: { name: true, cardNo: true, email: true, phone: true } }, tenant: { select: { name: true, address: true, phone: true } }, membership: { include: { plan: true } }, issue: { include: { book: { select: { title: true } } } } } });
  if (!p) return res.status(404).json({ error: 'Invoice not found' });
  res.json(p);
});

// ───────────── Seats ─────────────
r.get('/seats', async (req, res) => {
  await sweep(tid(req));
  const start = req.query.start ? new Date(String(req.query.start)) : new Date();
  const end = req.query.end ? new Date(String(req.query.end)) : new Date(start.getTime() + 60 * MIN);
  if (isNaN(+start) || isNaN(+end) || end <= start) return res.status(400).json({ error: 'Invalid time range' });
  res.json(await seatMap(tid(req), start, end, false));
});
r.get('/bookings', async (req, res) => {
  await sweep(tid(req));
  res.json(await prisma.seatBooking.findMany({ where: { studentId: sid(req) }, include: { seat: { select: { label: true, room: { select: { name: true, floor: true } } } } }, orderBy: { startAt: 'desc' }, take: 100 }));
});
r.post('/bookings', async (req, res) => {
  const d = parse(z.object({ seatId: z.string(), startAt: z.coerce.date(), endAt: z.coerce.date() }), req.body, res);
  if (d) res.status(201).json(await createSeatBooking({ tenantId: tid(req), studentId: sid(req), ...d }));
});
r.post('/bookings/:id/check-in', async (req, res) => {
  if (!(await prisma.seatBooking.findFirst({ where: { id: pid(req), studentId: sid(req) } }))) return res.status(404).json({ error: 'Booking not found' });
  res.json(await checkIn(pid(req), tid(req)));
});
r.post('/bookings/:id/check-out', async (req, res) => {
  if (!(await prisma.seatBooking.findFirst({ where: { id: pid(req), studentId: sid(req) } }))) return res.status(404).json({ error: 'Booking not found' });
  res.json(await checkOut(pid(req), tid(req)));
});
r.post('/bookings/:id/cancel', async (req, res) => {
  const b = await prisma.seatBooking.findFirst({ where: { id: pid(req), studentId: sid(req), status: 'BOOKED' } });
  if (!b) return res.status(404).json({ error: 'Upcoming booking not found' });
  const set = await getSettings(tid(req));
  if (b.startAt.getTime() - Date.now() < set.bookingCancelMinBefore * MIN) return res.status(409).json({ error: `Bookings can only be cancelled ${set.bookingCancelMinBefore} minutes or more before the start time` });
  await prisma.seatBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});

// ───────────── Study sessions, breaks, stats ─────────────
const netSec = (s: { startedAt: Date; endedAt: Date | null; breakSeconds: number; breaks?: { startedAt: Date; endedAt: Date | null }[] }, now = new Date()) => {
  const end = s.endedAt ?? now;
  const live = (s.breaks ?? []).filter(b => !b.endedAt).reduce((n, b) => n + (now.getTime() - b.startedAt.getTime()) / 1000, 0);
  return Math.max(0, (end.getTime() - s.startedAt.getTime()) / 1000 - s.breakSeconds - live);
};
r.get('/sessions/active', async (req, res) => res.json(await prisma.studySession.findFirst({ where: { studentId: sid(req), endedAt: null }, include: { breaks: { orderBy: { startedAt: 'desc' } } } })));
r.post('/sessions/start', async (req, res) => {
  const d = parse(z.object({ subject: z.string().max(80).optional(), bookingId: z.string().optional() }), req.body ?? {}, res); if (!d) return;
  if (await prisma.studySession.findFirst({ where: { studentId: sid(req), endedAt: null } })) return res.status(409).json({ error: 'A session is already running' });
  const b = d.bookingId ? await prisma.seatBooking.findFirst({ where: { id: d.bookingId, studentId: sid(req), status: 'CHECKED_IN' } }) : await prisma.seatBooking.findFirst({ where: { studentId: sid(req), status: 'CHECKED_IN' } });
  res.status(201).json(await prisma.studySession.create({ data: { tenantId: tid(req), studentId: sid(req), subject: d.subject, seatBookingId: b?.id } }));
});
r.post('/sessions/break/start', async (req, res) => {
  const s = await prisma.studySession.findFirst({ where: { studentId: sid(req), endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
  if (!s) return res.status(404).json({ error: 'No running session' });
  if (s.breaks.length) return res.status(409).json({ error: 'Already on a break' });
  res.status(201).json(await prisma.studyBreak.create({ data: { sessionId: s.id } }));
});
r.post('/sessions/break/end', async (req, res) => {
  const s = await prisma.studySession.findFirst({ where: { studentId: sid(req), endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
  const b = s?.breaks[0];
  if (!s || !b) return res.status(404).json({ error: 'No break in progress' });
  const now = new Date();
  await prisma.$transaction([prisma.studyBreak.update({ where: { id: b.id }, data: { endedAt: now } }), prisma.studySession.update({ where: { id: s.id }, data: { breakSeconds: { increment: Math.round((now.getTime() - b.startedAt.getTime()) / 1000) } } })]);
  res.json({ ok: true });
});
r.post('/sessions/stop', async (req, res) => {
  if (!(await prisma.studySession.findFirst({ where: { studentId: sid(req), endedAt: null } }))) return res.status(404).json({ error: 'No running session' });
  await closeOpenSessions(sid(req));
  res.json({ ok: true });
});
r.get('/sessions', async (req, res) => {
  const rows = await prisma.studySession.findMany({ where: { studentId: sid(req) }, include: { breaks: true }, orderBy: { startedAt: 'desc' }, take: 100 });
  res.json(rows.map(s => ({ ...s, studySeconds: Math.round(netSec(s)), breakCount: s.breaks.length })));
});
r.get('/stats', async (req, res) => {
  const off = await getOffset(tid(req)), now = new Date();
  const today = localDay(now, off);
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = toUtc(new Date(new Date(today + 'T00:00:00Z').getTime() - dow * DAY).toISOString().slice(0, 10), '00:00', off);
  const [s, rows] = await Promise.all([
    prisma.student.findUniqueOrThrow({ where: { id: sid(req) }, select: { dailyGoalMin: true, weeklyGoalMin: true } }),
    prisma.studySession.findMany({ where: { studentId: sid(req), startedAt: { gte: new Date(Math.min(weekStart.getTime(), now.getTime() - 6 * DAY)) } }, include: { breaks: { where: { endedAt: null } } } }),
  ]);
  const perDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) perDay[localDay(new Date(now.getTime() - i * DAY), off)] = 0;
  let week = 0;
  for (const x of rows) { const m = netSec(x) / 60; const k = localDay(x.startedAt, off); if (k in perDay) perDay[k] += m; if (x.startedAt >= weekStart) week += m; }
  res.json({ todayMin: Math.round(perDay[today] ?? 0), weekMin: Math.round(week), dailyGoalMin: s.dailyGoalMin, weeklyGoalMin: s.weeklyGoalMin, last7: Object.entries(perDay).map(([date, m]) => ({ date, minutes: Math.round(m) })) });
});

// ───────────── Books ─────────────
r.get('/books', async (req, res) => {
  const q = String(req.query.q || '').trim(), cat = String(req.query.category || '');
  res.json(await prisma.book.findMany({ where: { tenantId: tid(req), ...(cat && { category: cat }), ...(req.query.available === '1' && { available: { gt: 0 } }), ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { author: { contains: q, mode: 'insensitive' } }, { isbn: { contains: q } }] }) }, orderBy: { title: 'asc' }, take: 200, select: { id: true, title: true, author: true, category: true, shelf: true, isbn: true, copies: true, available: true } }));
});
r.get('/books/categories', async (req, res) => res.json((await prisma.book.findMany({ where: { tenantId: tid(req), category: { not: null } }, distinct: ['category'], select: { category: true } })).map(c => c.category)));
r.get('/issues', async (req, res) => {
  const set = await getSettings(tid(req)), now = new Date();
  const rows = await prisma.bookIssue.findMany({ where: { studentId: sid(req) }, include: { book: { select: { title: true, author: true } } }, orderBy: { issuedAt: 'desc' }, take: 100 });
  res.json(rows.map(i => ({ ...i, overdue: !i.returnedAt && i.dueAt < now, accruedFineCents: i.returnedAt ? i.fineCents : fineFor(i.dueAt, now, set.finePerDayCents) })));
});

// ───────────── Notifications & announcements ─────────────
r.get('/notifications', async (req, res) => {
  await sweep(tid(req));
  const [items, unread] = await Promise.all([prisma.notification.findMany({ where: { studentId: sid(req) }, orderBy: { createdAt: 'desc' }, take: 100 }), prisma.notification.count({ where: { studentId: sid(req), readAt: null } })]);
  res.json({ items, unread });
});
r.post('/notifications/read', async (req, res) => { await prisma.notification.updateMany({ where: { studentId: sid(req), readAt: null }, data: { readAt: new Date() } }); res.json({ ok: true }); });
r.get('/announcements', async (req, res) => res.json(await prisma.announcement.findMany({ where: { tenantId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 20 })));

export default r;
