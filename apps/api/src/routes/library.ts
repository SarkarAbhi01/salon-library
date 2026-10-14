import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { requireAuth, roles, tenantGuard, tenantType } from '../middleware/auth';
import { parse, tid, pid, DAY, MIN, HttpError, audit, getSettings, getOffset, nextInvoiceNo, fineFor, localDay, toUtc, notify } from '../lib/util';
import { seatMap, createSeatBooking, checkIn, checkOut } from '../lib/seats';
import { admit, cancelMembership } from '../lib/members';
import { sweep } from '../lib/jobs';
import { newCardNo } from './studentAuth';
import { RESERVED, SLUG_RE, siteContent, uniqueSlug, withDefaults } from '../lib/site';

const r = Router();
r.use(requireAuth, roles('OWNER'), tenantGuard, tenantType('LIBRARY'));
const OPEN = ['BOOKED', 'CHECKED_IN'] as ('BOOKED' | 'CHECKED_IN')[];

// ───────────── Dashboard & reports ─────────────
r.get('/dashboard', async (req, res) => {
  const id = tid(req), now = new Date();
  await sweep(id);
  const off = await getOffset(id);
  const monthStart = toUtc(localDay(now, off).slice(0, 8) + '01', '00:00', off);
  const [students, activeMembers, seats, occupied, reserved, activeSessions, revMonth, revTotal, overdue, finesDue, expiring, batches] = await Promise.all([
    prisma.student.count({ where: { tenantId: id } }),
    prisma.membership.count({ where: { tenantId: id, status: 'ACTIVE' } }),
    prisma.seat.count({ where: { tenantId: id, status: 'AVAILABLE' } }),
    prisma.seatBooking.count({ where: { tenantId: id, status: 'CHECKED_IN' } }),
    prisma.seatBooking.count({ where: { tenantId: id, status: 'BOOKED', startAt: { lte: now }, endAt: { gt: now } } }),
    prisma.studySession.count({ where: { tenantId: id, endedAt: null } }),
    prisma.payment.aggregate({ where: { tenantId: id, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] }, paidAt: { gte: monthStart } }, _sum: { amountCents: true, refundedCents: true } }),
    prisma.payment.aggregate({ where: { tenantId: id, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, _sum: { amountCents: true, refundedCents: true } }),
    prisma.bookIssue.count({ where: { tenantId: id, returnedAt: null, dueAt: { lt: now } } }),
    prisma.bookIssue.count({ where: { tenantId: id, fineCents: { gt: 0 }, finePaid: false, returnedAt: { not: null } } }),
    prisma.membership.count({ where: { tenantId: id, status: 'ACTIVE', endDate: { lte: new Date(now.getTime() + 7 * DAY) } } }),
    prisma.batch.count({ where: { tenantId: id, active: true } }),
  ]);
  // Utilisation: booked hours (non-cancelled) in the last 7 days vs. seat capacity at 12 open hours/day
  const bks = await prisma.seatBooking.findMany({ where: { tenantId: id, status: { in: ['CHECKED_IN', 'COMPLETED'] }, startAt: { gte: new Date(now.getTime() - 7 * DAY) } }, select: { startAt: true, endAt: true } });
  const usedH = bks.reduce((n, b) => n + (b.endAt.getTime() - b.startAt.getTime()) / 3600000, 0);
  const util = seats ? Math.min(100, Math.round((usedH / (seats * 12 * 7)) * 100)) : 0;
  const net = (a: any) => Math.round(((a._sum.amountCents ?? 0) - (a._sum.refundedCents ?? 0)) / 100);
  res.json({
    counts: { total_students: students, active_members: activeMembers, total_seats: seats, occupied_now: occupied, reserved_now: reserved, occupancy_pct: seats ? Math.round(((occupied + reserved) / seats) * 100) : 0, active_sessions: activeSessions, revenue_month_inr: net(revMonth), revenue_total_inr: net(revTotal), seat_utilization_7d_pct: util, overdue_books: overdue, unpaid_fines: finesDue, expiring_in_7d: expiring, batches },
    recent: await prisma.auditLog.findMany({ where: { tenantId: id }, take: 8, orderBy: { createdAt: 'desc' } }),
  });
});

r.get('/reports', async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query, res);
  if (!q) return;
  const id = tid(req), off = await getOffset(id), since = new Date(Date.now() - q.days * DAY);
  const [pays, students, bookings, issues, sessions] = await Promise.all([
    prisma.payment.findMany({ where: { tenantId: id, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] }, paidAt: { gte: since } }, select: { paidAt: true, amountCents: true, refundedCents: true, kind: true } }),
    prisma.student.findMany({ where: { tenantId: id, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.seatBooking.findMany({ where: { tenantId: id, startAt: { gte: since } }, select: { startAt: true, endAt: true, status: true, seat: { select: { label: true, room: { select: { name: true } } } } } }),
    prisma.bookIssue.count({ where: { tenantId: id, issuedAt: { gte: since } } }),
    prisma.studySession.findMany({ where: { tenantId: id, startedAt: { gte: since } }, select: { startedAt: true, endedAt: true, breakSeconds: true } }),
  ]);
  const byDay: Record<string, { date: string; revenueInr: number; newStudents: number; bookings: number; studyHours: number }> = {};
  const day = (d: Date) => (byDay[localDay(d, off)] ??= { date: localDay(d, off), revenueInr: 0, newStudents: 0, bookings: 0, studyHours: 0 });
  pays.forEach(p => { day(p.paidAt!).revenueInr += (p.amountCents - p.refundedCents) / 100; });
  students.forEach(s => { day(s.createdAt).newStudents++; });
  bookings.forEach(b => { day(b.startAt).bookings++; });
  sessions.forEach(s => { day(s.startedAt).studyHours += Math.max(0, ((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 1000 - s.breakSeconds) / 3600; });
  const bySeat: Record<string, { seat: string; hours: number; bookings: number }> = {};
  bookings.filter(b => ['CHECKED_IN', 'COMPLETED'].includes(b.status)).forEach(b => {
    const k = `${b.seat.room.name} · ${b.seat.label}`;
    const e = (bySeat[k] ??= { seat: k, hours: 0, bookings: 0 });
    e.hours += (b.endAt.getTime() - b.startAt.getTime()) / 3600000; e.bookings++;
  });
  const noShow = bookings.filter(b => b.status === 'EXPIRED').length;
  res.json({
    days: q.days, daily: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, revenueInr: Math.round(d.revenueInr), studyHours: +d.studyHours.toFixed(1) })),
    topSeats: Object.values(bySeat).sort((a, b) => b.hours - a.hours).slice(0, 10).map(s => ({ ...s, hours: +s.hours.toFixed(1) })),
    totals: { revenueInr: Math.round(pays.reduce((n, p) => n + p.amountCents - p.refundedCents, 0) / 100), newStudents: students.length, seatBookings: bookings.length, noShows: noShow, booksIssued: issues },
  });
});

// ───────────── Settings ─────────────
const settingsBody = z.object({ finePerDayCents: z.number().int().min(0), loanDays: z.number().int().min(1).max(120), maxBooksPerStudent: z.number().int().min(1).max(20), bookingGraceMin: z.number().int().min(1).max(240), maxBookingHours: z.number().int().min(1).max(16), bookingCancelMinBefore: z.number().int().min(0).max(1440), refundFullHours: z.number().int().min(0).max(720), refundProratePct: z.number().int().min(0).max(100) }).partial();
r.get('/settings', async (req, res) => res.json(await getSettings(tid(req))));
r.put('/settings', async (req, res) => { const d = parse(settingsBody, req.body, res); if (!d) return; await getSettings(tid(req)); res.json(await prisma.librarySetting.update({ where: { tenantId: tid(req) }, data: d })); });

// ───────────── Batches ─────────────
const batchBody = z.object({ name: z.string().min(2), dayOfWeek: z.number().int().min(0).max(6), startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/), capacity: z.number().int().positive(), active: z.boolean() });
const usage = () => ({ memberships: { where: { status: 'ACTIVE' as const, endDate: { gte: new Date() } } } });
r.get('/batches', async (req, res) => {
  const rows = await prisma.batch.findMany({ where: { tenantId: tid(req) }, include: { _count: { select: usage() } }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
  res.json(rows.map(b => ({ ...b, _count: { memberships: b._count.memberships } })));
});
r.post('/batches', async (req, res) => { const d = parse(batchBody.extend({ active: z.boolean().default(true) }), req.body, res); if (d) res.status(201).json(await prisma.batch.create({ data: { ...d, tenantId: tid(req) } })); });
r.patch('/batches/:id', async (req, res) => {
  const d = parse(batchBody.partial(), req.body, res); if (!d) return;
  const x = await prisma.batch.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  if (!x.count) return res.status(404).json({ error: 'Batch not found' });
  res.json(await prisma.batch.findUnique({ where: { id: pid(req) } }));
});
r.get('/today', async (req, res) => {
  const off = await getOffset(tid(req));
  const day = new Date(Date.now() + off * MIN).getUTCDay();
  const rows = await prisma.batch.findMany({ where: { tenantId: tid(req), dayOfWeek: day, active: true }, include: { _count: { select: usage() } } });
  res.json(rows.map(b => ({ ...b, seatsLeft: Math.max(0, b.capacity - b._count.memberships) })));
});

// ───────────── Students ─────────────
r.get('/students', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await prisma.student.findMany({
    where: { tenantId: tid(req), ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }, { cardNo: { contains: q.toUpperCase() } }] }) },
    select: { id: true, name: true, email: true, phone: true, cardNo: true, status: true, createdAt: true, examGoal: true, memberships: { where: { status: 'ACTIVE' }, select: { endDate: true, plan: { select: { name: true } } }, orderBy: { endDate: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' }, take: 300,
  });
  res.json(rows);
});
r.post('/students', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2), email: z.string().email().optional(), phone: z.string().min(6).optional(), address: z.string().optional(), examGoal: z.string().optional() }), req.body, res);
  if (!d) return;
  const tempPassword = crypto.randomBytes(5).toString('hex');
  const s = await prisma.student.create({ data: { ...d, email: d.email?.toLowerCase(), tenantId: tid(req), cardNo: await newCardNo(tid(req)), passwordHash: await bcrypt.hash(tempPassword, 12) } });
  await audit(req, 'STUDENT_CREATED', { id: s.id });
  res.status(201).json({ student: { id: s.id, name: s.name, cardNo: s.cardNo }, tempPassword });
});
r.get('/students/:id', async (req, res) => {
  const s = await prisma.student.findFirst({ where: { id: pid(req), tenantId: tid(req) }, omit: { passwordHash: true }, include: { memberships: { orderBy: { createdAt: 'desc' }, include: { plan: true, batch: true } }, issues: { orderBy: { issuedAt: 'desc' }, take: 20, include: { book: { select: { title: true } } } }, payments: { orderBy: { createdAt: 'desc' }, take: 20 } } });
  if (!s) return res.status(404).json({ error: 'Student not found' });
  res.json(s);
});
r.patch('/students/:id', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(2), phone: z.string().nullable(), address: z.string().nullable(), examGoal: z.string().nullable(), status: z.enum(['ACTIVE', 'BLOCKED']) }).partial(), req.body, res);
  if (!d) return;
  const x = await prisma.student.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  if (!x.count) return res.status(404).json({ error: 'Student not found' });
  if (d.status === 'BLOCKED') await prisma.seatBooking.updateMany({ where: { studentId: pid(req), status: 'BOOKED' }, data: { status: 'CANCELLED' } });
  res.json({ ok: true });
});
r.post('/students/:id/reset-password', async (req, res) => {
  const tempPassword = crypto.randomBytes(5).toString('hex');
  const x = await prisma.student.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: { passwordHash: await bcrypt.hash(tempPassword, 12) } });
  if (!x.count) return res.status(404).json({ error: 'Student not found' });
  res.json({ tempPassword });
});
r.post('/students/:id/reissue-card', async (req, res) => {
  const cardNo = await newCardNo(tid(req));
  const x = await prisma.student.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: { cardNo } });
  if (!x.count) return res.status(404).json({ error: 'Student not found' });
  await audit(req, 'CARD_REISSUED', { id: pid(req) });
  res.json({ cardNo });
});

// ───────────── Membership plans, admissions, cancellations ─────────────
const planBody = z.object({ name: z.string().min(2), months: z.number().int().min(1).max(36), priceCents: z.number().int().nonnegative(), description: z.string().max(300).optional(), active: z.boolean() });
r.get('/plans', async (req, res) => res.json(await prisma.membershipPlan.findMany({ where: { tenantId: tid(req) }, orderBy: { months: 'asc' } })));
r.post('/plans', async (req, res) => { const d = parse(planBody.extend({ active: z.boolean().default(true) }), req.body, res); if (d) res.status(201).json(await prisma.membershipPlan.create({ data: { ...d, tenantId: tid(req) } })); });
r.patch('/plans/:id', async (req, res) => {
  const d = parse(planBody.partial(), req.body, res); if (!d) return;
  const x = await prisma.membershipPlan.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});

r.get('/memberships', async (req, res) => res.json(await prisma.membership.findMany({ where: { tenantId: tid(req) }, include: { student: { select: { name: true, cardNo: true } }, plan: { select: { name: true } }, batch: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 300 })));
r.post('/memberships', async (req, res) => {
  const d = parse(z.object({
    studentId: z.string().optional(),
    newStudent: z.object({ name: z.string().min(2), phone: z.string().min(6).optional(), email: z.string().email().optional() }).optional(),
    planId: z.string().optional(), batchId: z.string().optional(), months: z.number().int().min(1).max(36).optional(), feeCents: z.number().int().nonnegative().optional(),
    startDate: z.coerce.date().default(() => new Date()), method: z.enum(['CASH', 'UPI']).default('CASH'),
  }).refine(v => v.studentId || v.newStudent, { message: 'studentId or newStudent required' }).refine(v => v.planId || (v.months && v.feeCents != null), { message: 'Choose a plan or give months and fee' }), req.body, res);
  if (!d) return;
  const tenantId = tid(req);
  let months = d.months!, fee = d.feeCents!;
  if (d.planId) {
    const p = await prisma.membershipPlan.findFirst({ where: { id: d.planId, tenantId, active: true } });
    if (!p) return res.status(404).json({ error: 'Plan not found' });
    months = d.months ?? p.months; fee = d.feeCents ?? p.priceCents;
  }
  let studentId = d.studentId, tempPassword: string | undefined;
  if (!studentId) {
    tempPassword = crypto.randomBytes(5).toString('hex');
    const s = await prisma.student.create({ data: { tenantId, name: d.newStudent!.name, phone: d.newStudent!.phone, email: d.newStudent!.email?.toLowerCase(), cardNo: await newCardNo(tenantId), passwordHash: await bcrypt.hash(tempPassword, 12) } });
    studentId = s.id;
  }
  const out = await admit({ tenantId, studentId, planId: d.planId, batchId: d.batchId, months, feeCents: fee, startDate: d.startDate, method: d.method });
  await audit(req, 'MEMBERSHIP_ADMITTED', { studentId, months, fee });
  res.status(201).json({ ...out, studentId, tempPassword });
});
r.post('/memberships/:id/cancel', async (req, res) => {
  const d = parse(z.object({ refundCents: z.number().int().nonnegative().optional(), reason: z.string().max(200).optional() }), req.body ?? {}, res);
  if (!d) return;
  const out = await cancelMembership(tid(req), pid(req), { override: d.refundCents, reason: d.reason });
  await audit(req, 'MEMBERSHIP_CANCELLED', { id: pid(req), ...out });
  res.json(out);
});

// ───────────── Rooms & seats ─────────────
r.get('/rooms', async (req, res) => res.json(await prisma.room.findMany({ where: { tenantId: tid(req) }, include: { _count: { select: { seats: true } } }, orderBy: [{ floor: 'asc' }, { name: 'asc' }] })));
r.post('/rooms', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(1).max(60), floor: z.number().int().min(-5).max(100).default(1), rows: z.number().int().min(0).max(30).default(0), cols: z.number().int().min(0).max(30).default(0), prefix: z.string().max(4).default('S') }), req.body, res);
  if (!d) return;
  const room = await prisma.room.create({ data: { tenantId: tid(req), name: d.name, floor: d.floor } });
  const seats = [];
  for (let i = 0; i < d.rows; i++) for (let j = 0; j < d.cols; j++) seats.push({ tenantId: tid(req), roomId: room.id, label: `${d.prefix}${i * d.cols + j + 1}`, row: i, col: j });
  if (seats.length) await prisma.seat.createMany({ data: seats });
  res.status(201).json({ ...room, seatsCreated: seats.length });
});
r.patch('/rooms/:id', async (req, res) => {
  const d = parse(z.object({ name: z.string().min(1), floor: z.number().int() }).partial(), req.body, res); if (!d) return;
  const x = await prisma.room.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});
r.delete('/rooms/:id', async (req, res) => {
  if (await prisma.seatBooking.count({ where: { tenantId: tid(req), status: { in: OPEN }, seat: { roomId: pid(req) } } })) return res.status(409).json({ error: 'Room has active seat bookings' });
  const x = await prisma.room.deleteMany({ where: { id: pid(req), tenantId: tid(req) } });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});
r.post('/rooms/:id/seats', async (req, res) => {
  const d = parse(z.object({ label: z.string().min(1).max(12), row: z.number().int().min(0).default(0), col: z.number().int().min(0).default(0) }), req.body, res); if (!d) return;
  const room = await prisma.room.findFirst({ where: { id: pid(req), tenantId: tid(req) } });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.status(201).json(await prisma.seat.create({ data: { ...d, tenantId: tid(req), roomId: room.id } }));
});
r.patch('/seats/:id', async (req, res) => {
  const d = parse(z.object({ label: z.string().min(1).max(12), status: z.enum(['AVAILABLE', 'MAINTENANCE']) }).partial(), req.body, res); if (!d) return;
  const x = await prisma.seat.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});
r.delete('/seats/:id', async (req, res) => {
  if (await prisma.seatBooking.count({ where: { seatId: pid(req), status: { in: OPEN } } })) return res.status(409).json({ error: 'Seat has active bookings' });
  const x = await prisma.seat.deleteMany({ where: { id: pid(req), tenantId: tid(req) } });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});

r.get('/seat-map', async (req, res) => {
  await sweep(tid(req));
  const start = req.query.start ? new Date(String(req.query.start)) : new Date();
  const end = req.query.end ? new Date(String(req.query.end)) : new Date(start.getTime() + MIN);
  if (isNaN(+start) || isNaN(+end)) return res.status(400).json({ error: 'Invalid start/end' });
  res.json(await seatMap(tid(req), start, end, true));
});

// ───────────── Seat bookings, check-in / check-out ─────────────
r.get('/seat-bookings', async (req, res) => {
  await sweep(tid(req));
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json(await prisma.seatBooking.findMany({
    where: { tenantId: tid(req), ...(status && { status: status as any }), ...(req.query.active === '1' && { status: { in: OPEN } }) },
    include: { student: { select: { name: true, cardNo: true } }, seat: { select: { label: true, room: { select: { name: true } } } } }, orderBy: { startAt: 'desc' }, take: 300,
  }));
});
r.post('/seat-bookings', async (req, res) => {
  const d = parse(z.object({ studentId: z.string(), seatId: z.string(), startAt: z.coerce.date(), endAt: z.coerce.date() }), req.body, res);
  if (!d) return;
  res.status(201).json(await createSeatBooking({ tenantId: tid(req), ...d, byOwner: true }));
});
r.post('/seat-bookings/:id/check-in', async (req, res) => res.json(await checkIn(pid(req), tid(req), true)));
r.post('/seat-bookings/:id/check-out', async (req, res) => res.json(await checkOut(pid(req), tid(req))));
r.post('/seat-bookings/:id/cancel', async (req, res) => {
  const x = await prisma.seatBooking.updateMany({ where: { id: pid(req), tenantId: tid(req), status: 'BOOKED' }, data: { status: 'CANCELLED' } });
  res.status(x.count ? 200 : 409).json(x.count ? { ok: true } : { error: 'Only upcoming bookings can be cancelled' });
});
/** Front-desk scan: one call checks a student in, or out if they are already inside. */
r.post('/checkin-by-card', async (req, res) => {
  const d = parse(z.object({ cardNo: z.string().min(3) }), req.body, res); if (!d) return;
  const s = await prisma.student.findFirst({ where: { tenantId: tid(req), cardNo: d.cardNo.trim().toUpperCase() } });
  if (!s) return res.status(404).json({ error: 'Card not found' });
  if (s.status !== 'ACTIVE') return res.status(403).json({ error: 'Student is blocked' });
  const inside = await prisma.seatBooking.findFirst({ where: { studentId: s.id, status: 'CHECKED_IN' } });
  if (inside) { await checkOut(inside.id, tid(req)); return res.json({ action: 'CHECKED_OUT', student: s.name }); }
  const now = new Date(), set = await getSettings(tid(req));
  const b = await prisma.seatBooking.findFirst({ where: { studentId: s.id, status: 'BOOKED', startAt: { lte: new Date(now.getTime() + 15 * MIN) }, endAt: { gt: now } }, orderBy: { startAt: 'asc' } });
  if (!b) return res.status(404).json({ error: `No booking in the check-in window (${set.bookingGraceMin} min grace)` });
  await checkIn(b.id, tid(req));
  res.json({ action: 'CHECKED_IN', student: s.name });
});

// ───────────── Books ─────────────
const bookBody = z.object({ title: z.string().min(1).max(200), author: z.string().min(1).max(120), isbn: z.string().max(20).optional(), category: z.string().max(60).optional(), shelf: z.string().max(30).optional(), copies: z.number().int().min(1).max(500) });
r.get('/books', async (req, res) => {
  const q = String(req.query.q || '').trim(), cat = String(req.query.category || '');
  res.json(await prisma.book.findMany({ where: { tenantId: tid(req), ...(cat && { category: cat }), ...(req.query.available === '1' && { available: { gt: 0 } }), ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { author: { contains: q, mode: 'insensitive' } }, { isbn: { contains: q } }] }) }, orderBy: { title: 'asc' }, take: 300 }));
});
r.get('/books/categories', async (req, res) => res.json((await prisma.book.findMany({ where: { tenantId: tid(req), category: { not: null } }, distinct: ['category'], select: { category: true } })).map(c => c.category)));
r.post('/books', async (req, res) => { const d = parse(bookBody, req.body, res); if (d) res.status(201).json(await prisma.book.create({ data: { ...d, available: d.copies, tenantId: tid(req) } })); });
r.patch('/books/:id', async (req, res) => {
  const d = parse(bookBody.partial(), req.body, res); if (!d) return;
  const b = await prisma.book.findFirst({ where: { id: pid(req), tenantId: tid(req) } });
  if (!b) return res.status(404).json({ error: 'Book not found' });
  const out = b.copies - b.available;
  if (d.copies != null && d.copies < out) return res.status(409).json({ error: `${out} copies are currently issued` });
  res.json(await prisma.book.update({ where: { id: b.id }, data: { ...d, ...(d.copies != null && { available: d.copies - out }) } }));
});
r.delete('/books/:id', async (req, res) => {
  if (await prisma.bookIssue.count({ where: { bookId: pid(req), returnedAt: null } })) return res.status(409).json({ error: 'Book has copies currently issued' });
  const x = await prisma.book.deleteMany({ where: { id: pid(req), tenantId: tid(req) } });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});

// ───────────── Issue / return / fines ─────────────
r.get('/issues', async (req, res) => {
  const st = String(req.query.status || 'open'), now = new Date(), set = await getSettings(tid(req));
  const where: any = { tenantId: tid(req), ...(st === 'open' && { returnedAt: null }), ...(st === 'overdue' && { returnedAt: null, dueAt: { lt: now } }), ...(st === 'returned' && { returnedAt: { not: null } }), ...(st === 'fines' && { fineCents: { gt: 0 }, finePaid: false }) };
  const rows = await prisma.bookIssue.findMany({ where, include: { book: { select: { title: true } }, student: { select: { name: true, cardNo: true } } }, orderBy: { dueAt: 'asc' }, take: 300 });
  res.json(rows.map(i => ({ ...i, accruedFineCents: i.returnedAt ? i.fineCents : fineFor(i.dueAt, now, set.finePerDayCents) })));
});
r.post('/issues', async (req, res) => {
  const d = parse(z.object({ bookId: z.string(), studentId: z.string().optional(), cardNo: z.string().optional(), days: z.number().int().min(1).max(120).optional() }).refine(v => v.studentId || v.cardNo, { message: 'studentId or cardNo required' }), req.body, res);
  if (!d) return;
  const tenantId = tid(req), set = await getSettings(tenantId);
  const s = await prisma.student.findFirst({ where: { tenantId, ...(d.studentId ? { id: d.studentId } : { cardNo: d.cardNo!.trim().toUpperCase() }) } });
  if (!s) return res.status(404).json({ error: 'Student not found' });
  if (s.status !== 'ACTIVE') return res.status(403).json({ error: 'Student is blocked' });
  const [open, unpaid] = await Promise.all([
    prisma.bookIssue.count({ where: { studentId: s.id, returnedAt: null } }),
    prisma.bookIssue.count({ where: { studentId: s.id, fineCents: { gt: 0 }, finePaid: false } }),
  ]);
  if (open >= set.maxBooksPerStudent) return res.status(409).json({ error: `Limit of ${set.maxBooksPerStudent} books reached` });
  if (unpaid) return res.status(409).json({ error: 'Student has unpaid fines' });
  const issue = await prisma.$transaction(async tx => {
    const taken = await tx.book.updateMany({ where: { id: d.bookId, tenantId, available: { gt: 0 } }, data: { available: { decrement: 1 } } });
    if (!taken.count) throw new HttpError(409, 'No copy available (or book not found)');
    return tx.bookIssue.create({ data: { tenantId, bookId: d.bookId, studentId: s.id, dueAt: new Date(Date.now() + (d.days ?? set.loanDays) * DAY) }, include: { book: { select: { title: true } } } });
  });
  await notify(tenantId, s.id, 'BOOK_ISSUED', 'Book issued', `"${issue.book.title}" is due on ${issue.dueAt.toISOString().slice(0, 10)}.`);
  res.status(201).json(issue);
});
r.post('/issues/:id/return', async (req, res) => {
  const set = await getSettings(tid(req));
  const out = await prisma.$transaction(async tx => {
    const i = await tx.bookIssue.findFirst({ where: { id: pid(req), tenantId: tid(req) } });
    if (!i) throw new HttpError(404, 'Issue not found');
    const done = await tx.bookIssue.updateMany({ where: { id: i.id, returnedAt: null }, data: { returnedAt: new Date(), fineCents: fineFor(i.dueAt, new Date(), set.finePerDayCents) } });
    if (!done.count) throw new HttpError(409, 'Already returned');
    await tx.book.update({ where: { id: i.bookId }, data: { available: { increment: 1 } } });
    return tx.bookIssue.findUnique({ where: { id: i.id } });
  });
  if (out && out.fineCents > 0) await notify(tid(req), out.studentId, 'FINE', 'Late-return fine', `A fine of ₹${out.fineCents / 100} applies. Please pay at the desk or online.`);
  res.json(out);
});
r.post('/issues/:id/pay-fine', async (req, res) => {
  const i = await prisma.bookIssue.findFirst({ where: { id: pid(req), tenantId: tid(req), finePaid: false, fineCents: { gt: 0 }, returnedAt: { not: null } } });
  if (!i) return res.status(404).json({ error: 'No unpaid fine on this issue' });
  await prisma.$transaction([
    prisma.bookIssue.update({ where: { id: i.id }, data: { finePaid: true } }),
    prisma.payment.create({ data: { tenantId: i.tenantId, studentId: i.studentId, issueId: i.id, kind: 'FINE', amountCents: i.fineCents, method: 'CASH', status: 'PAID', paidAt: new Date(), invoiceNo: await nextInvoiceNo(i.tenantId) } }),
  ]);
  res.json({ ok: true });
});
r.post('/issues/:id/waive-fine', async (req, res) => {
  const x = await prisma.bookIssue.updateMany({ where: { id: pid(req), tenantId: tid(req), finePaid: false }, data: { fineCents: 0 } });
  await audit(req, 'FINE_WAIVED', { id: pid(req) });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});

// ───────────── Announcements ─────────────
r.get('/announcements', async (req, res) => res.json(await prisma.announcement.findMany({ where: { tenantId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 50 })));
r.post('/announcements', async (req, res) => {
  const d = parse(z.object({ title: z.string().min(2).max(120), body: z.string().min(2).max(2000) }), req.body, res); if (!d) return;
  const a = await prisma.announcement.create({ data: { ...d, tenantId: tid(req) } });
  const ids = await prisma.student.findMany({ where: { tenantId: tid(req), status: 'ACTIVE' }, select: { id: true } });
  if (ids.length) await prisma.notification.createMany({ data: ids.map(s => ({ tenantId: tid(req), studentId: s.id, type: 'ANNOUNCEMENT', title: d.title, body: d.body })) });
  res.status(201).json({ ...a, notified: ids.length });
});
r.delete('/announcements/:id', async (req, res) => { const x = await prisma.announcement.deleteMany({ where: { id: pid(req), tenantId: tid(req) } }); res.status(x.count ? 200 : 404).json({ ok: !!x.count }); });

// ───────────── Payments ─────────────
r.get('/payments', async (req, res) => {
  const kind = req.query.kind ? String(req.query.kind) : undefined, status = req.query.status ? String(req.query.status) : undefined;
  res.json(await prisma.payment.findMany({ where: { tenantId: tid(req), ...(kind && { kind: kind as any }), ...(status && { status: status as any }) }, include: { student: { select: { name: true, cardNo: true } } }, orderBy: { createdAt: 'desc' }, take: 300 }));
});
r.post('/payments/:id/refund', async (req, res) => {
  const d = parse(z.object({ amountCents: z.number().int().positive().optional(), reason: z.string().max(200).default('Refund') }), req.body ?? {}, res); if (!d) return;
  const p = await prisma.payment.findFirst({ where: { id: pid(req), tenantId: tid(req), status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } });
  if (!p) return res.status(404).json({ error: 'Paid payment not found' });
  const left = p.amountCents - p.refundedCents, amt = d.amountCents ?? left;
  if (amt > left) return res.status(400).json({ error: `At most ₹${left / 100} can be refunded` });
  const total = p.refundedCents + amt;
  const u = await prisma.payment.update({ where: { id: p.id }, data: { refundedCents: total, status: total >= p.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundReason: d.reason } });
  await audit(req, 'PAYMENT_REFUNDED', { id: p.id, amt });
  if (p.studentId) await notify(tid(req), p.studentId, 'PAYMENT', 'Refund processed', `₹${amt / 100} refunded. ${d.reason}`);
  res.json(u);
});

// ───────────── Public website, enquiries, feedback ─────────────
r.get('/website', async (req, res) => {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tid(req) }, include: { libraryPage: true } });
  const slug = t.slug ?? (await prisma.tenant.update({ where: { id: t.id }, data: { slug: await uniqueSlug(t.name, t.id) } })).slug;
  res.json({ slug, published: t.libraryPage?.published ?? true, content: withDefaults(t.libraryPage?.content), name: t.name, phone: t.phone, address: t.address });
});
r.put('/website', async (req, res) => {
  const d = parse(z.object({ slug: z.string().optional(), published: z.boolean().optional(), content: siteContent.optional(), phone: z.string().max(30).nullable().optional(), address: z.string().max(200).nullable().optional() }), req.body, res);
  if (!d) return;
  const id = tid(req);
  if (d.slug !== undefined) {
    const slug = d.slug.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'Address must be 3–40 characters: lowercase letters, numbers and hyphens' });
    if (RESERVED.has(slug)) return res.status(400).json({ error: 'That address is reserved. Choose another.' });
    const clash = await prisma.tenant.findUnique({ where: { slug } });
    if (clash && clash.id !== id) return res.status(409).json({ error: 'That address is already taken' });
    await prisma.tenant.update({ where: { id }, data: { slug } });
  }
  if (d.phone !== undefined || d.address !== undefined) await prisma.tenant.update({ where: { id }, data: { ...(d.phone !== undefined && { phone: d.phone }), ...(d.address !== undefined && { address: d.address }) } });
  const cur = await prisma.libraryPage.findUnique({ where: { tenantId: id } });
  const content = { ...withDefaults(cur?.content), ...(d.content ?? {}) };
  await prisma.libraryPage.upsert({ where: { tenantId: id }, create: { tenantId: id, content, published: d.published ?? true }, update: { content, ...(d.published !== undefined && { published: d.published }) } });
  await audit(req, 'WEBSITE_UPDATED');
  res.json({ ok: true });
});
r.get('/enquiries', async (req, res) => res.json(await prisma.enquiry.findMany({ where: { tenantId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 200 })));
r.patch('/enquiries/:id', async (req, res) => {
  const d = parse(z.object({ status: z.enum(['NEW', 'CONTACTED', 'CLOSED']) }), req.body, res); if (!d) return;
  const x = await prisma.enquiry.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});
r.delete('/enquiries/:id', async (req, res) => { const x = await prisma.enquiry.deleteMany({ where: { id: pid(req), tenantId: tid(req) } }); res.status(x.count ? 200 : 404).json({ ok: !!x.count }); });
r.get('/feedback', async (req, res) => res.json(await prisma.feedback.findMany({ where: { tenantId: tid(req) }, orderBy: { createdAt: 'desc' }, take: 200 })));
r.patch('/feedback/:id', async (req, res) => {
  const d = parse(z.object({ approved: z.boolean() }), req.body, res); if (!d) return;
  const x = await prisma.feedback.updateMany({ where: { id: pid(req), tenantId: tid(req) }, data: d });
  res.status(x.count ? 200 : 404).json({ ok: !!x.count });
});
r.delete('/feedback/:id', async (req, res) => { const x = await prisma.feedback.deleteMany({ where: { id: pid(req), tenantId: tid(req) } }); res.status(x.count ? 200 : 404).json({ ok: !!x.count }); });

export default r;
