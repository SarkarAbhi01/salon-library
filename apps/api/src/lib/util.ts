import type { Request, Response } from 'express';
import type { z } from 'zod';
import { prisma } from '../db';

export const DAY = 86400000;
export const MIN = 60000;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Validate a body/query with zod; sends 400 and returns null on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown, res: Response): z.output<S> | null {
  const r = schema.safeParse(data);
  if (!r.success) {
    res.status(400).json({ error: r.error.issues.map(i => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    return null;
  }
  return r.data;
}

export const tid = (req: Request) => req.user!.tenantId!;
export const pid = (req: Request) => String(req.params.id);

export function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** Format a UTC date in tenant-local time: "2026-10-07 14:30". */
export function fmtLocal(d: Date, offsetMin: number) {
  const x = new Date(d.getTime() + offsetMin * MIN);
  return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())} ${p2(x.getUTCHours())}:${p2(x.getUTCMinutes())}`;
}
export const localDay = (d: Date, offsetMin: number) => new Date(d.getTime() + offsetMin * MIN).toISOString().slice(0, 10);
export const toUtc = (date: string, time: string, offsetMin: number) =>
  new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5)) - offsetMin * MIN);
export const dowOf = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
export const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const hhmm = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getSettings(tenantId: string) {
  return prisma.librarySetting.upsert({ where: { tenantId }, create: { tenantId }, update: {} });
}

export async function getOffset(tenantId: string) {
  return (await prisma.tenant.findUnique({ where: { id: tenantId }, select: { utcOffsetMin: true } }))?.utcOffsetMin ?? 330;
}

export async function notify(tenantId: string, studentId: string, type: string, title: string, body: string) {
  await prisma.notification.create({ data: { tenantId, studentId, type, title, body } });
}

export async function audit(req: Request, action: string, metadata?: any) {
  await prisma.auditLog.create({ data: { action, actorId: req.user?.id, tenantId: req.user?.tenantId, metadata } }).catch(() => {});
}

export async function nextInvoiceNo(tenantId: string) {
  const n = await prisma.payment.count({ where: { tenantId, invoiceNo: { not: null } } });
  return `INV-${new Date().getUTCFullYear()}-${String(n + 1).padStart(5, '0')}`;
}

export function fineFor(dueAt: Date, end: Date, perDayCents: number) {
  return end > dueAt ? Math.ceil((end.getTime() - dueAt.getTime()) / DAY) * perDayCents : 0;
}

/** Refund rules: full refund inside the window, otherwise a % of the unused time. */
export function computeRefund(m: { feeCents: number; startDate: Date; endDate: Date; createdAt: Date }, paidCents: number,
  s: { refundFullHours: number; refundProratePct: number }, now = new Date()) {
  if (paidCents <= 0) return 0;
  if (now.getTime() - m.createdAt.getTime() <= s.refundFullHours * 3600000) return paidCents; // cooling-off window
  const total = m.endDate.getTime() - m.startDate.getTime();
  const unused = Math.max(0, m.endDate.getTime() - Math.max(now.getTime(), m.startDate.getTime()));
  if (total <= 0) return 0;
  return Math.floor(paidCents * (unused / total) * (s.refundProratePct / 100));
}
