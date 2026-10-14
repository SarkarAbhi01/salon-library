import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/ui';
import PublicLibrary from './publicLibrary';
import PublicSalon from './publicSalon';

/**
 * /<address> — one address space for every client. We first ask what kind of business owns the address,
 * then render only that business's own page, so a salon page never shows library data and vice-versa.
 */
export default function PublicSite() {
  const { slug } = useParams();
  const [type, setType] = useState<'SALON' | 'LIBRARY' | null | undefined>(undefined);
  useEffect(() => { setType(undefined); api.get(`/public/site/${slug}`).then(r => setType(r.data.type)).catch(() => setType(null)); }, [slug]);
  if (type === undefined) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#68738a' }}>Loading…</div>;
  if (type === 'SALON') return <PublicSalon slug={slug!} />;
  if (type === 'LIBRARY') return <PublicLibrary />;
  return <main className="auth"><div className="card center"><h1>Page not found</h1><p className="muted">This address does not exist or is not available right now.</p></div></main>;
}
