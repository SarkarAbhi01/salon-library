import { prisma } from '../db';
import { HttpError, DAY, MIN, getSettings, getOffset, fmtLocal } from './util';
import { newBookingCode } from './codes';

const ACTIVE = ['BOOKED', 'CHECKED_IN'] as ('BOOKED' | 'CHECKED_IN')[];

/** Rooms → seats with a computed state (AVAILABLE / RESERVED / OCCUPIED / MAINTENANCE) for the window [start, end). */
export async function seatMap(tenantId: string, start: Date, end: Date, forOwner = false) {
  const [rooms, bks] = await Promise.all([
    prisma.room.findMany({ where: { tenantId }, orderBy: [{ floor: 'asc' }, { name: 'asc' }], include: { seats: { orderBy: [{ row: 'asc' }, { col: 'asc' }, { label: 'asc' }] } } }),
    prisma.seatBooking.findMany({
      where: { tenantId, status: { in: ACTIVE }, startAt: { lt: end }, endAt: { gt: start } },
      include: forOwner ? { student: { select: { name: true, cardNo: true } } } : undefined,
    }),
  ]);
  const by = new Map<string, any[]>();
  for (const b of bks) by.set(b.seatId, [...(by.get(b.seatId) || []), b]);
  return rooms.map(r => ({
    ...r,
    seats: r.seats.map(s => {
      const list = by.get(s.id) || [];
      const state = s.status === 'MAINTENANCE' ? 'MAINTENANCE' : list.some(b => b.status === 'CHECKED_IN') ? 'OCCUPIED' : list.length ? 'RESERVED' : 'AVAILABLE';
      return { ...s, state, ...(forOwner ? { bookings: list } : {}) };
    }),
  }));
}

export async function createSeatBooking(a: { tenantId: string; studentId: string; seatId: string; startAt: Date; endAt: Date; byOwner?: boolean }) {
  const { tenantId, studentId, seatId, startAt, endAt, byOwner } = a;
  const [set, off] = await Promise.all([getSettings(tenantId), getOffset(tenantId)]);
  if (endAt <= startAt) throw new HttpError(400, 'End time must be after start time');
  if (endAt.getTime() - startAt.getTime() > set.maxBookingHours * 60 * MIN) throw new HttpError(400, `A booking can be at most ${set.maxBookingHours} hours`);
  if (!byOwner && startAt.getTime() < Date.now() - 5 * MIN) throw new HttpError(400, 'Cannot book a seat in the past');
  if (startAt.getTime() > Date.now() + 30 * DAY) throw new HttpError(400, 'Seats can be booked up to 30 days ahead');

  const student = await prisma.student.findFirst({ where: { id: studentId, tenantId } });
  if (!student) throw new HttpError(404, 'Student not found');
  if (student.status !== 'ACTIVE') throw new HttpError(403, 'Student account is blocked');
  const mem = await prisma.membership.findFirst({ where: { tenantId, studentId, status: 'ACTIVE', startDate: { lte: startAt }, endDate: { gte: endAt } } });
  if (!mem) throw new HttpError(402, 'An active membership covering this time is required');
  const seat = await prisma.seat.findFirst({ where: { id: seatId, tenantId }, include: { room: true } });
  if (!seat) throw new HttpError(404, 'Seat not found');
  if (seat.status !== 'AVAILABLE') throw new HttpError(409, 'Seat is under maintenance');

  const code = await newBookingCode('LIBRARY');
  return prisma.$transaction(async tx => {
    const clash = await tx.seatBooking.findFirst({ where: { seatId, status: { in: ACTIVE }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (clash) throw new HttpError(409, 'That seat is already taken for the selected time');
    const mine = await tx.seatBooking.findFirst({ where: { studentId, status: { in: ACTIVE }, startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (mine) throw new HttpError(409, 'The student already has a seat for an overlapping time');
    const b = await tx.seatBooking.create({ data: { code, tenantId, seatId, studentId, startAt, endAt }, include: { seat: { include: { room: true } } } });
    await tx.notification.create({ data: { tenantId, studentId, type: 'BOOKING_CONFIRMED', title: 'Seat booking confirmed', body: `${code} · Seat ${seat.label} (${seat.room.name}) · ${fmtLocal(startAt, off)} to ${fmtLocal(endAt, off).slice(11)}` } });
    return b;
  }, { isolationLevel: 'Serializable' });
}

export async function closeOpenSessions(studentId: string, at = new Date()) {
  const open = await prisma.studySession.findMany({ where: { studentId, endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
  for (const s of open) {
    let extra = 0;
    for (const b of s.breaks) { extra += Math.max(0, Math.round((at.getTime() - b.startedAt.getTime()) / 1000)); await prisma.studyBreak.update({ where: { id: b.id }, data: { endedAt: at } }); }
    await prisma.studySession.update({ where: { id: s.id }, data: { endedAt: at, breakSeconds: s.breakSeconds + extra } });
  }
}

export async function checkIn(bookingId: string, tenantId: string, force = false) {
  const b = await prisma.seatBooking.findFirst({ where: { id: bookingId, tenantId } });
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'BOOKED') throw new HttpError(409, `Booking is ${b.status.toLowerCase().replace('_', ' ')}`);
  const set = await getSettings(tenantId);
  const now = Date.now();
  if (!force && now < b.startAt.getTime() - 15 * MIN) throw new HttpError(409, 'Too early to check in (opens 15 minutes before start)');
  if (!force && now > b.startAt.getTime() + set.bookingGraceMin * MIN) throw new HttpError(409, 'Booking has expired');
  return prisma.seatBooking.update({ where: { id: b.id }, data: { status: 'CHECKED_IN', checkInAt: new Date() } });
}

export async function checkOut(bookingId: string, tenantId: string) {
  const b = await prisma.seatBooking.findFirst({ where: { id: bookingId, tenantId } });
  if (!b) throw new HttpError(404, 'Booking not found');
  if (b.status !== 'CHECKED_IN') throw new HttpError(409, 'Not checked in');
  const at = new Date();
  await closeOpenSessions(b.studentId, at);
  return prisma.seatBooking.update({ where: { id: b.id }, data: { status: 'COMPLETED', checkOutAt: at } });
}
