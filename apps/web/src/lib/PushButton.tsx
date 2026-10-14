import { useEffect, useState } from 'react';
import { errMsg } from './ui';
import { enablePush, pushPermission, pushSupported, publicPushKey } from './push';

/**
 * "Notify me" button. `statusUrl` tells whether the server has push configured (and returns nothing secret);
 * `save` stores the browser subscription for whoever is signed in / whichever booking is being tracked.
 * Renders nothing when the server or browser cannot do push, so there is never a dead button.
 */
export function PushButton({ save, label = '🔔 Notify me about updates', statusUrl }: { save: (sub: any) => Promise<unknown>; label?: string; statusUrl?: string }) {
  const [key, setKey] = useState<string | null>(null), [state, setState] = useState<'idle' | 'busy' | 'on'>('idle'), [err, setErr] = useState('');
  useEffect(() => {
    if (!pushSupported()) return;
    publicPushKey().then(k => { if (k.enabled) setKey(k.publicKey); }).catch(() => {});
    if (pushPermission() === 'granted') navigator.serviceWorker.getRegistration('/sw.js').then(r => r?.pushManager.getSubscription()).then(s => s && setState('on')).catch(() => {});
  }, [statusUrl]);
  if (!key) return null;
  if (state === 'on') return <div className="okbox">🔔 Notifications are on for this browser.</div>;
  return <div>
    <button type="button" className="secondary" disabled={state === 'busy'} onClick={async () => {
      setState('busy'); setErr('');
      try { await enablePush(key, save); setState('on'); } catch (e: any) { setErr(e?.response ? errMsg(e) : e?.message || 'Could not turn on notifications'); setState('idle'); }
    }}>{state === 'busy' ? 'Turning on…' : label}</button>
    {err && <div className="error">{err}</div>}
  </div>;
}
