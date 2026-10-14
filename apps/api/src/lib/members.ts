import { prisma } from '../db';
import { HttpError, addMonths, nextInvoiceNo, getSettings, notify, computeRefund } from './util';

/** Creates a membership (+ paid payment record) atomically, enforcing batch capacity. */
export async function admit(a: { tenantId: string; studentId: string; planId?: string | null; batchId?: string | null; months: number; feeCents: number; startDate: Date; method: string; paymentId?: string; gatewayRef?: string }) {
  const student = await prisma.student.findFirst({ where: { id: a.studentId, tenantId: a.tenantId } });
  if (!student) throw new HttpError(404, 'Student not found');
  return prisma.$transaction(async tx => {
    if (a.batchId) {
      const b = await tx.batch.findFirst({ where: { id: a.batchId, tenantId: a.tenantId, active: true } });
      if (!b) throw new HttpError(404, 'Batch not found');
      const used = await tx.membership.count({ where: { batchId: b.id, status: 'ACTIVE', endDate: { gte: new Date() } } });
      if (used >= b.capacity) throw new HttpError(409, 'No seats available in this batch');
    }
    const m = await tx.membership.create({ data: {
      tenantId: a.tenantId, studentId: a.studentId, planId: a.planId ?? null, batchId: a.batchId ?? null, studentName: student.name, studentPhone: student.phone,
      months: a.months, feeCents: a.feeCents, startDate: a.startDate, endDate: addMonths(a.startDate, a.months),
    } });
    const invoiceNo = await nextInvoiceNo(a.tenantId);
    const data = { status: 'PAID' as const, paidAt: new Date(), invoiceNo, membershipId: m.id, method: a.method, gatewayRef: a.gatewayRef };
    const p = a.paymentId
      ? await tx.payment.update({ where: { id: a.paymentId }, data })
      : await tx.payment.create({ data: { tenantId: a.tenantId, studentId: a.studentId, kind: 'MEMBERSHIP', amountCents: a.feeCents, ...data } });
    await tx.notification.create({ data: { tenantId: a.tenantId, studentId: a.studentId, type: 'PAYMENT', title: 'Membership activated', body: `Payment of ₹${a.feeCents / 100} received (${invoiceNo}). Valid until ${m.endDate.toISOString().slice(0, 10)}.` } });
    return { membership: m, payment: p };
  }, { isolationLevel: 'Serializable' });
}

/** Cancels a membership and returns the refund per library rules (owner may override the amount). */
export async function cancelMembership(tenantId: string, membershipId: string, opts: { override?: number; reason?: string } = {}) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, tenantId }, include: { payments: { where: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } } });
  if (!m) throw new HttpError(404, 'Membership not found');
  if (m.status === 'CANCELLED') throw new HttpError(409, 'Already cancelled');
  const set = await getSettings(tenantId);
  const paid = m.payments.reduce((n, p) => n + p.amountCents - p.refundedCents, 0);
  let refund = opts.override ?? computeRefund(m, paid, set);
  refund = Math.max(0, Math.min(refund, paid));
  await prisma.$transaction(async tx => {
    await tx.membership.update({ where: { id: m.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), refundCents: refund } });
    // The seats this membership had reserved in the future are released.
    if (m.studentId) await tx.seatBooking.updateMany({ where: { studentId: m.studentId, status: 'BOOKED', startAt: { gt: new Date() } }, data: { status: 'CANCELLED' } });
    let left = refund;
    for (const p of m.payments) {
      const r = Math.min(left, p.amountCents - p.refundedCents);
      if (r <= 0) continue;
      left -= r;
      const total = p.refundedCents + r;
      await tx.payment.update({ where: { id: p.id }, data: { refundedCents: total, status: total >= p.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED', refundReason: opts.reason ?? 'Membership cancelled' } });
    }
  });
  if (m.studentId) await notify(tenantId, m.studentId, 'PAYMENT', 'Membership cancelled', refund ? `₹${refund / 100} will be refunded to you.` : 'No refund applies under the library refund rules.');
  return { refundCents: refund, paidCents: paid };
}
