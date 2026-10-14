import { useState } from 'react';
import { PushButton } from '../lib/PushButton';
import { api, Page, Loading, Field, Msg, useAction, useLoad, Badge, Empty, dt, tOnly, inr, DAYS, todayStr, rupeesToCents, toLocalInput } from '../lib/ui';

export function Services() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/salon/services').then(r => r.data));
  const [f, setF] = useState({ name: '', durationMin: 30, base: 300, flex: '' });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Page title="Services & flexible rates">
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/salon/services', { name: f.name, durationMin: Number(f.durationMin), basePriceCents: rupeesToCents(f.base), flexiblePriceMinCents: f.flex === '' ? null : rupeesToCents(f.flex) }), 'Service added')) { setF({ ...f, name: '' }); reload(); } }}>
      <div className="formgrid"><Field label="Service name"><input value={f.name} onChange={set('name')} required minLength={2} /></Field>
        <Field label="Duration (minutes)"><input type="number" min={5} value={f.durationMin} onChange={set('durationMin')} /></Field>
        <Field label="Base price (₹)"><input type="number" min={0} value={f.base} onChange={set('base')} /></Field>
        <Field label="Flexible minimum (₹, optional)"><input type="number" min={0} value={f.flex} onChange={set('flex')} /></Field></div>
      <Msg m={a.msg} /><button>Add service</button></form>
    {!data ? <Loading error={error} retry={reload} /> : <div className="panel tablewrap"><table><thead><tr><th>Service</th><th>Minutes</th><th>Base</th><th>Flexible minimum</th><th>Status</th><th></th></tr></thead>
      <tbody>{data.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.durationMin}</td><td>{inr(s.basePriceCents)}</td><td>{inr(s.flexiblePriceMinCents)}</td><td><Badge v={s.active ? 'ACTIVE' : 'INACTIVE'} /></td>
        <td><button className="secondary" onClick={async () => { await a.run(() => api.patch(`/salon/services/${s.id}`, { active: !s.active }), 'Updated'); reload(); }}>{s.active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div>}
  </Page>;
}

const blank = (i: number) => ({ dayOfWeek: i, open: i !== 0, morningStart: '09:00', morningEnd: '13:00', noonStart: null, noonEnd: null, eveningStart: '16:00', eveningEnd: '20:00' });
export function Hours() {
  const [rows, setRows] = useState<any[]>(Array.from({ length: 7 }, (_, i) => blank(i)));
  const [loaded, setLoaded] = useState(false);
  const load = useLoad(async () => { const r = (await api.get('/salon/hours')).data; if (r.length) setRows(Array.from({ length: 7 }, (_, i) => r.find((x: any) => x.dayOfWeek === i) || blank(i))); setLoaded(true); return r; });
  const closures = useLoad<any[]>(() => api.get('/salon/closures').then(r => r.data));
  const [c, setC] = useState({ from: toLocalInput(new Date()), to: toLocalInput(new Date(Date.now() + 86400000)), message: '', cancelBookings: false });
  const a = useAction(), b = useAction();
  const upd = (i: number, k: string, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v === '' ? null : v } : r)));
  const win = (i: number, p: 'morning' | 'noon' | 'evening') => <><input type="time" value={rows[i][p + 'Start'] || ''} onChange={e => upd(i, p + 'Start', e.target.value)} /> – <input type="time" value={rows[i][p + 'End'] || ''} onChange={e => upd(i, p + 'End', e.target.value)} /></>;
  if (!loaded && load.loading) return <Loading error={load.error} />;
  return <Page title="Opening hours & closures">
    <div className="panel tablewrap"><table><thead><tr><th>Day</th><th>Open</th><th>Morning</th><th>Noon</th><th>Evening</th></tr></thead>
      <tbody>{rows.map((x, i) => <tr key={i}><td>{DAYS[i]}</td><td><input type="checkbox" checked={x.open} onChange={e => upd(i, 'open', e.target.checked)} /></td><td>{win(i, 'morning')}</td><td>{win(i, 'noon')}</td><td>{win(i, 'evening')}</td></tr>)}</tbody></table>
      <p className="muted">Leave a window empty to skip it. Customers can only book inside open windows.</p><Msg m={a.msg} />
      <button onClick={() => a.run(() => api.put('/salon/hours', rows.map(({ dayOfWeek, open, morningStart, morningEnd, noonStart, noonEnd, eveningStart, eveningEnd }) => ({ dayOfWeek, open, morningStart, morningEnd, noonStart, noonEnd, eveningStart, eveningEnd }))), 'Weekly hours saved')}>Save weekly hours</button></div>
    <div className="panel"><h2>Emergency closure</h2>
      <div className="formgrid"><Field label="From"><input type="datetime-local" value={c.from} onChange={e => setC({ ...c, from: e.target.value })} /></Field><Field label="To"><input type="datetime-local" value={c.to} onChange={e => setC({ ...c, to: e.target.value })} /></Field>
        <Field label="Message for customers"><input value={c.message} onChange={e => setC({ ...c, message: e.target.value })} /></Field>
        <label className="switch"><input type="checkbox" checked={c.cancelBookings} onChange={e => setC({ ...c, cancelBookings: e.target.checked })} /> Cancel existing bookings in this period</label></div>
      <Msg m={b.msg} />
      <button onClick={async () => { const r = await b.run(() => api.post('/salon/emergency-close', { from: new Date(c.from).toISOString(), to: new Date(c.to).toISOString(), message: c.message || undefined, cancelBookings: c.cancelBookings }), 'Closure saved'); if (r) { alert(`${r.data.affectedBookings} booking(s) ${r.data.cancelled ? 'cancelled' : 'overlap this closure — review them in Bookings'}.`); closures.reload(); } }}>Close salon for this period</button>
      {closures.data?.map(x => <div className="row" key={x.id}><span>{dt(x.from)} → {dt(x.to)} {x.message && `· ${x.message}`}</span><button className="secondary" onClick={async () => { await api.delete(`/salon/closures/${x.id}`); closures.reload(); }}>Remove</button></div>)}</div>
  </Page>;
}

/** The salon owner's booking inbox: new customer requests land here (auto-refreshes every 20 s). */
export function Bookings() {
  const [date, setDate] = useState(todayStr());
  const [view, setView] = useState<'day' | 'pending' | 'upcoming' | 'all'>('day');
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad<any[]>(() => {
    const params: any = view === 'day' ? { from: date, to: date } : view === 'pending' ? { status: 'PENDING' } : view === 'upcoming' ? { from: todayStr() } : {};
    if (q) params.q = q;
    return api.get('/salon/bookings', { params }).then(r => r.data);
  }, [date, view, q], 20000);
  const services = useLoad<any[]>(() => api.get('/salon/services').then(r => r.data));
  const [f, setF] = useState<any>({ serviceId: '', customerName: '', customerPhone: '', startAt: toLocalInput(new Date()), price: '' });
  const a = useAction(), b = useAction();
  const [flash, setFlash] = useState('');
  const wa = (x: any) => { const d = String(x.customerPhone || '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? '91' + d : d}?text=${encodeURIComponent(`Hi ${x.customerName}, your ${x.service.name} appointment on ${dt(x.startAt)} is confirmed. See you soon!`)}` : ''; };
  const setStatus = async (x: any, status: string) => {
    const word = { CONFIRMED: 'confirmed', COMPLETED: 'marked as completed', CANCELLED: 'cancelled' }[status];
    const r = await b.run(() => api.patch(`/salon/bookings/${x.id}`, { status }), `✔ Booking for ${x.customerName} (${dt(x.startAt)}) ${word}.${status === 'CONFIRMED' ? ' The customer sees "Confirmed" on their booking page.' : ''}`);
    if (r) { setFlash(x.id); setTimeout(() => setFlash(''), 4000); reload(); }
  };
  const pending = data?.filter(x => x.status === 'PENDING').length ?? 0;
  return <Page title="Bookings">
    <div className="tabs">{(['day', 'pending', 'upcoming', 'all'] as const).map(v => <button key={v} className={view === v ? '' : 'secondary'} onClick={() => setView(v)}>{v === 'day' ? 'By date' : v[0].toUpperCase() + v.slice(1)}{v === 'pending' && pending ? ` (${pending})` : ''}</button>)}
      {view === 'day' && <input type="date" value={date} onChange={e => setDate(e.target.value)} />}<input placeholder="Search name / phone / booking ID" value={q} onChange={e => setQ(e.target.value)} /></div>
    <Msg m={b.msg} />
    <PushButton label="🔔 Alert this device when a new booking request arrives" save={sub => api.post('/salon/push/subscribe', { subscription: sub })} />
    {!data ? <Loading error={error} retry={reload} /> : <div className="panel tablewrap">{data.length ? <table><thead><tr><th>Booking ID</th><th>When</th><th>Customer</th><th>Service</th><th>Price</th><th>Source</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{data.map(x => <tr key={x.id} className={flash === x.id ? 'flash' : ''}><td>{x.code ? <span className="codechip">{x.code}</span> : '—'}</td><td>{dt(x.startAt)} – {tOnly(x.endAt)}</td><td>{x.customerName}<br /><small className="muted">{x.customerPhone}</small></td><td>{x.service.name}{x.notes && <><br /><small className="muted">{x.notes}</small></>}</td><td>{inr(x.agreedPriceCents)}</td><td>{x.source === 'PUBLIC' ? 'Online' : 'Walk-in'}</td><td><Badge v={x.status} /></td>
        <td className="btnrow">{x.status === 'CONFIRMED' && wa(x) && <a href={wa(x)} target="_blank" rel="noreferrer"><button className="secondary">WhatsApp</button></a>}{x.status === 'PENDING' && <button onClick={() => setStatus(x, 'CONFIRMED')}>Confirm</button>}{x.status === 'CONFIRMED' && <button onClick={() => setStatus(x, 'COMPLETED')}>Complete</button>}{['PENDING', 'CONFIRMED'].includes(x.status) && <button className="secondary" onClick={() => confirm('Cancel this booking?') && setStatus(x, 'CANCELLED')}>Cancel</button>}</td></tr>)}</tbody></table> : <Empty text="No bookings found." />}</div>}
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/salon/bookings', { serviceId: f.serviceId, customerName: f.customerName, customerPhone: f.customerPhone || undefined, startAt: new Date(f.startAt).toISOString(), priceCents: f.price === '' ? undefined : rupeesToCents(f.price), force: true }), 'Booking added')) { setF({ ...f, customerName: '', customerPhone: '', price: '' }); reload(); } }}>
      <h2>Add walk-in / phone booking</h2>
      <div className="formgrid"><Field label="Service"><select value={f.serviceId} onChange={e => setF({ ...f, serviceId: e.target.value })} required><option value="">Select…</option>{services.data?.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>)}</select></Field>
        <Field label="Date & time"><input type="datetime-local" value={f.startAt} onChange={e => setF({ ...f, startAt: e.target.value })} required /></Field>
        <Field label="Customer name"><input value={f.customerName} onChange={e => setF({ ...f, customerName: e.target.value })} required minLength={2} /></Field>
        <Field label="Phone"><input value={f.customerPhone} onChange={e => setF({ ...f, customerPhone: e.target.value })} /></Field>
        <Field label="Agreed price ₹ (optional)"><input type="number" min={0} value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field></div>
      <Msg m={a.msg} /><button>Add booking</button></form>
  </Page>;
}
