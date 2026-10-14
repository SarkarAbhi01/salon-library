import { prisma } from '../db';
import { HttpError, DAY, MIN, toUtc, dowOf, toMin, hhmm, localDay, fmtLocal } from './util';
import { newBookingCode } from './codes';
import { pushToOwners } from './push';

/** Free start times for a service on a local date, honouring hours, closures, chairs and existing bookings. */
export async function salonSlots(tenantId: string, date: string, durationMin: number) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!t) throw new HttpError(404, 'Salon not found');
  const off = t.utcOffsetMin;
  const h = await prisma.businessHours.findUnique({ where: { tenantId_dayOfWeek: { tenantId, dayOfWeek: dowOf(date) } } });
  if (!h || !h.open) return { open: false, slots: [] as { time: string; startAt: string }[] };
  const windows = ([[h.morningStart, h.morningEnd], [h.noonStart, h.noonEnd], [h.eveningStart, h.eveningEnd]] as [string | null, string | null][])
    .filter((w): w is [string, string] => !!w[0] && !!w[1] && toMin(w[1]) > toMin(w[0]));
  const dayStart = toUtc(date, '00:00', off), dayEnd = new Date(dayStart.getTime() + DAY);
  const [closures, bookings] = await Promise.all([
    prisma.closure.findMany({ where: { tenantId, from: { lt: dayEnd }, to: { gt: dayStart } } }),
    prisma.booking.findMany({ where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } } }),
  ]);
  const slots: { time: string; startAt: string }[] = [];
  const now = Date.now();
  for (const [ws, we] of windows) {
    for (let m = toMin(ws); m + durationMin <= toMin(we); m += 30) {
      const s = toUtc(date, hhmm(m), off), e = new Date(s.getTime() + durationMin * MIN);
      if (s.getTime() < now) continue;
      if (closures.some(c => c.from < e && c.to > s)) continue;
      if (bookings.filter(b => b.startAt < e && b.endAt > s).length >= t.chairs) continue;
      slots.push({ time: hhmm(m), startAt: s.toISOString() });
    }
  }
  return { open: true, slots };
}

export async function createSalonBooking(a: {
  tenantId: string; serviceId: string; customerName: string; customerPhone?: string; startAt: Date;
  offeredPriceCents?: number; source: 'OWNER' | 'PUBLIC'; force?: boolean; notes?: string;
}) {
  const { tenantId } = a;
  const [tenant, service] = await Promise.all([
    prisma.tenant.findFirst({ where: { id: tenantId, type: 'SALON', status: 'ACTIVE', enabled: true } }),
    prisma.service.findFirst({ where: { id: a.serviceId, tenantId, active: true } }),
  ]);
  if (!tenant) throw new HttpError(404, 'Salon not found');
  if (!service) throw new HttpError(404, 'Service not found');
  const endAt = new Date(a.startAt.getTime() + service.durationMin * MIN);

  let price = service.basePriceCents;
  if (a.offeredPriceCents != null && service.flexiblePriceMinCents != null) {
    if (a.offeredPriceCents < service.flexiblePriceMinCents) throw new HttpError(400, 'Offered price is below the salon minimum for this service');
    price = Math.min(a.offeredPriceCents, service.basePriceCents);
  }

  if (!a.force) {
    const date = localDay(a.startAt, tenant.utcOffsetMin);
    const { slots } = await salonSlots(tenantId, date, service.durationMin);
    if (!slots.some(s => s.startAt === a.startAt.toISOString())) throw new HttpError(409, 'That slot is not available. Please pick another time.');
  }
  const code = await newBookingCode('SALON');
  const booking = await prisma.$transaction(async tx => {
    const overlapping = await tx.booking.count({ where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { lt: endAt }, endAt: { gt: a.startAt } } });
    if (overlapping >= tenant.chairs) throw new HttpError(409, 'That slot was just taken. Please pick another time.');
    return tx.booking.create({
      data: { code, tenantId, serviceId: service.id, customerName: a.customerName, customerPhone: a.customerPhone, startAt: a.startAt, endAt, agreedPriceCents: price, source: a.source, notes: a.notes, status: a.source === 'OWNER' ? 'CONFIRMED' : 'PENDING' },
      include: { service: true },
    });
  }, { isolationLevel: 'Serializable' });
  // A customer request from the public page → tell the salon owner's phone/browser right away (if they allowed it).
  if (a.source === 'PUBLIC') void pushToOwners(tenantId, { title: 'New booking request', body: `${a.customerName} · ${service.name} · ${fmtLocal(a.startAt, tenant.utcOffsetMin)} (${code})`, url: '/bookings', tag: code });
  return booking;
}
