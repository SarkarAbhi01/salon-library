import { api } from './api';

const b64ToBytes = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushPermission = (): NotificationPermission | 'unsupported' => (pushSupported() ? Notification.permission : 'unsupported');

/** Asks the browser for permission (only when the person clicks), subscribes, and hands the subscription to `save`. */
export async function enablePush(publicKey: string, save: (sub: PushSubscriptionJSON) => Promise<unknown>) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in the browser settings to get updates.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await save(sub.toJSON());
}

export const publicPushKey = () => api.get('/public/push/key').then(r => r.data as { enabled: boolean; publicKey: string | null });
