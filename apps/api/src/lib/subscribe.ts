import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { parse } from './util';
import { pushEnabled } from './push';

export const subscriptionBody = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(100) }) });

/** Stores (or re-points) one browser push subscription. Returns false after sending the error response. */
export async function saveSubscription(req: Request, res: Response, owner: { tenantId: string; bookingId?: string; studentId?: string; userId?: string }, body: unknown = req.body?.subscription) {
  if (!pushEnabled) { res.status(503).json({ error: 'Push notifications are not configured on this server' }); return false; }
  const d = parse(subscriptionBody, body, res);
  if (!d) return false;
  const data = { tenantId: owner.tenantId, p256dh: d.keys.p256dh, auth: d.keys.auth, bookingId: owner.bookingId ?? null, studentId: owner.studentId ?? null, userId: owner.userId ?? null };
  await prisma.pushSubscription.upsert({ where: { endpoint: d.endpoint }, create: { endpoint: d.endpoint, ...data }, update: data });
  return true;
}
