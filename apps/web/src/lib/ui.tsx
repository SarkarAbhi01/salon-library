import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';

export type U = { id: string; email?: string; name: string; role: 'SUPER_ADMIN' | 'OWNER' | 'STUDENT'; tenant?: { id: string; type: 'SALON' | 'LIBRARY'; name: string } };
export const getUser = (): U => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {} as U; } };

export const inr = (c?: number | null) => (c == null ? '—' : '₹' + (c / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
export const dt = (s?: string | Date | null) => (s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const dOnly = (s?: string | Date | null) => (s ? new Date(s).toLocaleDateString([], { dateStyle: 'medium' }) : '—');
export const tOnly = (s: string | Date) => new Date(s).toLocaleTimeString([], { timeStyle: 'short' });
export const errMsg = (e: any) => e?.response?.data?.error || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the API. Is the backend running on port 4000?' : e?.message) || 'Something went wrong';
export const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
export const pad = (n: number) => String(n).padStart(2, '0');
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** value for <input type="datetime-local"> in the browser's local time */
export const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const todayStr = () => toLocalInput(new Date()).slice(0, 10);
export const rupeesToCents = (v: string | number) => Math.round(Number(v) * 100);

/** Loads data, supports reload and optional polling. Errors are surfaced instead of swallowed. */
export function useLoad<T>(fn: () => Promise<T>, deps: any[] = [], pollMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(async () => {
    try { setData(await fnRef.current()); setError(''); } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { setLoading(true); reload(); }, deps); // eslint-disable-line
  useEffect(() => { if (!pollMs) return; const t = setInterval(reload, pollMs); return () => clearInterval(t); }, [pollMs, reload]);
  return { data, error, loading, reload, setData };
}

/** Runs an async action, shows success/error text. */
export function useAction() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, okText = 'Saved'): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); setMsg({ ok: true, text: okText }); return r; } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };
  return { msg, run, busy, clear: () => setMsg(null) };
}

export const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <div className={m.ok ? 'okbox' : 'error'}>{m.text}</div> : null);
export const Page = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <div className="page"><div className="pagehead"><h1>{title}</h1>{actions}</div>{children}</div>
);
export const Loading = ({ error, retry }: { error?: string; retry?: () => void }) => error
  ? <div className="panel"><div className="error">{error}</div>{retry && <button onClick={retry}>Retry</button>}</div> : <div className="loading">Loading…</div>;
export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;
export const Badge = ({ v }: { v: string }) => <span className={`badge b-${v.toLowerCase()}`}>{v.replaceAll('_', ' ')}</span>;
export const Stat = ({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) => <div className="stat"><span>{k.replaceAll('_', ' ')}</span><b>{v}</b>{hint && <small className="muted">{hint}</small>}</div>;
export const Empty = ({ text }: { text: string }) => <p className="muted">{text}</p>;
export const Progress = ({ value, max }: { value: number; max: number }) => <div className="bar"><i style={{ width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} /></div>;

export function printHtml(title: string, body: string) {
  const w = window.open('', '_blank', 'width=800,height=900');
  if (!w) { alert('Allow pop-ups to print'); return; }
  w.document.write(`<!doctype html><title>${title}</title><style>body{font-family:system-ui,Arial;padding:32px;color:#172033}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.r{text-align:right}</style>${body}<script>window.onload=()=>window.print()<\/script>`);
  w.document.close();
}
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function printInvoice(p: any) {
  const what = p.kind === 'FINE' ? `Late-return fine — ${esc(p.issue?.book?.title)}` : `Library membership — ${esc(p.membership?.plan?.name || p.membership?.months + ' month(s)')}`;
  printHtml(`Invoice ${p.invoiceNo}`, `<h2>${esc(p.tenant.name)}</h2><p>${esc(p.tenant.address || '')} ${esc(p.tenant.phone || '')}</p><h3>${p.refundedCents ? 'Receipt' : 'Invoice'} ${esc(p.invoiceNo)}</h3>
  <p>Date: ${dOnly(p.paidAt)}<br>Student: ${esc(p.student.name)} (${esc(p.student.cardNo)})</p>
  <table><tr><th>Description</th><th class="r">Amount</th></tr><tr><td>${what}</td><td class="r">${inr(p.amountCents)}</td></tr>
  ${p.refundedCents ? `<tr><td>Refunded${p.refundReason ? ' — ' + esc(p.refundReason) : ''}</td><td class="r">−${inr(p.refundedCents)}</td></tr>` : ''}
  <tr><th>Net paid (${esc(p.method)})</th><th class="r">${inr(p.amountCents - p.refundedCents)}</th></tr></table>`);
}

export { api };
