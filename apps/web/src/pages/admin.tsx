import { useState } from 'react';
import { api, Page, Loading, Field, Msg, useAction, useLoad, Badge, dt, inr } from '../lib/ui';

export function Tenants() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/admin/tenants').then(r => r.data));
  const plans = useLoad<any[]>(() => api.get('/admin/plans').then(r => r.data));
  const [f, setF] = useState<any>({ type: 'SALON', name: '', ownerName: '', email: '', password: '', phone: '', trialDays: 14 });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Page title="Salon / Library clients">
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/admin/tenants', { ...f, phone: f.phone || undefined, trialDays: Number(f.trialDays) }), 'Client created')) { setF({ ...f, name: '', ownerName: '', email: '', password: '', phone: '' }); reload(); } }}>
      <h2>Create owner + client</h2>
      <div className="formgrid">
        <Field label="Type"><select value={f.type} onChange={set('type')}><option>SALON</option><option>LIBRARY</option></select></Field>
        <Field label="Business name"><input value={f.name} onChange={set('name')} required minLength={2} /></Field>
        <Field label="Owner name"><input value={f.ownerName} onChange={set('ownerName')} required minLength={2} /></Field>
        <Field label="Owner email"><input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Initial password (min 8)"><input type="text" value={f.password} onChange={set('password')} required minLength={8} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Trial days"><input type="number" min={0} max={365} value={f.trialDays} onChange={set('trialDays')} /></Field>
      </div>
      <Msg m={a.msg} /><button disabled={a.busy}>Create client</button>
    </form>
    <div className="panel"><h2>Theme menu for libraries</h2>
      <p className="muted">When ON, that library owner sees a <b>Theme</b> menu and can choose colours (fixed, or changing every month / season / year). When OFF the menu disappears and the library goes back to the default look.</p>
      <div className="btnrow"><button onClick={async () => { await a.run(() => api.patch('/admin/theme-access', { enabled: true }), 'Theme menu ON for all libraries'); reload(); }}>Turn ON for all libraries</button>
        <button className="secondary" onClick={async () => { await a.run(() => api.patch('/admin/theme-access', { enabled: false }), 'Theme menu OFF for all libraries'); reload(); }}>Turn OFF for all libraries</button></div></div>
    {!data ? <Loading error={error} retry={reload} /> : <div className="panel tablewrap"><table>
      <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Status</th><th>Plan</th><th>Trial ends</th><th>Theme menu</th><th>Actions</th></tr></thead>
      <tbody>{data.map(t => <tr key={t.id}>
        <td>{t.name}{t.slug && <><br /><small className="muted">/{t.slug}</small></>}</td><td>{t.type}</td><td>{t.owner?.email}</td><td><Badge v={t.status} /></td>
        <td><select value={t.subscription?.planId || ''} onChange={async e => { if (e.target.value) { await a.run(() => api.post(`/admin/tenants/${t.id}/subscription`, { planId: e.target.value }), 'Plan assigned'); reload(); } }}>
          <option value="">— none —</option>{plans.data?.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
        <td>{t.trialEndsAt ? dt(t.trialEndsAt) : '—'}</td>
        <td>{t.type === 'LIBRARY'
          ? <label className="switch"><input type="checkbox" checked={!!t.themeEnabled} onChange={async e => { await a.run(() => api.patch(`/admin/tenants/${t.id}/theme-access`, { enabled: e.target.checked }), e.target.checked ? 'Theme menu turned ON' : 'Theme menu turned OFF'); reload(); }} />{t.themeEnabled ? 'ON' : 'off'}</label>
          : <span className="muted">—</span>}</td>
        <td className="btnrow">
          <button onClick={async () => { const status = t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'; await a.run(() => api.patch(`/admin/tenants/${t.id}/status`, { status, enabled: status === 'ACTIVE' }), `Client ${status.toLowerCase()}`); reload(); }}>{t.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button>
          <button className="secondary" onClick={async () => { const password = prompt('New owner password (min 8 characters)'); if (password) await a.run(() => api.post(`/admin/tenants/${t.id}/reset-owner-password`, { password }), 'Owner password reset'); }}>Reset password</button>
        </td></tr>)}</tbody></table></div>}
  </Page>;
}

export function Plans() {
  const { data, error, reload } = useLoad<any[]>(() => api.get('/admin/plans').then(r => r.data));
  const [f, setF] = useState<any>({ name: '', priceRupees: 999, billing: 'MONTHLY', commissionPct: 5, trialDays: 14 });
  const a = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return <Page title="Subscription plans">
    <form className="panel" onSubmit={async e => { e.preventDefault(); if (await a.run(() => api.post('/admin/plans', { name: f.name, billing: f.billing, priceCents: Math.round(Number(f.priceRupees) * 100), commissionPct: f.billing === 'COMMISSION' ? Number(f.commissionPct) : undefined, trialDays: Number(f.trialDays) }), 'Plan created')) { setF({ ...f, name: '' }); reload(); } }}>
      <div className="formgrid">
        <Field label="Plan name"><input value={f.name} onChange={set('name')} required minLength={2} /></Field>
        <Field label="Billing"><select value={f.billing} onChange={set('billing')}><option>MONTHLY</option><option>COMMISSION</option></select></Field>
        <Field label="Monthly price (₹)"><input type="number" min={0} value={f.priceRupees} onChange={set('priceRupees')} /></Field>
        {f.billing === 'COMMISSION' && <Field label="Commission %"><input type="number" min={0} max={100} step="0.1" value={f.commissionPct} onChange={set('commissionPct')} /></Field>}
        <Field label="Trial days"><input type="number" min={0} value={f.trialDays} onChange={set('trialDays')} /></Field>
      </div><Msg m={a.msg} /><button>Add plan</button>
    </form>
    {!data ? <Loading error={error} /> : <div className="grid">{data.map(p => <div className="stat" key={p.id}><b>{p.name}</b><span>{p.billing}{p.commissionPct != null ? ` · ${p.commissionPct}%` : ''}</span><span>{inr(p.priceCents)} · trial {p.trialDays}d</span>
      <button className="secondary" onClick={async () => { await a.run(() => api.patch(`/admin/plans/${p.id}`, { active: !p.active }), 'Updated'); reload(); }}>{p.active ? 'Deactivate' : 'Activate'}</button></div>)}</div>}
  </Page>;
}

export function Maintenance() {
  const rows = useLoad<any[]>(() => api.get('/admin/maintenance').then(r => r.data));
  const tenants = useLoad<any[]>(() => api.get('/admin/tenants').then(r => r.data));
  const [message, setMessage] = useState('We are upgrading the system. Please try again shortly.');
  const [tenantId, setTenantId] = useState('');
  const a = useAction();
  const isOn = (id: string | null) => !!rows.data?.find(r => r.tenantId === id)?.enabled;
  const toggle = async (id: string | null) => { await a.run(() => api.patch('/admin/maintenance', { enabled: !isOn(id), tenantId: id, message }), 'Maintenance updated'); rows.reload(); };
  if (!rows.data) return <Loading error={rows.error} />;
  return <Page title="Maintenance mode">
    <div className="panel"><Field label="Message shown to users"><input value={message} onChange={e => setMessage(e.target.value)} /></Field><Msg m={a.msg} />
      <div className="row"><span><b>All clients</b> — {isOn(null) ? 'ON (owners and students are blocked)' : 'off'}</span><button onClick={() => toggle(null)}>{isOn(null) ? 'Turn off' : 'Turn on'}</button></div>
      <div className="row"><select value={tenantId} onChange={e => setTenantId(e.target.value)}><option value="">Select a client…</option>{tenants.data?.map(t => <option key={t.id} value={t.id}>{t.name} {isOn(t.id) ? '(ON)' : ''}</option>)}</select>
        <button disabled={!tenantId} onClick={() => toggle(tenantId)}>{isOn(tenantId) ? 'Turn off' : 'Turn on'} for this client</button></div></div>
  </Page>;
}
