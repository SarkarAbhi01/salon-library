import { prisma } from '../db';
import { DAY, MIN, fmtLocal } from './util';
import { closeOpenSessions } from './seats';
import { pushPendingNotifications } from './push';

/** Housekeeping: expiry, reminders, fines. Runs every minute and is cheap (indexed, tenant-scoped when called lazily). */
export async function sweep(tenantId?: string) {
  const now = new Date();
  const scope = tenantId ? { tenantId } : {};

  // 1. Seat bookings never checked in → expired (seat is freed automatically because only BOOKED/CHECKED_IN block a seat)
  const candidates = await prisma.seatBooking.findMany({ where: { ...scope, status: 'BOOKED', startAt: { lt: now } }, include: { seat: true, tenant: { select: { librarySetting: true, utcOffsetMin: true } } } });
  for (const b of candidates) {
    const grace = b.tenant.librarySetting?.bookingGraceMin ?? 15;
    if (b.startAt.getTime() + grace * MIN > now.getTime()) continue;
    const r = await prisma.seatBooking.updateMany({ where: { id: b.id, status: 'BOOKED' }, data: { status: 'EXPIRED' } });
    if (r.count) await prisma.notification.create({ data: { tenantId: b.tenantId, studentId: b.studentId, type: 'BOOKING_EXPIRED', title: 'Booking expired', body: `Seat ${b.seat.label} booking for ${fmtLocal(b.startAt, b.tenant.utcOffsetMin)} expired because you did not check in.` } });
  }

  // 2. Checked-in sessions past their end time: notify, then auto check-out 15 minutes later
  const running = await prisma.seatBooking.findMany({ where: { ...scope, status: 'CHECKED_IN', endAt: { lt: now } }, include: { seat: true } });
  for (const b of running) {
    if (!b.expiryNotified) {
      await prisma.seatBooking.update({ where: { id: b.id }, data: { expiryNotified: true } });
      await prisma.notification.create({ data: { tenantId: b.tenantId, studentId: b.studentId, type: 'SESSION_EXPIRY', title: 'Your seat time is over', body: `Your slot at seat ${b.seat.label} has ended. You will be checked out automatically in 15 minutes.` } });
    }
    if (b.endAt.getTime() + 15 * MIN < now.getTime()) {
      await closeOpenSessions(b.studentId, b.endAt);
      await prisma.seatBooking.update({ where: { id: b.id }, data: { status: 'COMPLETED', checkOutAt: b.endAt } });
    }
  }

  // 3. Upcoming booking reminders (next 30 minutes)
  const soon = await prisma.seatBooking.findMany({ where: { ...scope, status: 'BOOKED', reminderSent: false, startAt: { gte: now, lte: new Date(now.getTime() + 30 * MIN) } }, include: { seat: true } });
  for (const b of soon) {
    await prisma.seatBooking.update({ where: { id: b.id }, data: { reminderSent: true } });
    await prisma.notification.create({ data: { tenantId: b.tenantId, studentId: b.studentId, type: 'BOOKING_UPCOMING', title: 'Booking starts soon', body: `Seat ${b.seat.label} is reserved for you in ${Math.max(1, Math.round((b.startAt.getTime() - now.getTime()) / MIN))} minutes. Check in when you arrive.` } });
  }

  // 4. Memberships past end date → expired
  const expired = await prisma.membership.findMany({ where: { ...scope, status: 'ACTIVE', endDate: { lt: now } } });
  for (const m of expired) {
    await prisma.membership.update({ where: { id: m.id }, data: { status: 'EXPIRED' } });
    if (m.studentId) await prisma.notification.create({ data: { tenantId: m.tenantId, studentId: m.studentId, type: 'MEMBERSHIP_EXPIRED', title: 'Membership expired', body: 'Your membership has ended. Renew to keep booking seats.' } });
  }

  // 5. Book due reminders and overdue/fine alerts
  const open = await prisma.bookIssue.findMany({ where: { ...scope, returnedAt: null }, include: { book: true, tenant: { select: { librarySetting: true } } } });
  for (const i of open) {
    const perDay = i.tenant.librarySetting?.finePerDayCents ?? 1000;
    if (i.dueAt < now && !i.overdueNotified) {
      await prisma.bookIssue.update({ where: { id: i.id }, data: { overdueNotified: true } });
      await prisma.notification.create({ data: { tenantId: i.tenantId, studentId: i.studentId, type: 'BOOK_OVERDUE', title: 'Book overdue', body: `"${i.book.title}" is overdue. A fine of ₹${perDay / 100}/day applies until it is returned.` } });
    } else if (i.dueAt >= now && i.dueAt.getTime() - now.getTime() <= DAY && !i.dueReminderSent) {
      await prisma.bookIssue.update({ where: { id: i.id }, data: { dueReminderSent: true } });
      await prisma.notification.create({ data: { tenantId: i.tenantId, studentId: i.studentId, type: 'BOOK_DUE_SOON', title: 'Book due soon', body: `"${i.book.title}" is due within 24 hours. Return it on time to avoid fines.` } });
    }
  }
}

export function startJobs() {
  const run = () => sweep().catch(e => console.error('[sweep]', e));
  run();
  setInterval(run, 60 * 1000).unref();
  // Browser push for new student notifications goes out within seconds, not on the next minute sweep.
  const pushRun = () => pushPendingNotifications().catch(e => console.error('[push]', e));
  setInterval(pushRun, 5 * 1000).unref();
}
