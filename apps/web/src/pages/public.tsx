import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PushButton } from '../lib/PushButton';
import { api, Loading, Field, Msg, useAction, useLoad, inr, todayStr, rupeesToCents, dt, errMsg } from '../lib/ui';

export function SalonList() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/public/salons').then(r => r.data));
  const nav = useNavigate();
  return <main className="auth"><div className="card wide"><h1>Book a salon appointment</h1>
    {!data ? <Loading error={error} retry={reload} /> : data.map(s => <div className="row" key={s.id}><span><b>{s.name}</b><br /><small className="muted">{s.address}</small></span><button onClick={() => nav(`/book/${s.id}`)}>Book</button></div>)}
    </div></main>;
}

export function SalonBook() {
  const { id } = useParams();
  const salon = useLoad<any>(() => api.get(`/public/salons/${id}`).then(r => r.data), [id]);
  const [serviceId, setService] = useState(''), [date, setDate] = useState(todayStr()), [slot, setSlot] = useState('');
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [offer, setOffer] = useState('');
  const [done, setDone] = useState<any>();
  const slots = useLoad<any>(() => serviceId ? api.get(`/public/salons/${id}/availability`, { params: { date, serviceId } }).then(r => r.data) : Promise.resolve(null), [serviceId, date]);
  const a = useAction();
  if (!salon.data) return <main className="auth"><div className="card"><Loading error={salon.error} /></div></main>;
  const s = salon.data, svc = s.services.find((x: any) => x.id === serviceId);
  if (done) return <BookingStatusCard id={done.id} phone={phone} />;
  return <main className="auth"><form className="card wide" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => api.post(`/public/salons/${id}/bookings`, { serviceId, customerName: name, customerPhone: phone, startAt: slot, offeredPriceCents: offer ? rupeesToCents(offer) : undefined }), 'Sent'); if (r) { localStorage.setItem('lastTrackPhone', phone); setDone(r.data); } }}>
    <h1>{s.name}</h1><p className="muted">{s.address} {s.phone}</p>
    {s.closedNow && <div className="error">Closed right now{s.closedNow.message ? ': ' + s.closedNow.message : ''}</div>}
    <Field label="Service"><select value={serviceId} onChange={e => { setService(e.target.value); setSlot(''); }} required><option value="">Select…</option>{s.services.map((x: any) => <option key={x.id} value={x.id}>{x.name} · {x.durationMin} min · {inr(x.basePriceCents)}</option>)}</select></Field>
    <Field label="Date"><input type="date" min={todayStr()} value={date} onChange={e => { setDate(e.target.value); setSlot(''); }} /></Field>
    {serviceId && (slots.loading ? <p>Loading times…</p> : !slots.data?.open ? <p className="muted">Closed on this day.</p> : !slots.data.slots.length ? <p className="muted">No free times on this date.</p> : <div className="slotgrid">{slots.data.slots.map((t: any) => <button type="button" key={t.startAt} className={slot === t.startAt ? '' : 'secondary'} onClick={() => setSlot(t.startAt)}>{t.time}</button>)}</div>)}
    <Field label="Your name"><input value={name} onChange={e => setName(e.target.value)} required minLength={2} /></Field>
    <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} required minLength={8} /></Field>
    {svc?.flexible && <Field label="Offer a price ₹ (optional — the salon may accept lower than the listed price)"><input type="number" min={1} value={offer} onChange={e => setOffer(e.target.value)} /></Field>}
    <Msg m={a.msg} /><button disabled={!slot || a.busy}>Request booking</button></form></main>;
}

/** Polls the booking so the customer sees the salon's decision (confirmed / cancelled) without refreshing. */
export function BookingStatusCard({ id, phone }: { id: string; phone: string }) {
  const { data, error } = useLoad<any>(() => api.get(`/public/bookings/${id}`, { params: { phone } }).then(r => r.data), [id, phone], 10000);
  const link = `${window.location.origin}/track?code=${encodeURIComponent(data?.code || '')}&phone=${encodeURIComponent(phone)}`;
  if (!data) return <main className="auth"><div className="card"><Loading error={error} /></div></main>;
  const st = data.status as string;
  const head = st === 'CONFIRMED' ? ['✅ Booking confirmed!', 'The salon has accepted your appointment. See you there!'] : st === 'CANCELLED' ? ['❌ Booking cancelled', 'The salon could not take this appointment. Please book another time.'] : st === 'COMPLETED' ? ['✔ Appointment completed', 'Thank you for visiting!'] : ['⏳ Request sent', 'Waiting for the salon to confirm. This page updates automatically.'];
  return <main className="auth"><div className="card"><h2>{head[0]}</h2><p>{head[1]}</p>
    {data.code && <div><span className="muted">Booking ID</span><br /><span className="trackcode">{data.code}</span></div>}
    <div className={st === 'CONFIRMED' ? 'okbox' : st === 'CANCELLED' ? 'error' : 'panel'}><b>{data.salon}</b><br />{data.service} · {dt(data.startAt)} · {inr(data.priceCents)}{data.salonPhone && <><br />Call: {data.salonPhone}</>}</div>
    <small className="muted">Bookmark to check later: <a href={link}>{link}</a></small>
    {st !== 'CANCELLED' && st !== 'COMPLETED' && <PushButton save={sub => api.post('/public/push/subscribe', { code: data.code, phone, subscription: sub })} />}
    {data.salonSlug && <Link to={`/${data.salonSlug}`}>Back to {data.salon}</Link>}</div></main>;
}

export function BookingStatusPage() {
  const { id } = useParams(); const [sp] = useSearchParams();
  const phone = sp.get('phone') || '';
  if (!phone) return <main className="auth"><div className="card"><p>{errMsg({ message: 'This link is missing the phone number.' })}</p><Link to="/book">Book a salon</Link></div></main>;
  return <BookingStatusCard id={id!} phone={phone} />;
}
