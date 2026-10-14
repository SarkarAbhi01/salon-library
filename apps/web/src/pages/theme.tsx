import { useEffect, useState } from 'react';
import { api, Page, Loading, Msg, useAction, useLoad, Empty } from '../lib/ui';
import { THEMES, THEME_MODES, resolveTheme, applyTheme, seasonOf } from '../lib/theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Library owner → Theme. The menu only exists while the SuperAdmin has the Theme option switched on for this library. */
export function ThemePage() {
  const { data, error, reload } = useLoad<{ enabled: boolean; mode: string; name: string }>(() => api.get('/tenant/theme').then(r => r.data));
  const [mode, setMode] = useState('FIXED'), [name, setName] = useState('classic');
  const a = useAction();
  useEffect(() => { if (data) { setMode(data.mode); setName(data.name); } }, [data]);
  if (!data) return <Loading error={error} retry={reload} />;
  if (!data.enabled) return <Page title="Theme"><div className="panel"><Empty text="The Theme option is turned off for your library. Ask the administrator to enable it." /></div></Page>;

  const now = new Date(), showing = resolveTheme(mode, name, now);
  const preview = (n: string) => applyTheme(n);
  const why = mode === 'MONTHLY' ? `It changes automatically every month (now: ${MONTHS[now.getMonth()]}).`
    : mode === 'SEASONAL' ? `It changes with the season (now: ${seasonOf(now.getMonth())}).`
    : mode === 'YEARLY' ? `It changes automatically every year (now: ${now.getFullYear()}).` : 'It stays the same until you change it.';

  return <Page title="Theme">
    <div className="panel">
      <h2>When should the colours change?</h2>
      <div className="tabs">{THEME_MODES.map(([m, label]) => <button key={m} type="button" className={mode === m ? '' : 'secondary'} onClick={() => { setMode(m); applyTheme(resolveTheme(m, name)); }}>{label}</button>)}</div>
      <p className="muted">Showing now: <b>{THEMES[showing].label}</b>. {why}</p>
    </div>
    <div className="panel">
      <h2>{mode === 'FIXED' ? 'Choose your theme' : 'Theme library'}</h2>
      {mode !== 'FIXED' && <p className="muted">With automatic change, the app picks the colour for each month / season / year for you. You can still preview any theme below.</p>}
      <div className="themegrid">{Object.entries(THEMES).map(([key, p]) => <button type="button" key={key} className={`themecard ${mode === 'FIXED' && name === key ? 'on' : ''}`}
        onClick={() => { setName(key); preview(key); }} onMouseEnter={() => preview(key)} onMouseLeave={() => applyTheme(resolveTheme(mode, name))}>
        <i style={{ background: `linear-gradient(135deg, ${p.side}, ${p.accent})` }} /><b>{p.label}</b>
        <small>{[p.side, p.accent, p.link, p.soft].map((c, i) => <b key={i} style={{ background: c }} />)}</small></button>)}</div>
      <Msg m={a.msg} />
      <div className="btnrow" style={{ marginTop: 14 }}>
        <button onClick={async () => { const r = await a.run(() => api.put('/tenant/theme', { mode, name }), 'Theme saved'); if (r) { window.dispatchEvent(new Event('theme-changed')); reload(); } }}>Save theme</button>
        <button className="secondary" onClick={() => { setMode(data.mode); setName(data.name); applyTheme(resolveTheme(data.mode, data.name)); }}>Undo changes</button>
      </div>
    </div>
  </Page>;
}
