import { useState } from 'react';
import { api, Page, Loading, Field, Msg, useAction, useLoad, Badge, Empty, Stat, Progress, dt, dOnly, inr, DAYS, rupeesToCents, toLocalInput, hm } from '../lib/ui';

export function SeatGrid({ rooms, selected, onPick }: { rooms: any[]; selected?: string; onPick?: (s: any) => void }) {
  if (!rooms.length) return <Empty text="No rooms yet." />;
  return <>{rooms.map(r => <div key={r.id} className="room"><h3>{r.name} <small className="muted">· floor {r.floor}</small></h3>
    <div className="seatgrid">{r.seats.map((s: any) => <button key={s.id} type="button" title={s.bookings?.[0]?.student?.name || s.state} className={`seat ${s.state} ${selected === s.id ? 'selected' : ''}`} onClick={() => onPick?.(s)}>{s.label}</button>)}</div></div>)}
    <div className="legend"><span className="seat AVAILABLE" />Available <span className="seat RESERVED" />Reserved <span className="seat OCCUPIED" />Occupied <span className="seat MAINTENANCE" />Maintenance</div></>;
}

export function LibDashboard() {
  const { data, error, reload } = useLoad<any>(() => api.get('/library/dashboard').then(r => r.data), [], 30000);
  if (!data) return <Loading error={error} retry={reload} />;
  const c = data.counts;
  return <Page title="Library dashboard">
    <div className="grid">{Object.entries(c).map(([k, v]) => <Stat key={k} k={k.replace('_inr', ' ₹').replace('_pct', ' %')} v={String(v)} />)}</div>
    <div className="panel"><h2>Occupancy now</h2><Progress value={c.occupancy_pct} max={100} /><p className="muted">{c.occupied_now} occupied + {c.reserved_now} reserved of {c.total_seats} seats · 7-day utilisation {c.seat_utilization_7d_pct}%</p></div>
    <div className="panel"><h2>Recent activity</h2>{data.recent.length ? data.recent.map((x: any) => <div className="row" key={x.id}><span>{x.action}</span><small>{dt(x.createdAt)}</small></div>) : <Empty text="No recent activity." />}</div>
  </Page>;
}

export function Seats() {
  const [at, setAt] = useState(toLocalInput(new Date()));
  const map = useLoad<any[]>(() => api.get('/library/seat-map', { params: { start: new Date(at).toISOString(), end: new Date(new Date(at).getTime() + 60000).toISOString() } }).then(r => r.data), [at], 20000);
  const bks = useLoad<any[]>(() => api.get('/library/seat-bookings', { params: { active: 1 } }).then(r => r.data), [], 20000);
  const [room, setRoom] = useState({ name: '', floor: 1, rows: 4, cols: 5, prefix: 'S' });
  const [scan, setScan] = useState('');
  const a = useAction();
  const refresh = () => { map.reload(); bks.reload(); };
  return <Page title="Seats & check-in">
    <div className="panel"><div className="row"><Field label="Seat map at"><input type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></Field>
      <form className="btnrow" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => api.post('/library/checkin-by-card', { cardNo: scan }), 'Done'); if (r) { setScan(''); refresh(); alert(`${r.data.student}: ${r.data.action.replace('_', ' ').toLowerCase()}`); } }}>
        <input placeholder="Scan / type card no. (LIB-…)" value={scan} onChange={e => setScan(e.target.value)} required /><button>Check in / out</button></form></div><Msg m={a.msg} />
      {!map.data ? <Loading error={map.error} /> : <SeatGrid rooms={map.data} onPick={async s => { if (s.status === 'MAINTENANCE' || confirm(`Mark seat ${s.label} as under maintenance?`)) { await a.run(() => api.patch(`/library/seats/${s.id}`, { status: s.status === 'MAINTENANCE' ? 'AVAILABLE' : 'MAINTENANCE' }), 'Seat updated'); refresh(); } }} />}
      <p className="muted">Click a seat to toggle maintenance. Hover to see who holds it.</p></div>
    <div className="panel tablewrap"><h2>Active & upcoming bookings</h2>{bks.data?.length ? <table><thead><tr><th>Booking ID</th><th>Student</th><th>Seat</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>{bks.data.map(b => <tr key={b.id}><td>{b.code ? <span className="codechip">{b.code}</span> : '—'}</td><td>{b.student.name}<br /><small className="muted">{b.student.cardNo}</small></td><td>{b.seat.room.name} · {b.seat.label}</td><td>{dt(b.startAt)} → {new Date(b.endAt).toLocaleTimeString([], { timeStyle: 'short' })}</td><td><Badge v={b.status} /></td>
      <td className="btnrow">{b.status === 'BOOKED' && <><button onClick={async () => { await a.run(() => api.post(`/library/seat-bookings/${b.id}/check-in`), 'Checked in'); refresh(); }}>Check in</button><button className="secondary" onClick={async () => { await a.run(() => api.post(`/library/seat-bookings/${b.id}/cancel`), 'Cancelled'); refresh(); }}>Cancel</button></>}{b.status === 'CHECKED_IN' && <button onClick={async () => { await a.run(() => api.post(`/library/seat-bookings/${b.id}/check-out`), 'Checked out'); refresh(); }}>Check out</button>}</td></tr>)}</tbody></table> : <Empty text="Nothing active." />}</div>
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/library/rooms', { ...room, floor: Number(room.floor), rows: Number(room.rows), cols: Number(room.cols) }), 'Room created')) { setRoom({ ...room, name: '' }); refresh(); } }}>
      <h2>Add room / floor</h2><div className="formgrid"><Field label="Room name"><input value={room.name} onChange={e => setRoom({ ...room, name: e.target.value })} required /></Field><Field label="Floor"><input type="number" value={room.floor} onChange={e => setRoom({ ...room, floor: e.target.value as any })} /></Field>
        <Field label="Seat rows"><input type="number" min={0} max={30} value={room.rows} onChange={e => setRoom({ ...room, rows: e.target.value as any })} /></Field><Field label="Seats per row"><input type="number" min={0} max={30} value={room.cols} onChange={e => setRoom({ ...room, cols: e.target.value as any })} /></Field>
        <Field label="Label prefix"><input maxLength={4} value={room.prefix} onChange={e => setRoom({ ...room, prefix: e.target.value })} /></Field></div><button>Create room with seats</button></form>
  </Page>;
}

export function Students() {
  const [q, setQ] = useState('');
  const { data, error, reload } = useLoad<any[]>(() => api.get('/library/students', { params: { q } }).then(r => r.data), [q]);
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const [detail, setDetail] = useState<any>();
  const a = useAction();
  return <Page title="Students">
    <input placeholder="Search name, email, phone or card" value={q} onChange={e => setQ(e.target.value)} />
    <form className="panel" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => api.post('/library/students', { name: f.name, phone: f.phone || undefined, email: f.email || undefined }), 'Student created'); if (r) { alert(`Card: ${r.data.student.cardNo}\nTemporary password: ${r.data.tempPassword}\n(shown once)`); setF({ name: '', phone: '', email: '' }); reload(); } }}>
      <h2>Register student</h2><div className="formgrid"><Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={2} /></Field><Field label="Phone"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field><Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field></div><Msg m={a.msg} /><button>Create</button></form>
    {!data ? <Loading error={error} retry={reload} /> : <div className="panel tablewrap"><table><thead><tr><th>Name</th><th>Card</th><th>Contact</th><th>Membership</th><th>Status</th><th></th></tr></thead><tbody>{data.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.cardNo}</td><td>{s.email || s.phone || '—'}</td><td>{s.memberships[0] ? `${s.memberships[0].plan?.name ?? 'Custom'} · till ${dOnly(s.memberships[0].endDate)}` : '—'}</td><td><Badge v={s.status} /></td>
      <td className="btnrow"><button className="secondary" onClick={async () => setDetail((await api.get(`/library/students/${s.id}`)).data)}>View</button>
        <button className="secondary" onClick={async () => { await a.run(() => api.patch(`/library/students/${s.id}`, { status: s.status === 'ACTIVE' ? 'BLOCKED' : 'ACTIVE' }), 'Updated'); reload(); }}>{s.status === 'ACTIVE' ? 'Block' : 'Unblock'}</button>
        <button className="secondary" onClick={async () => { const r = await a.run(() => api.post(`/library/students/${s.id}/reset-password`), 'Password reset'); if (r) alert(`Temporary password: ${r.data.tempPassword}`); }}>Reset pw</button>
        <button className="secondary" onClick={async () => { if (confirm('Issue a new card number? The old one stops working.')) { const r = await a.run(() => api.post(`/library/students/${s.id}/reissue-card`), 'Card reissued'); if (r) { alert(`New card: ${r.data.cardNo}`); reload(); } } }}>Reissue card</button></td></tr>)}</tbody></table></div>}
    {detail && <div className="panel"><div className="row"><h2>{detail.name} · {detail.cardNo}</h2><button className="secondary" onClick={() => setDetail(undefined)}>Close</button></div>
      <p className="muted">{detail.email} {detail.phone} · goal {hm(detail.dailyGoalMin)}/day</p>
      <h3>Memberships</h3>{detail.memberships.map((m: any) => <div className="row" key={m.id}><span>{m.plan?.name ?? `${m.months} mo`} · {dOnly(m.startDate)} → {dOnly(m.endDate)}</span><Badge v={m.status} /></div>)}
      <h3>Books</h3>{detail.issues.map((i: any) => <div className="row" key={i.id}><span>{i.book.title}</span><small>{i.returnedAt ? 'returned' : 'due ' + dOnly(i.dueAt)}</small></div>)}
      <h3>Payments</h3>{detail.payments.map((p: any) => <div className="row" key={p.id}><span>{p.kind} {p.invoiceNo}</span><span>{inr(p.amountCents)} <Badge v={p.status} /></span></div>)}</div>}
  </Page>;
}

export function Admission() {
  const plans = useLoad<any[]>(() => api.get('/library/plans').then(r => r.data));
  const batches = useLoad<any[]>(() => api.get('/library/batches').then(r => r.data));
  const students = useLoad<any[]>(() => api.get('/library/students').then(r => r.data));
  const mems = useLoad<any[]>(() => api.get('/library/memberships').then(r => r.data));
  const [f, setF] = useState<any>({ studentId: '', name: '', phone: '', planId: '', batchId: '', months: 1, fee: '', startDate: new Date().toISOString().slice(0, 10), method: 'CASH' });
  const [p, setP] = useState({ name: '', months: 1, price: '' });
  const a = useAction(), b = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const plan = plans.data?.find(x => x.id === f.planId);
  return <Page title="Admission & memberships">
    <form className="panel" onSubmit={async e => { e.preventDefault();
      const r = await a.run(() => api.post('/library/memberships', { studentId: f.studentId || undefined, newStudent: f.studentId ? undefined : { name: f.name, phone: f.phone || undefined }, planId: f.planId || undefined, batchId: f.batchId || undefined, months: f.planId ? undefined : Number(f.months), feeCents: f.fee !== '' ? rupeesToCents(f.fee) : f.planId ? undefined : 0, startDate: f.startDate, method: f.method }), 'Admission saved');
      if (r) { if (r.data.tempPassword) alert(`New student created.\nTemporary password: ${r.data.tempPassword}`); setF({ ...f, studentId: '', name: '', phone: '', fee: '' }); mems.reload(); students.reload(); batches.reload(); } }}>
      <h2>Admit / renew student</h2>
      <div className="formgrid"><Field label="Existing student"><select value={f.studentId} onChange={set('studentId')}><option value="">— new student —</option>{students.data?.map(s => <option key={s.id} value={s.id}>{s.name} ({s.cardNo})</option>)}</select></Field>
        {!f.studentId && <><Field label="New student name"><input value={f.name} onChange={set('name')} required minLength={2} /></Field><Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field></>}
        <Field label="Plan"><select value={f.planId} onChange={set('planId')}><option value="">Custom</option>{plans.data?.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{x.name} — {inr(x.priceCents)}</option>)}</select></Field>
        {!f.planId && <Field label="Months"><input type="number" min={1} max={36} value={f.months} onChange={set('months')} /></Field>}
        <Field label={`Fee ₹${plan ? ` (plan: ${plan.priceCents / 100})` : ''}`}><input type="number" min={0} value={f.fee} onChange={set('fee')} placeholder={plan ? String(plan.priceCents / 100) : ''} required={!f.planId} /></Field>
        <Field label="Batch (optional)"><select value={f.batchId} onChange={set('batchId')}><option value="">No batch</option>{batches.data?.filter(x => x.active).map(x => <option key={x.id} value={x.id}>{DAYS[x.dayOfWeek]} {x.name} {x.startTime}-{x.endTime} ({Math.max(0, x.capacity - x._count.memberships)} left)</option>)}</select></Field>
        <Field label="Start date"><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Payment received by"><select value={f.method} onChange={set('method')}><option>CASH</option><option>UPI</option></select></Field></div>
      <Msg m={a.msg} /><button>Save admission</button></form>
    <div className="panel"><h2>Membership plans</h2>{plans.data?.map(x => <div className="row" key={x.id}><span>{x.name} · {x.months} mo · {inr(x.priceCents)}</span><button className="secondary" onClick={async () => { await api.patch(`/library/plans/${x.id}`, { active: !x.active }); plans.reload(); }}>{x.active ? 'Disable' : 'Enable'}</button></div>)}
      <form className="formgrid" onSubmit={async e => { e.preventDefault(); if (await b.run(() => api.post('/library/plans', { name: p.name, months: Number(p.months), priceCents: rupeesToCents(p.price) }), 'Plan added')) { setP({ name: '', months: 1, price: '' }); plans.reload(); } }}>
        <input placeholder="Plan name" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} required /><input type="number" min={1} placeholder="Months" value={p.months} onChange={e => setP({ ...p, months: e.target.value as any })} /><input type="number" min={0} placeholder="Price ₹" value={p.price} onChange={e => setP({ ...p, price: e.target.value })} required /><button>Add plan</button></form><Msg m={b.msg} /></div>
    <div className="panel tablewrap"><h2>All memberships</h2><table><thead><tr><th>Student</th><th>Plan</th><th>Period</th><th>Fee</th><th>Status</th><th></th></tr></thead><tbody>{mems.data?.map(m => <tr key={m.id}><td>{m.student?.name ?? m.studentName}</td><td>{m.plan?.name ?? `${m.months} mo`}{m.batch && ` · ${m.batch.name}`}</td><td>{dOnly(m.startDate)} → {dOnly(m.endDate)}</td><td>{inr(m.feeCents)}{m.refundCents > 0 && <small className="muted"> (refund {inr(m.refundCents)})</small>}</td><td><Badge v={m.status} /></td>
      <td>{m.status === 'ACTIVE' && <button className="secondary" onClick={async () => { const override = prompt('Refund amount in ₹ (leave empty to apply library refund rules)'); if (override === null) return; await a.run(() => api.post(`/library/memberships/${m.id}/cancel`, override === '' ? {} : { refundCents: rupeesToCents(override) }), 'Membership cancelled'); mems.reload(); }}>Cancel</button>}</td></tr>)}</tbody></table></div>
  </Page>;
}

export function Batches() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/library/batches').then(r => r.data));
  const [f, setF] = useState<any>({ name: '', dayOfWeek: 1, startTime: '08:00', endTime: '12:00', capacity: 20 });
  const a = useAction();
  return <Page title="Batches & capacity">
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/library/batches', { ...f, dayOfWeek: Number(f.dayOfWeek), capacity: Number(f.capacity) }), 'Batch added')) reload(); }}>
      <div className="formgrid"><Field label="Name"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required minLength={2} /></Field><Field label="Day"><select value={f.dayOfWeek} onChange={e => setF({ ...f, dayOfWeek: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
        <Field label="Start"><input type="time" value={f.startTime} onChange={e => setF({ ...f, startTime: e.target.value })} /></Field><Field label="End"><input type="time" value={f.endTime} onChange={e => setF({ ...f, endTime: e.target.value })} /></Field><Field label="Capacity"><input type="number" min={1} value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} /></Field></div><Msg m={a.msg} /><button>Add batch</button></form>
    {!data ? <Loading error={error} retry={reload} /> : <div className="grid">{data.map(b => <div className="stat" key={b.id}><b>{b.name}</b><span>{DAYS[b.dayOfWeek]} · {b.startTime} – {b.endTime}</span><span>Seats left: {Math.max(0, b.capacity - b._count.memberships)} / {b.capacity}</span><Badge v={b.active ? 'ACTIVE' : 'INACTIVE'} />
      <button className="secondary" onClick={async () => { await api.patch(`/library/batches/${b.id}`, { active: !b.active }); reload(); }}>{b.active ? 'Disable' : 'Enable'}</button></div>)}</div>}
  </Page>;
}

export function Books() {
  const [q, setQ] = useState(''), [cat, setCat] = useState('');
  const books = useLoad<any[]>(() => api.get('/library/books', { params: { q, category: cat || undefined } }).then(r => r.data), [q, cat]);
  const cats = useLoad<string[]>(() => api.get('/library/books/categories').then(r => r.data));
  const issues = useLoad<any[]>(() => api.get('/library/issues', { params: { status: 'open' } }).then(r => r.data), [], 30000);
  const fines = useLoad<any[]>(() => api.get('/library/issues', { params: { status: 'fines' } }).then(r => r.data));
  const [f, setF] = useState<any>({ title: '', author: '', isbn: '', category: '', shelf: '', copies: 1 });
  const [iss, setIss] = useState({ bookId: '', cardNo: '' });
  const a = useAction(), b = useAction();
  const all = () => { books.reload(); issues.reload(); fines.reload(); cats.reload(); };
  return <Page title="Books & circulation">
    <form className="panel" onSubmit={async e => { e.preventDefault(); const r = await b.run(() => api.post('/library/issues', { bookId: iss.bookId, cardNo: iss.cardNo }), 'Book issued'); if (r) { setIss({ ...iss, cardNo: '' }); all(); } }}>
      <h2>Issue a book</h2><div className="formgrid"><Field label="Book"><select value={iss.bookId} onChange={e => setIss({ ...iss, bookId: e.target.value })} required><option value="">Select…</option>{books.data?.filter(x => x.available > 0).map(x => <option key={x.id} value={x.id}>{x.title} ({x.available} avail.)</option>)}</select></Field><Field label="Student card no."><input value={iss.cardNo} onChange={e => setIss({ ...iss, cardNo: e.target.value })} placeholder="LIB-123456" required /></Field></div><Msg m={b.msg} /><button>Issue</button></form>
    <div className="panel tablewrap"><h2>Currently issued</h2>{issues.data?.length ? <table><thead><tr><th>Book</th><th>Student</th><th>Due</th><th>Fine so far</th><th></th></tr></thead><tbody>{issues.data.map(i => <tr key={i.id}><td>{i.book.title}</td><td>{i.student.name} <small className="muted">{i.student.cardNo}</small></td><td>{dOnly(i.dueAt)} {new Date(i.dueAt) < new Date() && <Badge v="OVERDUE" />}</td><td>{inr(i.accruedFineCents)}</td>
      <td><button onClick={async () => { await b.run(() => api.post(`/library/issues/${i.id}/return`), 'Returned'); all(); }}>Return</button></td></tr>)}</tbody></table> : <Empty text="No books out." />}</div>
    {!!fines.data?.length && <div className="panel tablewrap"><h2>Unpaid fines</h2><table><tbody>{fines.data.map(i => <tr key={i.id}><td>{i.book.title}</td><td>{i.student.name}</td><td>{inr(i.fineCents)}</td><td className="btnrow"><button onClick={async () => { await b.run(() => api.post(`/library/issues/${i.id}/pay-fine`), 'Fine recorded as paid'); all(); }}>Mark paid (cash)</button><button className="secondary" onClick={async () => { await b.run(() => api.post(`/library/issues/${i.id}/waive-fine`), 'Fine waived'); all(); }}>Waive</button></td></tr>)}</tbody></table></div>}
    <div className="panel"><h2>Catalogue</h2><div className="tabs"><input placeholder="Search title / author / ISBN" value={q} onChange={e => setQ(e.target.value)} /><select value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{cats.data?.map(c => <option key={c}>{c}</option>)}</select></div>
      <div className="tablewrap"><table><thead><tr><th>Title</th><th>Author</th><th>Category</th><th>Shelf</th><th>Available</th><th></th></tr></thead><tbody>{books.data?.map(x => <tr key={x.id}><td>{x.title}</td><td>{x.author}</td><td>{x.category}</td><td>{x.shelf}</td><td>{x.available}/{x.copies}</td><td><button className="secondary" onClick={async () => { if (confirm('Delete this book?')) { await a.run(() => api.delete(`/library/books/${x.id}`), 'Deleted'); all(); } }}>Delete</button></td></tr>)}</tbody></table></div><Msg m={a.msg} />
      <form onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/library/books', { title: f.title, author: f.author, isbn: f.isbn || undefined, category: f.category || undefined, shelf: f.shelf || undefined, copies: Number(f.copies) }), 'Book added')) { setF({ ...f, title: '', author: '', isbn: '' }); all(); } }}>
        <h3>Add book</h3><div className="formgrid"><input placeholder="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /><input placeholder="Author" value={f.author} onChange={e => setF({ ...f, author: e.target.value })} required /><input placeholder="ISBN" value={f.isbn} onChange={e => setF({ ...f, isbn: e.target.value })} /><input placeholder="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /><input placeholder="Shelf" value={f.shelf} onChange={e => setF({ ...f, shelf: e.target.value })} /><input type="number" min={1} placeholder="Copies" value={f.copies} onChange={e => setF({ ...f, copies: e.target.value })} /></div><button>Add book</button></form></div>
  </Page>;
}

export function Payments() {
  const [kind, setKind] = useState('');
  const { data, error, reload } = useLoad<any[]>(() => api.get('/library/payments', { params: { kind: kind || undefined } }).then(r => r.data), [kind]);
  const a = useAction();
  return <Page title="Payments & refunds">
    <select value={kind} onChange={e => setKind(e.target.value)}><option value="">All</option><option value="MEMBERSHIP">Memberships</option><option value="FINE">Fines</option></select><Msg m={a.msg} />
    {!data ? <Loading error={error} retry={reload} /> : <div className="panel tablewrap"><table><thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Invoice</th><th>Amount</th><th>Refunded</th><th>Method</th><th>Status</th><th></th></tr></thead><tbody>{data.map(p => <tr key={p.id}><td>{dt(p.paidAt ?? p.createdAt)}</td><td>{p.student?.name ?? '—'}</td><td>{p.kind}</td><td>{p.invoiceNo ?? '—'}</td><td>{inr(p.amountCents)}</td><td>{inr(p.refundedCents)}</td><td>{p.method}</td><td><Badge v={p.status} /></td>
      <td>{['PAID', 'PARTIALLY_REFUNDED'].includes(p.status) && <button className="secondary" onClick={async () => { const v = prompt(`Refund amount in ₹ (max ${(p.amountCents - p.refundedCents) / 100})`, String((p.amountCents - p.refundedCents) / 100)); if (v) { await a.run(() => api.post(`/library/payments/${p.id}/refund`, { amountCents: rupeesToCents(v), reason: 'Refund by owner' }), 'Refund recorded'); reload(); } }}>Refund</button>}</td></tr>)}</tbody></table></div>}
  </Page>;
}

export function Announcements() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/library/announcements').then(r => r.data));
  const [f, setF] = useState({ title: '', body: '' });
  const a = useAction();
  return <Page title="Announcements">
    <form className="panel" onSubmit={async e => { e.preventDefault(); const r = await a.run(() => api.post('/library/announcements', f), 'Announcement sent'); if (r) { setF({ title: '', body: '' }); reload(); } }}>
      <Field label="Title"><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></Field><Field label="Message (sent to every active student)"><textarea rows={3} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} required /></Field><Msg m={a.msg} /><button>Publish & notify</button></form>
    {!data ? <Loading error={error} /> : <div className="panel">{data.map(x => <div className="row" key={x.id}><span><b>{x.title}</b><br />{x.body}<br /><small className="muted">{dt(x.createdAt)}</small></span><button className="secondary" onClick={async () => { await api.delete(`/library/announcements/${x.id}`); reload(); }}>Delete</button></div>)}</div>}
  </Page>;
}

export function Reports() {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useLoad<any>(() => api.get('/library/reports', { params: { days } }).then(r => r.data), [days]);
  if (!data) return <Loading error={error} retry={reload} />;
  const max = Math.max(1, ...data.daily.map((d: any) => d.revenueInr));
  const csv = () => { const rows = [['date', 'revenue_inr', 'new_students', 'seat_bookings', 'study_hours'], ...data.daily.map((d: any) => [d.date, d.revenueInr, d.newStudents, d.bookings, d.studyHours])]; const u = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' })); Object.assign(document.createElement('a'), { href: u, download: `library-report-${days}d.csv` }).click(); URL.revokeObjectURL(u); };
  return <Page title="Reports" actions={<div className="btnrow"><select value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}</select><button className="secondary" onClick={csv}>Export CSV</button></div>}>
    <div className="grid">{Object.entries(data.totals).map(([k, v]) => <Stat key={k} k={k.replace(/([A-Z])/g, ' $1').toLowerCase()} v={String(v)} />)}</div>
    <div className="panel"><h2>Daily revenue (₹)</h2>{data.daily.length ? data.daily.map((d: any) => <div className="barrow" key={d.date}><span>{d.date.slice(5)}</span><div className="bar"><i style={{ width: `${(d.revenueInr / max) * 100}%` }} /></div><b>{d.revenueInr}</b></div>) : <Empty text="No data." />}</div>
    <div className="panel tablewrap"><h2>Most used seats</h2><table><thead><tr><th>Seat</th><th>Hours</th><th>Bookings</th></tr></thead><tbody>{data.topSeats.map((s: any) => <tr key={s.seat}><td>{s.seat}</td><td>{s.hours}</td><td>{s.bookings}</td></tr>)}</tbody></table></div>
  </Page>;
}

const SET_LABELS: Record<string, string> = { finePerDayCents: 'Fine per overdue day (₹)', loanDays: 'Loan period (days)', maxBooksPerStudent: 'Max books per student', bookingGraceMin: 'Booking expires after (min late)', maxBookingHours: 'Max hours per seat booking', bookingCancelMinBefore: 'Student cancel cut-off (min before start)', refundFullHours: 'Full refund window (hours after purchase)', refundProratePct: 'Refund % of unused time after window' };
export function Settings() {
  const { data, error, reload } = useLoad<any>(() => api.get('/library/settings').then(r => r.data));
  const [f, setF] = useState<any>();
  const a = useAction();
  if (!data) return <Loading error={error} retry={reload} />;
  const v = f ?? data;
  return <Page title="Library rules">
    <form className="panel" onSubmit={async e => { e.preventDefault(); const body: any = {}; for (const k of Object.keys(SET_LABELS)) body[k] = k === 'finePerDayCents' ? rupeesToCents(v[k] / 100) : Number(v[k]); await a.run(() => api.put('/library/settings', body), 'Rules saved'); }}>
      <div className="formgrid">{Object.keys(SET_LABELS).map(k => <Field key={k} label={SET_LABELS[k]}><input type="number" min={0} step={k === 'finePerDayCents' ? '0.5' : '1'} value={k === 'finePerDayCents' ? v[k] / 100 : v[k]} onChange={e => setF({ ...v, [k]: k === 'finePerDayCents' ? Number(e.target.value) * 100 : e.target.value })} /></Field>)}</div><Msg m={a.msg} /><button>Save rules</button></form>
  </Page>;
}

// ───────────── Public website editor, enquiries, feedback ─────────────
export function Website() {
  const { data, error, reload } = useLoad<any>(() => api.get('/library/website').then(r => r.data));
  const [f, setF] = useState<any>();
  const a = useAction();
  if (!data) return <Loading error={error} retry={reload} />;
  const v = f ?? data, c = v.content;
  const setC = (patch: any) => setF({ ...v, content: { ...c, ...patch } });
  const list = (key: string, i: number, patch: any) => setC({ [key]: c[key].map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  const url = `${window.location.origin}/${v.slug}`;
  const save = async () => { if (await a.run(() => api.put('/library/website', { slug: v.slug, published: v.published, phone: v.phone || null, address: v.address || null, content: c }), 'Website saved')) { setF(undefined); reload(); } };
  return <Page title="Public website" actions={<a href={url} target="_blank" rel="noreferrer"><button className="secondary">Open page ↗</button></a>}>
    <div className="panel"><h2>Page address</h2>
      <div className="formgrid"><Field label={`Address — ${url}`}><input value={v.slug} onChange={e => setF({ ...v, slug: e.target.value.toLowerCase() })} /></Field>
        <label className="switch"><input type="checkbox" checked={v.published} onChange={e => setF({ ...v, published: e.target.checked })} /> Page is published</label></div>
      <p className="muted">Share this link on posters and social media. Letters, numbers and hyphens only.</p></div>
    <div className="panel"><h2>Contact details</h2><div className="formgrid"><Field label="Phone"><input value={v.phone || ''} onChange={e => setF({ ...v, phone: e.target.value })} /></Field><Field label="Address"><input value={v.address || ''} onChange={e => setF({ ...v, address: e.target.value })} /></Field>
      <Field label="Public e-mail"><input type="email" value={c.email} onChange={e => setC({ email: e.target.value })} /></Field><Field label="Study hours text"><input value={c.studyHours} onChange={e => setC({ studyHours: e.target.value })} /></Field></div></div>
    <div className="panel"><h2>Hero & about</h2><div className="formgrid"><Field label="Badge"><input value={c.badge} onChange={e => setC({ badge: e.target.value })} /></Field><Field label="Headline (each sentence goes on a new line)"><input value={c.heroTitle} onChange={e => setC({ heroTitle: e.target.value })} /></Field></div>
      <Field label="Intro text"><textarea rows={2} value={c.heroText} onChange={e => setC({ heroText: e.target.value })} /></Field><Field label="About heading"><input value={c.aboutTitle} onChange={e => setC({ aboutTitle: e.target.value })} /></Field>
      <Field label="About text"><textarea rows={4} value={c.aboutText} onChange={e => setC({ aboutText: e.target.value })} /></Field><Field label="Highlights (one per line)"><textarea rows={5} value={c.aboutPoints.join('\n')} onChange={e => setC({ aboutPoints: e.target.value.split('\n') })} /></Field></div>
    <div className="panel"><h2>Numbers (max 4)</h2>{c.stats.map((s: any, i: number) => <div className="btnrow" key={i}><input style={{ width: 110 }} value={s.number} onChange={e => list('stats', i, { number: e.target.value })} /><input value={s.label} onChange={e => list('stats', i, { label: e.target.value })} /><button type="button" className="secondary" onClick={() => setC({ stats: c.stats.filter((_: any, j: number) => j !== i) })}>✕</button></div>)}
      {c.stats.length < 4 && <button type="button" className="secondary" onClick={() => setC({ stats: [...c.stats, { number: '100+', label: 'Label' }] })}>+ Add number</button>}</div>
    <div className="panel"><h2>Facilities</h2>{c.facilities.map((x: any, i: number) => <div className="btnrow" key={i}><input style={{ width: 70 }} value={x.icon} onChange={e => list('facilities', i, { icon: e.target.value })} /><input value={x.title} onChange={e => list('facilities', i, { title: e.target.value })} /><input value={x.text} onChange={e => list('facilities', i, { text: e.target.value })} /><button type="button" className="secondary" onClick={() => setC({ facilities: c.facilities.filter((_: any, j: number) => j !== i) })}>✕</button></div>)}
      {c.facilities.length < 12 && <button type="button" className="secondary" onClick={() => setC({ facilities: [...c.facilities, { icon: '✔', title: 'New facility', text: '' }] })}>+ Add facility</button>}</div>
    <div className="panel"><h2>Success stories</h2><p className="muted">Only add students who agreed to be shown. Leave empty to hide this section.</p>{c.achievers.map((x: any, i: number) => <div className="btnrow" key={i}><input placeholder="Name" value={x.name} onChange={e => list('achievers', i, { name: e.target.value })} /><input placeholder="Exam" value={x.exam} onChange={e => list('achievers', i, { exam: e.target.value })} /><input placeholder="Post" value={x.post} onChange={e => list('achievers', i, { post: e.target.value })} /><input style={{ width: 90 }} placeholder="Year" value={x.year} onChange={e => list('achievers', i, { year: e.target.value })} /><button type="button" className="secondary" onClick={() => setC({ achievers: c.achievers.filter((_: any, j: number) => j !== i) })}>✕</button></div>)}
      {c.achievers.length < 12 && <button type="button" className="secondary" onClick={() => setC({ achievers: [...c.achievers, { name: '', exam: '', post: '', year: String(new Date().getFullYear()) }] })}>+ Add student</button>}</div>
    <Msg m={a.msg} /><button disabled={a.busy} onClick={save}>Save website</button>
  </Page>;
}

export function Enquiries() {
  const enq = useLoad<any[]>(() => api.get('/library/enquiries').then(r => r.data), [], 30000);
  const fbk = useLoad<any[]>(() => api.get('/library/feedback').then(r => r.data), [], 30000);
  const a = useAction();
  return <Page title="Enquiries & feedback"><Msg m={a.msg} />
    <div className="panel tablewrap"><h2>Enquiries from your public page</h2>{enq.data?.length ? <table><thead><tr><th>When</th><th>Name</th><th>Contact</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>{enq.data.map(x => <tr key={x.id}><td>{dt(x.createdAt)}</td><td>{x.name}<br /><small className="muted">{x.person}</small></td><td><a href={`tel:${x.mobile}`}>{x.mobile}</a><br />{x.email}</td><td style={{ maxWidth: 320 }}>{x.message}</td><td><Badge v={x.status} /></td>
      <td className="btnrow"><select value={x.status} onChange={async e => { await a.run(() => api.patch(`/library/enquiries/${x.id}`, { status: e.target.value }), 'Updated'); enq.reload(); }}><option>NEW</option><option>CONTACTED</option><option>CLOSED</option></select><button className="secondary" onClick={async () => { if (confirm('Delete this enquiry?')) { await api.delete(`/library/enquiries/${x.id}`); enq.reload(); } }}>Delete</button></td></tr>)}</tbody></table> : <Empty text="No enquiries yet." />}</div>
    <div className="panel tablewrap"><h2>Feedback</h2><p className="muted">Approve feedback to show it on your public page.</p>{fbk.data?.length ? <table><tbody>{fbk.data.map(x => <tr key={x.id}><td>{'★'.repeat(x.rating)}{'☆'.repeat(5 - x.rating)}</td><td>{x.name}</td><td style={{ maxWidth: 360 }}>{x.message}</td><td><Badge v={x.approved ? 'APPROVED' : 'PENDING'} /></td>
      <td className="btnrow"><button onClick={async () => { await a.run(() => api.patch(`/library/feedback/${x.id}`, { approved: !x.approved }), x.approved ? 'Hidden from page' : 'Now shown on your page'); fbk.reload(); }}>{x.approved ? 'Hide' : 'Approve'}</button><button className="secondary" onClick={async () => { if (confirm('Delete?')) { await api.delete(`/library/feedback/${x.id}`); fbk.reload(); } }}>Delete</button></td></tr>)}</tbody></table> : <Empty text="No feedback yet." />}</div>
  </Page>;
}
