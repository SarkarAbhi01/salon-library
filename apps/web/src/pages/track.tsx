import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errMsg, dt, inr, Loading } from '../lib/ui';
import { PushButton } from '../lib/PushButton';

const SALON_STEPS = ['PENDING', 'CONFIRMED', 'COMPLETED'];
const LIB_STEPS = ['BOOKED', 'CHECKED_IN', 'COMPLETED'];
const WORDS: Record<string, string> = { PENDING: 'Request sent', CONFIRMED: 'Confirmed by salon', COMPLETED: 'Completed', CANCELLED: 'Cancelled', BOOKED: 'Seat booked', CHECKED_IN: 'Checked in', EXPIRED: 'Expired (not checked in)' };

/** Shows one booking and refreshes itself; offers browser notifications for salon bookings if the server has push set up. */
export function TrackResult({ code, phone, onBack }: { code: string; phone: string; onBack?: () => void }) {
  const [d, setD] = useState<any>(), [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api.get('/public/track', { params: { code, phone } }).then(r => { if (live) { setD(r.data); setErr(''); } }).catch(e => { if (live) setErr(errMsg(e)); });
    load(); const t = setInterval(load, 10000);
    return () => { live = false; clearInterval(t); };
  }, [code, phone]);
  if (!d) return <div className="card"><Loading error={err} />{onBack && <button className="secondary" onClick={onBack}>Try again</button>}</div>;
  const salon = d.kind === 'SALON', steps = salon ? SALON_STEPS : LIB_STEPS, st: string = d.status, bad = st === 'CANCELLED' || st === 'EXPIRED';
  const at = steps.indexOf(st);
  return <div className="card wide">
    <h2>{salon ? d.salon : d.library}</h2>
    <div><span className="muted">Booking ID</span><br /><span className="trackcode">{d.code}</span></div>
    <div className={bad ? 'error' : st === 'CONFIRMED' || st === 'CHECKED_IN' ? 'okbox' : 'panel'}>
      <b>{WORDS[st] || st}</b><br />
      {salon ? <>{d.service} · {dt(d.startAt)} · {inr(d.priceCents)}</> : <>{d.seat} · {dt(d.startAt)}</>}
      {(d.salonPhone || d.libraryPhone) && <><br />Call: {d.salonPhone || d.libraryPhone}</>}
    </div>
    {!bad && <div className="timeline">{steps.map((s, i) => <div key={s} className={i <= at ? 'done' : ''}>{WORDS[s]}</div>)}</div>}
    {salon && !bad && st !== 'COMPLETED' && <PushButton save={sub => api.post('/public/push/subscribe', { code: d.code, phone, subscription: sub })} />}
    <small className="muted">This page updates by itself. Keep your Booking ID to check again anytime at <b>{window.location.origin}/track</b>.</small>
    {salon && d.salonSlug && <Link to={`/${d.salonSlug}`}>Back to {d.salon}</Link>}
    {onBack && <button className="secondary" onClick={onBack}>Track another booking</button>}
  </div>;
}

/** /track — one place for salon (SB-…) and library seat (LB-…) bookings. Works from a link: /track?code=SB-XXXXXX&phone=… */
export default function TrackPage() {
  const [sp] = useSearchParams();
  const [code, setCode] = useState(sp.get('code') || ''), [phone, setPhone] = useState(sp.get('phone') || localStorage.getItem('lastTrackPhone') || '');
  const [go, setGo] = useState(!!(sp.get('code') && (sp.get('phone') || localStorage.getItem('lastTrackPhone'))));
  if (go) return <main className="auth"><TrackResult code={code} phone={phone} onBack={() => setGo(false)} /></main>;
  return <main className="auth"><form className="card" onSubmit={e => { e.preventDefault(); localStorage.setItem('lastTrackPhone', phone); setGo(true); }}>
    <h1>Track your booking</h1><p className="muted">Enter the Booking ID you received (for example SB-7K3M9Q for a salon or LB-4H8N2P for a library seat).</p>
    <label>Booking ID<input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SB-XXXXXX" required /></label>
    <label>Mobile number (or library card number)<input value={phone} onChange={e => setPhone(e.target.value)} required /></label>
    <button>Track</button>
  </form></main>;
}
