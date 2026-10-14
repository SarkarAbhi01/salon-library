import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../lib/ui';

const home = (role: string) => (role === 'STUDENT' ? '/student' : '/');

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', r.data.token); localStorage.setItem('user', JSON.stringify(r.data.user));
      nav(home(r.data.user.role));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return <main className="auth"><form className="card" onSubmit={submit}>
    <h1>Sign in</h1><p className="muted">Owner & admin login</p>
    {err && <div className="error">{err}</div>}
    <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    <button disabled={busy}>{busy ? 'Signing in…' : 'Login'}</button>
    <Link to="/forgot">Forgot password?</Link>
  </form></main>;
}

export function Forgot() {
  const [email, setEmail] = useState(''), [msg, setMsg] = useState('');
  return <main className="auth"><form className="card" onSubmit={async e => { e.preventDefault(); try { setMsg((await api.post('/auth/forgot-password', { email })).data.message); } catch (e) { setMsg(errMsg(e)); } }}>
    <h2>Forgot password</h2><input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
    <button>Send reset request</button>{msg && <p>{msg}</p>}<Link to="/reset">I have a reset token</Link><Link to="/login">Back to login</Link>
  </form></main>;
}

export function Reset() {
  const [sp] = useSearchParams();
  const [token, setToken] = useState(sp.get('token') || ''), [password, setPassword] = useState(''), [msg, setMsg] = useState('');
  return <main className="auth"><form className="card" onSubmit={async e => { e.preventDefault(); try { setMsg((await api.post('/auth/reset-password', { token, password })).data.message); } catch (e) { setMsg(errMsg(e)); } }}>
    <h2>Reset password</h2><input placeholder="Reset token" value={token} onChange={e => setToken(e.target.value)} required />
    <input type="password" placeholder="New password (min 8)" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required />
    <button>Reset</button>{msg && <p>{msg}</p>}<Link to="/login">Back to login</Link>
  </form></main>;
}

/** Which library a student page is for: the link they came from (?library=) or the one they used last. Only if neither is known do we ask. */
function useLibraryChoice(initial: string) {
  const [libraryId, setLib] = useState(initial);
  const [lib, setLibInfo] = useState<{ id: string; name: string } | null>(null), [libs, setLibs] = useState<any[]>([]);
  useEffect(() => {
    if (libraryId) { api.get('/public/libraries').then(r => setLibInfo((r.data as any[]).find(l => l.id === libraryId) || null)).catch(() => {}); return; }
    api.get('/public/libraries').then(r => { setLibs(r.data); if (r.data.length === 1) setLib(r.data[0].id); }).catch(() => {});
  }, [libraryId]);
  return { libraryId, setLib, lib, libs, locked: !!initial };
}

export function StudentLogin() {
  const nav = useNavigate(), [sp] = useSearchParams();
  const pre = sp.get('library') || localStorage.getItem('lastLibrary') || '';
  const { libraryId, setLib, lib, libs, locked } = useLibraryChoice(pre);
  const [identifier, setId] = useState(''), [password, setPw] = useState(''), [err, setErr] = useState('');
  return <main className="auth"><form className="card" onSubmit={async e => {
    e.preventDefault(); setErr('');
    try {
      const r = await api.post('/student-auth/login', { libraryId, identifier, password });
      localStorage.setItem('token', r.data.token); localStorage.setItem('user', JSON.stringify(r.data.user)); localStorage.setItem('lastLibrary', libraryId);
      nav('/student');
    } catch (e) { setErr(errMsg(e)); }
  }}>
    <h1>Student login</h1>{err && <div className="error">{err}</div>}
    {locked && lib ? <p className="muted">{lib.name}</p>
      : !locked && libs.length > 1 ? <label>Library<select value={libraryId} onChange={e => setLib(e.target.value)} required><option value="">Select your library…</option>{libs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : null}
    <label>Email or card number<input value={identifier} onChange={e => setId(e.target.value)} required /></label>
    <label>Password<input type="password" value={password} onChange={e => setPw(e.target.value)} required /></label>
    <button disabled={!libraryId}>Login</button><Link to={`/student/register${libraryId ? `?library=${libraryId}` : ''}`}>New student? Register</Link>
  </form></main>;
}

export function StudentRegister() {
  const nav = useNavigate(), [sp] = useSearchParams();
  const pre = sp.get('library') || localStorage.getItem('lastLibrary') || '';
  const { libraryId, setLib, lib, libs, locked } = useLibraryChoice(pre);
  const [f, setF] = useState<any>({ name: '', email: '', phone: '', password: '', examGoal: '' }), [err, setErr] = useState(''), [done, setDone] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  if (done) return <main className="auth"><div className="card"><h2>Registered ✔</h2><p>Your library card number is <b>{done}</b>. You can log in with your email or this number.</p><button onClick={() => nav(`/student/login${libraryId ? `?library=${libraryId}` : ''}`)}>Go to login</button></div></main>;
  return <main className="auth"><form className="card" onSubmit={async e => {
    e.preventDefault(); setErr('');
    try { const r = await api.post('/student-auth/register', { ...f, libraryId, phone: f.phone || undefined, examGoal: f.examGoal || undefined }); localStorage.setItem('lastLibrary', libraryId); setDone(r.data.cardNo); } catch (e) { setErr(errMsg(e)); }
  }}>
    <h1>Student registration</h1>{err && <div className="error">{err}</div>}
    {locked && lib ? <p className="muted">{lib.name}</p>
      : !locked && libs.length > 1 ? <label>Library<select value={libraryId} onChange={e => setLib(e.target.value)} required><option value="">Select your library…</option>{libs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : null}
    <label>Full name<input value={f.name} onChange={set('name')} required minLength={2} /></label>
    <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
    <label>Phone<input value={f.phone} onChange={set('phone')} minLength={6} /></label>
    <label>Preparing for (optional)<input value={f.examGoal} onChange={set('examGoal')} /></label>
    <label>Password (min 8)<input type="password" value={f.password} onChange={set('password')} required minLength={8} /></label>
    <button disabled={!libraryId}>Register</button><Link to={`/student/login${libraryId ? `?library=${libraryId}` : ''}`}>Already registered? Login</Link>
  </form></main>;
}
