import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../public-library.css';
import { api, errMsg, inr } from '../lib/ui';

/** Public landing page for a library, served at /<slug>. Content is edited by the library owner under "Website". */
export default function PublicLibrary() {
  const { slug } = useParams();
  const [site, setSite] = useState<any>();
  const [missing, setMissing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [top, setTop] = useState(false);
  const [enq, setEnq] = useState({ name: '', mobile: '', email: '', person: 'Student', message: '', hp: '' });
  const [fb, setFb] = useState({ name: '', rating: '', message: '', hp: '' });
  const [enqMsg, setEnqMsg] = useState<{ ok: boolean; t: string } | null>(null), [fbMsg, setFbMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api.get(`/public/library-site/${slug}`).then(r => { setSite(r.data); document.title = `${r.data.name} | Focus. Prepare. Succeed.`; }).catch(() => setMissing(true));
  }, [slug]);
  useEffect(() => { const f = () => setTop(window.scrollY > 500); window.addEventListener('scroll', f); return () => window.removeEventListener('scroll', f); }, []);

  if (missing) return <div className="plib"><div className="notfound"><h1>Page not found</h1><p>This library page does not exist or is not published.</p><p><Link to="/login">Owner login</Link> · <Link to="/student/login">Student login</Link></p></div></div>;
  if (!site) return <div className="plib"><div className="notfound"><p>Loading…</p></div></div>;

  const c = site.content;
  const close = () => setMenu(false);
  async function send(kind: 'enquiries' | 'feedback') {
    setBusy(kind);
    try {
      if (kind === 'enquiries') { await api.post(`/public/library-site/${slug}/enquiries`, { ...enq, email: enq.email || undefined }); setEnqMsg({ ok: true, t: '✓ Thank you! Your enquiry has been received. We will contact you soon.' }); setEnq({ name: '', mobile: '', email: '', person: 'Student', message: '', hp: '' }); }
      else { await api.post(`/public/library-site/${slug}/feedback`, { ...fb, rating: Number(fb.rating) }); setFbMsg({ ok: true, t: '✓ Thank you for your valuable feedback!' }); setFb({ name: '', rating: '', message: '', hp: '' }); }
    } catch (e) { (kind === 'enquiries' ? setEnqMsg : setFbMsg)({ ok: false, t: errMsg(e) }); } finally { setBusy(''); }
  }
  const heroLines = String(c.heroTitle).split(/(?<=\.)\s+/);

  return <div className="plib">
    <header><div className="container navbar">
      <a href="#home" className="logo">📚 {site.name.toUpperCase()}</a>
      <button className="menu-btn" onClick={() => setMenu(!menu)}>☰</button>
      <ul className={`nav-links ${menu ? 'show' : ''}`}>
        {[['home', 'Home'], ['about', 'About'], ['facilities', 'Facilities'], ...(site.plans.length ? [['plans', 'Plans']] : []), ...(c.achievers.length ? [['success', 'Success']] : []), ['enquiry', 'Enquiry'], ['feedback', 'Feedback'], ['contact', 'Contact']].map(([id, l]) => <li key={id}><a href={`#${id}`} onClick={close}>{l}</a></li>)}
        <li><Link className="cta-link" to={`/student/login?library=${site.id}`}>Student Login</Link></li>
      </ul></div></header>

    <section className="hero" id="home"><div className="container"><div className="hero-content">
      <span className="hero-badge">{c.badge}</span>
      <h1>{heroLines.map((l: string, i: number) => <span key={i}>{l}{i < heroLines.length - 1 && <br />}</span>)}</h1>
      <p>{c.heroText}</p>
      <div className="buttons"><a href="#enquiry" className="btn btn-primary">Enquire Now</a><Link to={`/student/register?library=${site.id}`} className="btn btn-outline">Register as Student</Link></div>
    </div></div></section>

    {!!c.stats.length && <div className="stats"><div className="container"><div className="stats-grid">{c.stats.map((s: any, i: number) => <div className="stat-card" key={i}><div className="stat-number">{s.number}</div><div className="stat-label">{s.label}</div></div>)}</div></div></div>}

    <section id="about"><div className="container"><div className="about-grid"><div className="about-image" /><div className="about">
      <span>ABOUT OUR LIBRARY</span><h2>{c.aboutTitle}</h2>{String(c.aboutText).split(/\n+/).map((p: string, i: number) => <p key={i}>{p}</p>)}
      <ul className="check-list">{c.aboutPoints.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul></div></div></div></section>

    <section className="light" id="facilities"><div className="container">
      <div className="section-heading"><span>OUR FACILITIES</span><h2>Everything For Better Preparation</h2><p>Facilities designed to make long study sessions comfortable and productive.</p></div>
      <div className="facility-grid">{c.facilities.map((f: any, i: number) => <div className="facility" key={i}><div className="facility-icon">{f.icon}</div><h3>{f.title}</h3><p>{f.text}</p></div>)}</div></div></section>

    {!!site.plans.length && <section id="plans"><div className="container"><div className="section-heading"><span>MEMBERSHIP</span><h2>Plans & Pricing</h2><p>Choose a plan and book your seat online after registering.</p></div>
      <div className="plan-grid">{site.plans.map((p: any) => <div className="plan" key={p.id}><h3>{p.name}</h3><b>{inr(p.priceCents)}</b><p>{p.months} month{p.months > 1 ? 's' : ''}</p><p>{p.description}</p></div>)}</div>
      <div className="center" style={{ marginTop: 30 }}><Link to={`/student/register?library=${site.id}`} className="btn btn-primary">Register &amp; Choose a Plan</Link></div></div></section>}

    {!!c.achievers.length && <section className="light" id="success"><div className="container">
      <div className="section-heading"><span>STUDENT SUCCESS</span><h2>Our Students, Our Pride</h2><p>A few of our successful students who achieved their competitive examination or government job goals.</p></div>
      <div className="achiever-grid">{c.achievers.map((a: any, i: number) => <div className="achiever" key={i}><div className="achiever-photo">{i % 2 ? '👩‍🎓' : '👨‍🎓'}</div><div className="achiever-body"><span className="badge">✓ SELECTED</span><h3>{a.name}</h3>{a.exam && <p><strong>Exam:</strong> {a.exam}</p>}{a.post && <p><strong>Post:</strong> {a.post}</p>}{a.year && <p><strong>Year:</strong> {a.year}</p>}</div></div>)}</div></div></section>}

    {!!site.feedback.length && <section className="light"><div className="container"><div className="section-heading"><span>STUDENT FEEDBACK</span><h2>What Students Say</h2></div>
      <div className="testimonial-grid">{site.feedback.map((f: any) => <div className="testimonial" key={f.id}><div className="stars">{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</div><p>"{f.message}"</p><strong>— {f.name}</strong></div>)}</div></div></section>}

    <section id="enquiry"><div className="container"><div className="section-heading"><span>ENQUIRY</span><h2>Have a Question?</h2><p>Send us your enquiry and our team can contact you.</p></div>
      <div className="form-wrapper"><form onSubmit={e => { e.preventDefault(); setEnqMsg(null); send('enquiries'); }}><div className="form-grid">
        <div className="form-group"><label>Full Name *</label><input required minLength={2} value={enq.name} onChange={e => setEnq({ ...enq, name: e.target.value })} placeholder="Enter your name" /></div>
        <div className="form-group"><label>Mobile Number *</label><input type="tel" required maxLength={10} pattern="[0-9]{10}" value={enq.mobile} onChange={e => setEnq({ ...enq, mobile: e.target.value.replace(/\D/g, '') })} placeholder="10 digit mobile number" /></div>
        <div className="form-group"><label>Email</label><input type="email" value={enq.email} onChange={e => setEnq({ ...enq, email: e.target.value })} placeholder="Email address" /></div>
        <div className="form-group"><label>I am</label><select value={enq.person} onChange={e => setEnq({ ...enq, person: e.target.value })}><option>Student</option><option>Parent / Guardian</option><option>Other</option></select></div>
        <div className="form-group full"><label>Your Enquiry *</label><textarea required minLength={5} value={enq.message} onChange={e => setEnq({ ...enq, message: e.target.value })} placeholder="Write your enquiry..." /></div>
        <input className="hp" tabIndex={-1} autoComplete="off" value={enq.hp} onChange={e => setEnq({ ...enq, hp: e.target.value })} aria-hidden />
        <div className="form-group full"><button className="btn btn-primary" disabled={busy === 'enquiries'}>{busy === 'enquiries' ? 'Sending…' : 'Submit Enquiry'}</button></div></div></form>
        {enqMsg && <div className={enqMsg.ok ? 'success-message show' : 'error-message'}>{enqMsg.t}</div>}</div></div></section>

    <section className="light" id="feedback"><div className="container"><div className="section-heading"><span>FEEDBACK</span><h2>Share Your Experience</h2><p>Your feedback helps us improve the library experience.</p></div>
      <div className="form-wrapper"><form onSubmit={e => { e.preventDefault(); setFbMsg(null); send('feedback'); }}><div className="form-grid">
        <div className="form-group"><label>Your Name *</label><input required minLength={2} value={fb.name} onChange={e => setFb({ ...fb, name: e.target.value })} placeholder="Enter your name" /></div>
        <div className="form-group"><label>Rating *</label><select required value={fb.rating} onChange={e => setFb({ ...fb, rating: e.target.value })}><option value="">Select Rating</option><option value="5">★★★★★ Excellent</option><option value="4">★★★★☆ Very Good</option><option value="3">★★★☆☆ Good</option><option value="2">★★☆☆☆ Average</option><option value="1">★☆☆☆☆ Needs Improvement</option></select></div>
        <div className="form-group full"><label>Feedback *</label><textarea required minLength={5} value={fb.message} onChange={e => setFb({ ...fb, message: e.target.value })} placeholder="Write your feedback..." /></div>
        <input className="hp" tabIndex={-1} autoComplete="off" value={fb.hp} onChange={e => setFb({ ...fb, hp: e.target.value })} aria-hidden />
        <div className="form-group full"><button className="btn btn-primary" disabled={busy === 'feedback'}>{busy === 'feedback' ? 'Sending…' : 'Submit Feedback'}</button></div></div></form>
        {fbMsg && <div className={fbMsg.ok ? 'success-message show' : 'error-message'}>{fbMsg.t}</div>}</div></div></section>

    <section id="contact"><div className="container"><div className="section-heading"><span>CONTACT</span><h2>Visit Our Library</h2></div>
      <div className="contact-grid">
        <div className="contact-card"><div className="contact-icon">📍</div><h3>Address</h3><p>{site.address || 'Address not added yet'}</p></div>
        <div className="contact-card"><div className="contact-icon">📞</div><h3>Phone</h3><p>{site.phone ? <a href={`tel:${site.phone}`}>{site.phone}</a> : '—'}</p></div>
        <div className="contact-card"><div className="contact-icon">🕐</div><h3>Study Hours</h3><p>{c.studyHours}</p></div></div></div></section>

    <section className="cta"><div className="container"><h2>Ready to Start Your Preparation?</h2><p>Take the first step towards a disciplined study routine.</p><a href="#enquiry" className="btn btn-primary">Enquire Now</a></div></section>

    <footer><div className="container"><div className="footer-grid">
      <div><h3>📚 {site.name.toUpperCase()}</h3><p>A focused and student-friendly study environment for academic and competitive examination preparation.</p></div>
      <div><h3>Quick Links</h3><a href="#home">Home</a><a href="#about">About</a><a href="#facilities">Facilities</a><Link to={`/student/login?library=${site.id}`}>Student Login</Link></div>
      <div><h3>Contact</h3>{site.address && <p>📍 {site.address}</p>}{site.phone && <p>📞 {site.phone}</p>}{c.email && <p>✉️ {c.email}</p>}</div></div>
      <div className="copyright">© {new Date().getFullYear()} {site.name}. All Rights Reserved.</div></div></footer>
    {top && <button id="topBtn" style={{ display: 'block' }} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑</button>}
  </div>;
}
