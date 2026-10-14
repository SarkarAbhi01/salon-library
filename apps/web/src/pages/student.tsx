import { useEffect, useState } from 'react';
import { PushButton } from '../lib/PushButton';
import { api, Page, Loading, Field, Msg, useAction, useLoad, Badge, Empty, Stat, Progress, dt, dOnly, tOnly, inr, hm, pad, toLocalInput, printInvoice, printHtml } from '../lib/ui';
import { SeatGrid } from './library';

export function StudentHome() {
  const stats = useLoad<any>(() => api.get('/student/stats').then(r => r.data), [], 30000);
  const news = useLoad<any[]>(() => api.get('/student/announcements').then(r => r.data));
  const bks = useLoad<any[]>(() => api.get('/student/bookings').then(r => r.data), [], 30000);
  const next = bks.data?.find(b => ['BOOKED', 'CHECKED_IN'].includes(b.status) && new Date(b.endAt) > new Date());
  if (!stats.data) return <Loading error={stats.error} retry={stats.reload} />;
  const s = stats.data;
  return <Page title="My study dashboard">
    <div className="grid"><Stat k="Today" v={hm(s.todayMin)} hint={`goal ${hm(s.dailyGoalMin)}`} /><Stat k="This week" v={hm(s.weekMin)} hint={`goal ${hm(s.weeklyGoalMin)}`} />
      <Stat k="Next seat" v={next ? `${next.seat.label}` : '—'} hint={next ? `${dt(next.startAt)} · ${next.status.replace('_', ' ').toLowerCase()}` : 'No upcoming booking'} /></div>
    <div className="panel"><h2>Daily goal</h2><Progress value={s.todayMin} max={s.dailyGoalMin} /><h2>Weekly goal</h2><Progress value={s.weekMin} max={s.weeklyGoalMin} /></div>
    <div className="panel"><h2>Last 7 days</h2>{s.last7.map((d: any) => <div className="barrow" key={d.date}><span>{d.date.slice(5)}</span><Progress value={d.minutes} max={Math.max(s.dailyGoalMin, ...s.last7.map((x: any) => x.minutes))} /><b>{hm(d.minutes)}</b></div>)}</div>
    <div className="panel"><h2>Announcements</h2>{news.data?.length ? news.data.map(n => <div className="row" key={n.id}><span><b>{n.title}</b><br />{n.body}</span><small>{dOnly(n.createdAt)}</small></div>) : <Empty text="No announcements." />}</div>
  </Page>;
}

export function StudentSeats() {
  const [start, setStart] = useState(toLocalInput(new Date(Date.now() + 15 * 60000)));
  const [hours, setHours] = useState(3);
  const range = () => ({ start: new Date(start).toISOString(), end: new Date(new Date(start).getTime() + hours * 3600000).toISOString() });
  const map = useLoad<any[]>(() => api.get('/student/seats', { params: range() }).then(r => r.data), [start, hours], 30000);
  const [seat, setSeat] = useState<any>();
  const a = useAction();
  return <Page title="Book a seat">
    <div className="panel"><div className="formgrid"><Field label="Start"><input type="datetime-local" value={start} onChange={e => { setStart(e.target.value); setSeat(undefined); }} /></Field>
      <Field label="Duration (hours)"><select value={hours} onChange={e => { setHours(Number(e.target.value)); setSeat(undefined); }}>{[1, 2, 3, 4, 5, 6, 8].map(h => <option key={h} value={h}>{h}</option>)}</select></Field></div>
      {!map.data ? <Loading error={map.error} /> : <SeatGrid rooms={map.data} selected={seat?.id} onPick={s => s.state === 'AVAILABLE' ? setSeat(s) : a.run(async () => { throw { response: { data: { error: `Seat ${s.label} is ${s.state.toLowerCase()} for this time` } } }; })} />}
      <Msg m={a.msg} />
      <button disabled={!seat || a.busy} onClick={async () => { if (await a.run(() => api.post('/student/bookings', { seatId: seat.id, startAt: range().start, endAt: range().end }), `Seat ${seat.label} booked!`)) { setSeat(undefined); map.reload(); } }}>{seat ? `Book seat ${seat.label}` : 'Select an available seat'}</button></div>
  </Page>;
}

export function StudentBookings() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/student/bookings').then(r => r.data), [], 20000);
  const a = useAction();
  const go = async (id: string, act: string, ok: string) => { await a.run(() => api.post(`/student/bookings/${id}/${act}`), ok); reload(); };
  if (!data) return <Loading error={error} retry={reload} />;
  return <Page title="My seat bookings"><Msg m={a.msg} /><div className="panel tablewrap">{data.length ? <table><thead><tr><th>Booking ID</th><th>Seat</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>{data.map(b => <tr key={b.id}><td>{b.code ? <span className="codechip">{b.code}</span> : '—'}</td><td>{b.seat.room.name} · {b.seat.label}</td><td>{dt(b.startAt)} → {tOnly(b.endAt)}</td><td><Badge v={b.status} /></td>
    <td className="btnrow">{b.status === 'BOOKED' && <><button onClick={() => go(b.id, 'check-in', 'Checked in')}>Check in</button><button className="secondary" onClick={() => confirm('Cancel this booking?') && go(b.id, 'cancel', 'Cancelled')}>Cancel</button></>}{b.status === 'CHECKED_IN' && <button onClick={() => go(b.id, 'check-out', 'Checked out')}>Check out</button>}</td></tr>)}</tbody></table> : <Empty text="No bookings yet." />}</div></Page>;
}

const clock = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}`;
export function StudentStudy() {
  const active = useLoad<any>(() => api.get('/student/sessions/active').then(r => r.data));
  const hist = useLoad<any[]>(() => api.get('/student/sessions').then(r => r.data));
  const stats = useLoad<any>(() => api.get('/student/stats').then(r => r.data));
  const [subject, setSubject] = useState('');
  const [goals, setGoals] = useState<any>();
  const [, tick] = useState(0);
  const a = useAction();
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const refresh = () => { active.reload(); hist.reload(); stats.reload(); };
  const s = active.data;
  const onBreak = s?.breaks?.find((b: any) => !b.endedAt);
  const live = s ? Math.max(0, (Date.now() - new Date(s.startedAt).getTime()) / 1000 - s.breakSeconds - (onBreak ? (Date.now() - new Date(onBreak.startedAt).getTime()) / 1000 : 0)) : 0;
  const act = async (path: string, ok: string, body?: any) => { await a.run(() => api.post(`/student/sessions/${path}`, body), ok); refresh(); };
  const g = goals ?? stats.data;
  return <Page title="Study timer">
    <div className="panel center"><div className="timer">{clock(live)}</div><p className="muted">{s ? (onBreak ? 'On a break…' : `Studying${s.subject ? ' · ' + s.subject : ''}`) : 'No running session'}</p><Msg m={a.msg} />
      {!s ? <div className="btnrow"><input placeholder="Subject (optional)" value={subject} onChange={e => setSubject(e.target.value)} /><button onClick={() => act('start', 'Session started', { subject: subject || undefined })}>Start</button></div>
        : <div className="btnrow">{onBreak ? <button onClick={() => act('break/end', 'Welcome back')}>End break</button> : <button className="secondary" onClick={() => act('break/start', 'Break started')}>Take a break</button>}<button onClick={() => act('stop', 'Session saved')}>Stop</button></div>}</div>
    {g && <div className="panel"><h2>Study goals</h2><div className="formgrid"><Field label="Daily goal (minutes)"><input type="number" min={15} value={g.dailyGoalMin} onChange={e => setGoals({ ...g, dailyGoalMin: Number(e.target.value) })} /></Field><Field label="Weekly goal (minutes)"><input type="number" min={15} value={g.weeklyGoalMin} onChange={e => setGoals({ ...g, weeklyGoalMin: Number(e.target.value) })} /></Field></div>
      <button onClick={async () => { await a.run(() => api.patch('/student/goals', { dailyGoalMin: g.dailyGoalMin, weeklyGoalMin: g.weeklyGoalMin }), 'Goals saved'); setGoals(undefined); stats.reload(); }}>Save goals</button>
      {stats.data && <p className="muted">Today {hm(stats.data.todayMin)} · this week {hm(stats.data.weekMin)}</p>}</div>}
    <div className="panel tablewrap"><h2>Session history</h2>{hist.data?.length ? <table><thead><tr><th>Started</th><th>Subject</th><th>Studied</th><th>Breaks</th></tr></thead><tbody>{hist.data.map(x => <tr key={x.id}><td>{dt(x.startedAt)}</td><td>{x.subject || '—'}</td><td>{hm(x.studySeconds / 60)}{!x.endedAt && ' (running)'}</td><td>{x.breakCount} · {hm(x.breakSeconds / 60)}</td></tr>)}</tbody></table> : <Empty text="No sessions yet." />}</div>
  </Page>;
}

export function StudentBooks() {
  const [q, setQ] = useState(''), [cat, setCat] = useState('');
  const books = useLoad<any[]>(() => api.get('/student/books', { params: { q, category: cat || undefined } }).then(r => r.data), [q, cat]);
  const cats = useLoad<string[]>(() => api.get('/student/books/categories').then(r => r.data));
  const issues = useLoad<any[]>(() => api.get('/student/issues').then(r => r.data));
  const a = useAction();
  const payFine = async (i: any) => { const c = await a.run(() => api.post('/student/payments/checkout', { kind: 'FINE', issueId: i.id }), '').then(r => r?.data); if (c) { await a.run(() => api.post(`/student/payments/${c.paymentId}/confirm`), 'Fine paid'); issues.reload(); } };
  return <Page title="Books">
    <div className="panel tablewrap"><h2>My books</h2><Msg m={a.msg} />{issues.data?.length ? <table><thead><tr><th>Book</th><th>Issued</th><th>Due</th><th>Fine</th><th></th></tr></thead><tbody>{issues.data.map(i => <tr key={i.id}><td>{i.book.title}</td><td>{dOnly(i.issuedAt)}</td><td>{dOnly(i.dueAt)} {i.returnedAt ? <Badge v="RETURNED" /> : i.overdue ? <Badge v="OVERDUE" /> : null}</td><td>{inr(i.accruedFineCents)}{i.finePaid && ' (paid)'}</td>
      <td>{i.returnedAt && i.fineCents > 0 && !i.finePaid && <button onClick={() => payFine(i)}>Pay fine</button>}</td></tr>)}</tbody></table> : <Empty text="You have no issued books." />}</div>
    <div className="panel"><h2>Catalogue</h2><div className="tabs"><input placeholder="Search title / author / ISBN" value={q} onChange={e => setQ(e.target.value)} /><select value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{cats.data?.map(c => <option key={c}>{c}</option>)}</select></div>
      <div className="tablewrap"><table><thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Shelf</th><th>Availability</th></tr></thead><tbody>{books.data?.map(b => <tr key={b.id}><td>{b.title}</td><td>{b.author}</td><td>{b.category}</td><td>{b.shelf}</td><td>{b.available > 0 ? <Badge v="AVAILABLE" /> : <Badge v="UNAVAILABLE" />} {b.available}/{b.copies}</td></tr>)}</tbody></table></div><p className="muted">Ask at the desk to borrow a book.</p></div>
  </Page>;
}

export function StudentMembership() {
  const plans = useLoad<any>(() => api.get('/student/plans').then(r => r.data));
  const mems = useLoad<any[]>(() => api.get('/student/memberships').then(r => r.data));
  const pays = useLoad<any[]>(() => api.get('/student/payments').then(r => r.data));
  const [batchId, setBatch] = useState('');
  const a = useAction();
  const refresh = () => { mems.reload(); pays.reload(); };
  const buy = async (p: any) => {
    const c = (await a.run(() => api.post('/student/payments/checkout', { kind: 'MEMBERSHIP', planId: p.id, batchId: batchId || undefined }), ''))?.data;
    if (!c) return;
    if (!confirm(`Pay ${inr(c.amountCents)} for ${p.name}?\n(Demo gateway — no real money moves.)`)) { await api.post(`/student/payments/${c.paymentId}/fail`); return; }
    await a.run(() => api.post(`/student/payments/${c.paymentId}/confirm`), 'Payment successful — membership active'); refresh();
  };
  const cancel = async (m: any) => {
    const pv = (await api.get(`/student/memberships/${m.id}/refund-preview`)).data;
    if (confirm(`Cancel this membership?\nPaid: ${inr(pv.paidCents)}\nRefund under library rules: ${inr(pv.refundCents)}`)) { await a.run(() => api.post(`/student/memberships/${m.id}/cancel`), 'Membership cancelled'); refresh(); }
  };
  const invoice = async (id: string) => printInvoice((await api.get(`/student/payments/${id}/invoice`)).data);
  if (!plans.data) return <Loading error={plans.error} />;
  const r = plans.data.rules;
  return <Page title="Membership & payments"><Msg m={a.msg} />
    <div className="panel"><h2>Choose a plan</h2>
      <Field label="Preferred batch (optional)"><select value={batchId} onChange={e => setBatch(e.target.value)}><option value="">No specific batch</option>{plans.data.batches.map((b: any) => <option key={b.id} value={b.id}>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][b.dayOfWeek]} {b.name} {b.startTime}-{b.endTime}</option>)}</select></Field>
      <div className="grid">{plans.data.plans.map((p: any) => <div className="stat" key={p.id}><b>{p.name}</b><span>{inr(p.priceCents)} · {p.months} month(s)</span><small className="muted">{p.description}</small><button onClick={() => buy(p)}>Buy</button></div>)}</div>
      <p className="muted">Cancellation: full refund within {r.refundFullHours} h of purchase; afterwards {r.refundProratePct}% of the unused time is refunded.</p></div>
    <div className="panel"><h2>My memberships</h2>{mems.data?.length ? mems.data.map(m => <div className="row" key={m.id}><span>{m.plan?.name ?? `${m.months} mo`} · {dOnly(m.startDate)} → {dOnly(m.endDate)} {m.batch && `· ${m.batch.name}`}</span><span className="btnrow"><Badge v={m.status} />{m.status === 'ACTIVE' && <button className="secondary" onClick={() => cancel(m)}>Cancel</button>}</span></div>) : <Empty text="No memberships yet." />}</div>
    <div className="panel tablewrap"><h2>Payment history</h2>{pays.data?.length ? <table><thead><tr><th>Date</th><th>For</th><th>Amount</th><th>Refunded</th><th>Status</th><th></th></tr></thead><tbody>{pays.data.map(p => <tr key={p.id}><td>{dt(p.paidAt ?? p.createdAt)}</td><td>{p.kind}</td><td>{inr(p.amountCents)}</td><td>{inr(p.refundedCents)}</td><td><Badge v={p.status} /></td><td>{p.invoiceNo && <button className="secondary" onClick={() => invoice(p.id)}>Invoice</button>}</td></tr>)}</tbody></table> : <Empty text="No payments." />}</div>
  </Page>;
}

export function StudentNotifications() {
  const { data, error, reload } = useLoad<any>(() => api.get('/student/notifications').then(r => r.data), [], 30000);
  if (!data) return <Loading error={error} retry={reload} />;
  return <Page title="Notifications" actions={data.unread ? <button onClick={async () => { await api.post('/student/notifications/read'); reload(); }}>Mark all read ({data.unread})</button> : undefined}>
    <PushButton label="🔔 Send me alerts on this device" save={sub => api.post('/student/push/subscribe', { subscription: sub })} />
    <div className="panel">{data.items.length ? data.items.map((n: any) => <div className={`row ${n.readAt ? '' : 'unread'}`} key={n.id}><span><b>{n.title}</b><br />{n.body}</span><small>{dt(n.createdAt)}</small></div>) : <Empty text="Nothing yet." />}</div></Page>;
}

export function StudentProfile() {
  const me = useLoad<any>(() => api.get('/student/me').then(r => r.data));
  const card = useLoad<any>(() => api.get('/student/card').then(r => r.data));
  const [f, setF] = useState<any>();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const a = useAction(), b = useAction();
  if (!me.data || !card.data) return <Loading error={me.error || card.error} />;
  const v = f ?? me.data, c = card.data;
  return <Page title="Profile & ID card">
    <div className="idcard"><small>{c.library}</small><h2>{c.name}</h2><div className="cardno">{c.cardNo}</div><small>{c.status === 'ACTIVE' ? `Valid until ${dOnly(c.validUntil)}` : 'No active membership'}</small></div>
    <button className="secondary" style={{ margin: '0 30px' }} onClick={() => printHtml('Library ID card', `<div style="width:340px;border:2px solid #172033;border-radius:14px;padding:20px"><small>${c.library}</small><h2>${c.name}</h2><div style="font:700 22px monospace;letter-spacing:2px">${c.cardNo}</div><small>${c.status === 'ACTIVE' ? 'Valid until ' + dOnly(c.validUntil) : 'No active membership'}</small></div>`)}>Print card</button>
    <form className="panel" onSubmit={async e => { e.preventDefault(); await a.run(() => api.patch('/student/me', { name: v.name, phone: v.phone || null, address: v.address || null, examGoal: v.examGoal || null }), 'Profile saved'); me.reload(); }}>
      <h2>Profile</h2><div className="formgrid"><Field label="Name"><input value={v.name} onChange={e => setF({ ...v, name: e.target.value })} required minLength={2} /></Field><Field label="Phone"><input value={v.phone || ''} onChange={e => setF({ ...v, phone: e.target.value })} /></Field><Field label="Address"><input value={v.address || ''} onChange={e => setF({ ...v, address: e.target.value })} /></Field><Field label="Preparing for"><input value={v.examGoal || ''} onChange={e => setF({ ...v, examGoal: e.target.value })} /></Field></div><Msg m={a.msg} /><button>Save</button></form>
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await b.run(() => api.post('/auth/change-password', pw), 'Password changed')) setPw({ currentPassword: '', newPassword: '' }); }}>
      <h2>Change password</h2><div className="formgrid"><Field label="Current"><input type="password" value={pw.currentPassword} onChange={e => setPw({ ...pw, currentPassword: e.target.value })} required /></Field><Field label="New (min 8)"><input type="password" minLength={8} value={pw.newPassword} onChange={e => setPw({ ...pw, newPassword: e.target.value })} required /></Field></div><Msg m={b.msg} /><button>Change password</button></form>
  </Page>;
}
