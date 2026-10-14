import webpush from 'web-push';
import { prisma } from '../db';
import { vapid } from '../env';

export const pushEnabled = !!(vapid.publicKey && vapid.privateKey);
if (pushEnabled) webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

type Payload = { title: string; body: string; url?: string; tag?: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function deliver(subs: Sub[], payload: Payload) {
  if (!pushEnabled || !subs.length) return;
  const data = JSON.stringify(payload);
  await Promise.all(subs.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, { TTL: 3600 });
    } catch (e: any) {
      // 404/410 = the browser unsubscribed; forget it so we stop trying.
      if (e?.statusCode === 404 || e?.statusCode === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.error('[push]', e?.statusCode || e?.message);
    }
  }));
}

/** Salon customer following one booking. */
export async function pushToBooking(bookingId: string, payload: Payload) {
  if (!pushEnabled) return;
  await deliver(await prisma.pushSubscription.findMany({ where: { bookingId } }), payload).catch(() => {});
}

/** Salon owner(s) of one tenant (new booking requests). */
export async function pushToOwners(tenantId: string, payload: Payload) {
  if (!pushEnabled) return;
  await deliver(await prisma.pushSubscription.findMany({ where: { tenantId, userId: { not: null } } }), payload).catch(() => {});
}

/**
 * Library students: every row in the Notification table (booking confirmed, due soon, announcements …) is also sent as a
 * browser push if that student allowed it. Doing it from the table means no call site can forget to push.
 */
export async function pushPendingNotifications() {
  const rows = await prisma.notification.findMany({
    where: { pushedAt: null, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: 'asc' }, take: 200,
  });
  if (!rows.length) return;
  await prisma.notification.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { pushedAt: new Date() } });
  if (!pushEnabled) return;
  const subs = await prisma.pushSubscription.findMany({ where: { studentId: { in: [...new Set(rows.map(r => r.studentId))] } } });
  for (const n of rows) await deliver(subs.filter(s => (s as any).studentId === n.studentId), { title: n.title, body: n.body, url: '/student/notifications', tag: n.id });
}
