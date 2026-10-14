import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import '../public-salon.css';
import { api, errMsg, inr, todayStr, rupeesToCents, dt } from '../lib/ui';
import { PushButton } from '../lib/PushButton';

/**
 * Salon home page + booking form, built from Saloon.html and connected to the real booking system.
 * Everything shown here comes from THIS salon only (name, address, phone, hours, services) — see GET /public/salon-site/:slug.
 *
 * The template also had sample offers and sample customer reviews. Those are made-up text, so they are switched off here;
 * set a flag to true if a salon really wants them (the markup is kept below).
 */
const SHOW_SAMPLE_OFFERS = false;
const SHOW_SAMPLE_REVIEWS = false;

const IMAGES = [
  'photo-1562322140-8baeececf3df', 'photo-1487412947147-5cebf100ffc2', 'photo-1570172619644-dfd03ed5d881',
  'photo-1604654894610-df63bc536371', 'photo-1516975080664-ed2fc6a32937', 'photo-1519415510236-718bdfcd89c8',
].map(id => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`);
const ABOUT_IMG = 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1000&q=85';
const SAMPLE_OFFERS = ['First Visit - 15% OFF', 'Haircut + Facial Combo'];

const t12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Loads fonts + icon font only while this page is open, so the dashboards never see them. */
function useHeadLinks(urls: string[]) {
  useEffect(() => {
    const els = urls.map(href => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); return l; });
    return () => els.forEach(l => l.remove());
  }, []); // eslint-disable-line
}

export default function PublicSalon({ slug }: { slug: string }) {
  useHeadLinks([
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
    'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap',
  ]);
  const [site, setSite] = useState<any>(), [missing, setMissing] = useState(false), [menu, setMenu] = useState(false), [top, setTop] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // booking form state
  const [serviceId, setServiceId] = useState(''), [date, setDate] = useState(todayStr()), [slot, setSlot] = useState('');
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [offer, setOffer] = useState(''), [priceOffer, setPriceOffer] = useState('');
  const [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [slots, setSlots] = useState<any>(null), [slotsBusy, setSlotsBusy] = useState(false);
  const [done, setDone] = useState<any>(null), [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get(`/public/salon-site/${slug}`).then(r => { setSite(r.data); document.title = `${r.data.name} | Premium Beauty & Style`; }).catch(() => setMissing(true));
  }, [slug]);

  // page-level behaviour that used to live on <html>/<body> in Saloon.html
  useEffect(() => {
    const h = document.documentElement, prev = { sb: h.style.scrollBehavior, sp: h.style.scrollPaddingTop, bg: document.body.style.background };
    h.style.scrollBehavior = 'smooth'; h.style.scrollPaddingTop = '80px'; document.body.style.background = '#171512';
    const onScroll = () => setTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); h.style.scrollBehavior = prev.sb; h.style.scrollPaddingTop = prev.sp; document.body.style.background = prev.bg; };
  }, []);

  // reveal-on-scroll animation
  useEffect(() => {
    if (!site || !root.current) return;
    const items = root.current.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { items.forEach(i => i.classList.add('visible')); return; }
    const io = new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); o.unobserve(e.target); } }), { threshold: 0.12 });
    items.forEach(i => io.observe(i));
    return () => io.disconnect();
  }, [site]);

  // free time slots for the chosen service + date (real availability: opening hours, closures, chairs, existing bookings)
  useEffect(() => {
    if (!site || !serviceId) { setSlots(null); return; }
    let live = true; setSlotsBusy(true); setSlot('');
    api.get(`/public/salons/${site.id}/availability`, { params: { date, serviceId } })
      .then(r => { if (live) setSlots(r.data); }).catch(() => { if (live) setSlots({ open: true, slots: [], error: true }); })
      .finally(() => { if (live) setSlotsBusy(false); });
    return () => { live = false; };
  }, [site, serviceId, date]);

  const svc = useMemo(() => site?.services.find((x: any) => x.id === serviceId), [site, serviceId]);
  const hoursRows = useMemo(() => {
    if (!site) return [];
    return [1, 2, 3, 4, 5, 6, 0].map(d => {
      const h = site.hours.find((x: any) => x.dayOfWeek === d);
      return { d, text: h && h.open && h.windows.length ? h.windows.map((w: string[]) => `${t12(w[0])} – ${t12(w[1])}`).join(', ') : 'Closed' };
    });
  }, [site]);

  if (missing) return <div className="psal"><div className="psal-center"><div><h1 className="serif">Page not found</h1><p>This salon page does not exist or is not available right now.</p></div></div></div>;
  if (!site) return <div className="psal"><div className="psal-center"><p>Loading…</p></div></div>;

  const brand: string = site.name;
  const mapQ = encodeURIComponent(site.address || brand);
  const go = () => setMenu(false);
  const pickService = (id: string) => { setServiceId(id); setDone(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!/^[6-9][0-9]{9}$/.test(phone)) return setErr('Please enter a valid 10-digit Indian mobile number.');
    if (!slot) return setErr('Please choose a time.');
    if (!agree) return setErr(`Please agree to send these details to ${brand}.`);
    setBusy(true);
    try {
      const r = await api.post(`/public/salons/${site.id}/bookings`, {
        serviceId, customerName: name.trim(), customerPhone: phone, startAt: slot,
        offeredPriceCents: priceOffer ? rupeesToCents(priceOffer) : undefined,
        notes: offer ? `Offer: ${offer}` : undefined,
      });
      localStorage.setItem('lastTrackPhone', phone);
      setDone({ ...r.data, phone });
      setTimeout(() => document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return <div className="psal" ref={root}>
    <nav className="navbar navbar-expand-lg navbar-dark sticky-top"><div className="container">
      <a className="navbar-brand" href="#home">{brand.charAt(0)} <span>{brand}.</span></a>
      <button className="navbar-toggler" type="button" aria-label="Toggle navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}><span className="navbar-toggler-icon" /></button>
      <div className={`collapse navbar-collapse ${menu ? 'show' : ''}`} id="mainNav"><ul className="navbar-nav ms-auto align-items-lg-center">
        {[['home', 'Home'], ['about', 'About'], ['services', 'Services'], ...(SHOW_SAMPLE_OFFERS ? [['offers', 'Offers']] : []), ...(SHOW_SAMPLE_REVIEWS ? [['reviews', 'Reviews']] : []), ['contact', 'Contact']].map(([id, l]) =>
          <li className="nav-item" key={id}><a className="nav-link" href={`#${id}`} onClick={go}>{l}</a></li>)}
        <li className="nav-item"><Link className="nav-link" to="/track" onClick={go}>Track booking</Link></li>
        <li className="nav-item ms-lg-3 mt-3 mt-lg-0"><a className="btn btn-gold btn-sm" href="#booking" onClick={go}>Book Appointment</a></li>
      </ul></div>
    </div></nav>

    <header className="hero" id="home"><div className="container hero-content"><div className="row"><div className="col-lg-9">
      <div className="hero-kicker"><i className="bi bi-stars me-2" />Your Beauty, Our Passion</div>
      <h1>Discover The Art<br />Of <em>Looking Your Best.</em></h1>
      <p>Aapki personality, aapka style. Experience premium hair, skin and beauty care with expert stylists who bring out the best version of you.</p>
      <div className="d-flex flex-wrap gap-3"><a href="#booking" className="btn btn-gold">Book Your Visit<i className="bi bi-arrow-right ms-2" /></a><a href="#services" className="btn btn-outline-gold">Explore Services</a></div>
      <div className="hero-trust"><span><i className="bi bi-patch-check" /> Expert Stylists</span><span><i className="bi bi-shield-check" /> Hygiene First</span><span><i className="bi bi-gem" /> Premium Care</span></div>
    </div></div></div></header>

    <section className="intro-strip"><div className="container"><div className="row g-3">
      {[['bi-scissors', 'Expert Hair Styling'], ['bi-flower1', 'Beauty & Skin Care'], ['bi-heart', 'Made For Your Confidence']].map(([ic, tx]) =>
        <div className="col-md-4" key={tx}><div className="intro-item"><i className={`bi ${ic}`} /> {tx}</div></div>)}
    </div></div></section>

    <section className="section-pad" id="about"><div className="container"><div className="row align-items-center g-5">
      <div className="col-lg-6 reveal"><div className="about-image"><img src={ABOUT_IMG} alt="Modern salon interior" loading="lazy" /><div className="image-caption"><i className="bi bi-stars me-2" /> Your Style, Our Signature</div></div></div>
      <div className="col-lg-6 reveal">
        <span className="section-label">Welcome to {brand}</span>
        <h2 className="section-title">Beauty Is Personal.<br /><span className="gold">So Is Our Care.</span></h2>
        <p className="section-desc">{brand} mein hum maante hain ki har insaan ka apna unique style hota hai. Hamara goal hai aapko quality service, relaxing experience aur aisa look dena jisme aap confident feel karein.</p>
        {[['bi-award', 'Professional Stylists', 'Personalized styling for your look and lifestyle.'], ['bi-droplet-half', 'Clean & Hygienic Care', 'Clean tools and thoughtful salon hygiene practices.'], ['bi-gem', 'Premium Experience', 'Comfort, care and attention to every detail.']].map(([ic, h, p]) =>
          <div className="about-point" key={h}><i className={`bi ${ic}`} /><div><strong>{h}</strong><small>{p}</small></div></div>)}
        <a href="#booking" className="btn btn-gold mt-3">Experience the Difference<i className="bi bi-arrow-right ms-2" /></a>
      </div>
    </div></div></section>

    <section className="section-pad services-section" id="services"><div className="container">
      <div className="text-center mb-5 reveal"><span className="section-label">Our Signature Services</span>
        <h2 className="section-title">The Art of <span className="gold">Self-Care.</span></h2>
        <p className="section-desc mx-auto">From everyday grooming to your most special occasions, discover services designed around you.</p></div>
      {site.services.length ? <div className="row g-4">{site.services.map((s: any, i: number) => <div className="col-sm-6 col-lg-4 reveal" key={s.id}><article className="service-card">
        <div className="service-img-wrap"><img src={IMAGES[i % IMAGES.length]} alt={s.name} loading="lazy" /><span className="service-number">{String(i + 1).padStart(2, '0')} / SERVICE</span></div>
        <div className="service-info"><h3>{s.name}</h3>
          <div className="service-meta">{s.durationMin} min · <span className="price-tag">{inr(s.basePriceCents)}</span>{s.flexible ? ' · offers welcome' : ''}</div>
          <a className="service-link book-service" href="#booking" onClick={() => pickService(s.id)}>BOOK THIS SERVICE <i className="bi bi-arrow-up-right" /></a></div>
      </article></div>)}</div> : <p className="text-center section-desc mx-auto">Services will be listed here soon. Please call us to book.</p>}
      <div className="text-center mt-5"><a href="#booking" className="btn btn-outline-gold" style={{ borderColor: '#b18a50', color: '#5d4728' }}>View Services &amp; Book Now<i className="bi bi-arrow-right ms-2" /></a></div>
    </div></section>

    {SHOW_SAMPLE_OFFERS && <section className="section-pad offer-section" id="offers"><div className="container">
      <div className="text-center mb-5 reveal"><span className="section-label">Exclusive Salon Offers</span><h2 className="section-title">A Little More Luxury.<br /><span className="gold">A Little More Value.</span></h2></div>
      <div className="row g-4">{SAMPLE_OFFERS.map(o => <div className="col-lg-6 reveal" key={o}><div className="offer-box"><span className="offer-tag">OFFER</span><h3>{o}</h3>
        <a href="#booking" className="btn btn-gold mt-3" onClick={() => setOffer(o)}>Claim this offer<i className="bi bi-arrow-right ms-2" /></a></div></div>)}</div>
    </div></section>}

    <section className="section-pad" id="why-us"><div className="container">
      <div className="text-center mb-5 reveal"><span className="section-label">The {brand} Difference</span>
        <h2 className="section-title">Why Choose <span className="gold">Us?</span></h2>
        <p className="section-desc mx-auto">Your salon experience should feel as good as your new look.</p></div>
      <div className="row g-4">{[['bi-person-check', 'Expert Stylists', 'Personalized styling recommendations suited to your needs and preferences.'], ['bi-shield-check', 'Hygiene First', 'Clean workstations, hygienic tools and careful salon practices.'], ['bi-gem', 'Quality Products', 'Thoughtfully selected products for your chosen beauty service.'], ['bi-heart', 'Personalized Care', 'We listen to your preferences and focus on your comfort and style.']].map(([ic, h, p]) =>
        <div className="col-sm-6 col-lg-3 reveal" key={h}><div className="why-card"><div className="why-icon"><i className={`bi ${ic}`} /></div><h3>{h}</h3><p>{p}</p></div></div>)}</div>
    </div></section>

    {SHOW_SAMPLE_REVIEWS && <section className="section-pad reviews-section" id="reviews"><div className="container">
      <div className="text-center mb-5 reveal"><span className="section-label">Kind Words</span><h2 className="section-title">Your Trust Is Our <span className="gold">Pride.</span></h2></div>
    </div></section>}

    <section className="section-pad booking-section" id="booking"><div className="container"><div className="row align-items-center g-5">
      <div className="col-lg-5 reveal"><div className="booking-intro">
        <span className="section-label">Let's Get You Booked</span>
        <h2 className="section-title">Your Next Look<br />Starts <span className="gold">Here.</span></h2>
        <p className="section-desc">Appointment book karna ab aasan hai. Apni details aur preferred time share karein. Aapko ek Booking ID milegi jisse aap kabhi bhi status track kar sakte hain.</p>
        <div className="contact-line"><i className="bi bi-calendar2-check" /><div><strong>Choose Your Time</strong>Pick a service, a date and a free time slot.</div></div>
        <div className="contact-line"><i className="bi bi-hash" /><div><strong>Booking ID for tracking</strong>Get an ID like SB-7K3M9Q and follow your booking any time.</div></div>
        <div className="contact-line"><i className="bi bi-bell" /><div><strong>Instant updates</strong>Allow notifications to hear the moment the salon confirms.</div></div>
      </div></div>

      <div className="col-lg-7 reveal"><div className="booking-form">
        {done ? <div className="booking-done">
          <h3>{done.status === 'CONFIRMED' ? '✅ Booking confirmed' : '⏳ Request sent'}</h3>
          <p>Your Booking ID — keep it to track this appointment:</p>
          <div className="big-code">{done.code}</div>
          <p>{done.service} · {dt(done.startAt)} · {inr(done.priceCents)}<br /><small>Your appointment is subject to {brand}'s confirmation. You can check the status any time.</small></p>
          <div>
            <Link className="btn btn-gold" to={`/track?code=${encodeURIComponent(done.code)}&phone=${encodeURIComponent(done.phone)}`}>Track my booking</Link>
            <button type="button" className="btn btn-outline-gold" style={{ color: '#2b2620' }} onClick={() => { navigator.clipboard?.writeText(done.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copied ✓' : 'Copy ID'}</button>
          </div>
          <div className="psal-push mt-3"><PushButton label="🔔 Notify me when the salon replies" save={sub => api.post('/public/push/subscribe', { code: done.code, phone: done.phone, subscription: sub })} /></div>
          <div className="mt-3"><button type="button" className="btn btn-outline-gold" style={{ color: '#2b2620' }} onClick={() => { setDone(null); setServiceId(''); setSlot(''); setAgree(false); }}>Book another appointment</button></div>
        </div> : <>
          <h3>Book An Appointment</h3>
          <p className="form-subtitle">Fill in your details to book with {brand}.</p>
          {site.closedNow && <div className="closed-banner">Closed right now{site.closedNow.message ? `: ${site.closedNow.message}` : ''}. You can still request a time after we reopen.</div>}
          <form onSubmit={submit}><div className="row g-3">
            <div className="col-md-6"><label className="form-label" htmlFor="customerName">Full Name *</label><input className="form-control" id="customerName" type="text" placeholder="Enter your name" autoComplete="name" minLength={2} maxLength={70} required value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="customerPhone">Phone Number *</label><input className="form-control" id="customerPhone" type="tel" placeholder="10-digit mobile number" inputMode="numeric" autoComplete="tel-national" pattern="[6-9][0-9]{9}" maxLength={10} required value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} /></div>
            <div className="col-md-6"><label className="form-label" htmlFor="serviceSelect">Select Service *</label>
              <select className="form-select" id="serviceSelect" required value={serviceId} onChange={e => pickService(e.target.value)}><option value="">Choose a service</option>{site.services.map((s: any) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min · {inr(s.basePriceCents)}</option>)}</select></div>
            <div className="col-md-6"><label className="form-label" htmlFor="bookingDate">Preferred Date *</label><input className="form-control" id="bookingDate" type="date" min={todayStr()} required value={date} onChange={e => setDate(e.target.value || todayStr())} /></div>
            <div className="col-12"><label className="form-label">Preferred Time *</label>
              {!serviceId ? <p className="slot-hint">Choose a service to see free times.</p>
                : slotsBusy ? <p className="slot-hint">Loading times…</p>
                : slots?.error ? <p className="slot-hint">Could not load times. Please try again.</p>
                : !slots?.open ? <p className="slot-hint">The salon is closed on this day. Please pick another date.</p>
                : !slots.slots.length ? <p className="slot-hint">No free times on this date. Please pick another date.</p>
                : <div className="slot-grid">{slots.slots.map((s: any) => <button type="button" key={s.startAt} className={`slot-btn ${slot === s.startAt ? 'on' : ''}`} onClick={() => setSlot(s.startAt)}>{t12(s.time)}</button>)}</div>}
            </div>
            {svc?.flexible && <div className="col-md-6"><label className="form-label" htmlFor="priceOffer">Offer a price ₹ (optional)</label><input className="form-control" id="priceOffer" type="number" min={1} placeholder={`Listed: ${inr(svc.basePriceCents)}`} value={priceOffer} onChange={e => setPriceOffer(e.target.value)} /></div>}
            {SHOW_SAMPLE_OFFERS && <div className="col-md-6"><label className="form-label" htmlFor="bookingOffer">Offer (Optional)</label><select className="form-select" id="bookingOffer" value={offer} onChange={e => setOffer(e.target.value)}><option value="">No offer selected</option>{SAMPLE_OFFERS.map(o => <option key={o}>{o}</option>)}</select></div>}
            <div className="col-12"><div className="form-check mt-2"><input className="form-check-input" type="checkbox" id="confirmDetails" checked={agree} onChange={e => setAgree(e.target.checked)} required />
              <label className="form-check-label" htmlFor="confirmDetails" style={{ fontSize: 11, color: '#6f665c' }}>I agree to send these details to {brand} to book my appointment.</label></div></div>
            {err && <div className="col-12"><div className="form-error">{err}</div></div>}
            <div className="col-12 mt-4"><button className="btn btn-gold w-100" type="submit" disabled={busy || !slot}>{busy ? 'Sending…' : <><i className="bi bi-calendar2-check me-2" />Send Booking Request</>}</button>
              <p className="text-center mt-3 mb-0" style={{ fontSize: 11, color: '#81776c' }}>Your appointment is subject to salon confirmation. Already booked? <Link to="/track" style={{ color: '#5d4728' }}>Track your booking</Link></p></div>
          </div></form>
        </>}
      </div></div>
    </div></div></section>

    <section className="section-pad" id="contact"><div className="container">
      <div className="text-center mb-5 reveal"><span className="section-label">Find Your Way To Us</span><h2 className="section-title">Come Say <span className="gold">Hello.</span></h2>
        <p className="section-desc mx-auto">Visit {brand} for your next grooming and beauty appointment.</p></div>
      <div className="row g-4">
        <div className="col-lg-5 reveal"><div className="location-card">
          <h3 className="serif mb-4" style={{ fontSize: 29 }}>Salon Information</h3>
          <div className="contact-line"><i className="bi bi-geo-alt" /><div><strong>Our Address</strong><span>{site.address || 'Address coming soon'}</span></div></div>
          <div className="contact-line"><i className="bi bi-telephone" /><div><strong>Call Us</strong><span>{site.phone ? <a href={`tel:${site.phone}`}>{site.phone}</a> : 'Phone coming soon'}</span></div></div>
          <div className="contact-line"><i className="bi bi-clock" /><div className="w-100"><strong>Opening Hours</strong>
            <div className="hours-list">{hoursRows.map(r => <div className="hours-row" key={r.d}><span>{DAY_LONG[r.d]}</span><span>{r.text}</span></div>)}</div></div></div>
          <a className="btn btn-outline-gold mt-4" href={`https://www.google.com/maps/search/?api=1&query=${mapQ}`} target="_blank" rel="noopener noreferrer"><i className="bi bi-map me-2" />Get Directions</a>
        </div></div>
        <div className="col-lg-7 reveal">{site.address
          ? <iframe className="map-frame" title={`Find ${brand} on Google Maps`} src={`https://maps.google.com/maps?q=${mapQ}&t=&z=14&ie=UTF8&iwloc=&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen />
          : <div className="location-card" style={{ height: '100%', display: 'grid', placeItems: 'center' }}><p>Map will appear once the salon adds its address.</p></div>}</div>
      </div>
    </div></section>

    <footer><div className="container">
      <div className="row g-4">
        <div className="col-lg-4"><a href="#home" className="footer-brand">{brand.charAt(0)} <span>{brand}.</span></a>
          <p className="footer-desc mt-3">Your beauty, your style, your confidence. Experience personalized hair and beauty care at {brand}.</p>
          <div className="mt-4"><a className="social-link" href="#contact" aria-label="Location"><i className="bi bi-geo-alt" /></a>{site.phone && <a className="social-link" href={`tel:${site.phone}`} aria-label="Call"><i className="bi bi-telephone" /></a>}</div></div>
        <div className="col-6 col-lg-2"><h4 className="footer-heading">QUICK LINKS</h4>
          <a href="#home" className="footer-link">Home</a><a href="#about" className="footer-link">About Us</a><a href="#services" className="footer-link">Services</a><a href="#contact" className="footer-link">Contact</a><Link to="/track" className="footer-link">Track booking</Link></div>
        <div className="col-6 col-lg-3"><h4 className="footer-heading">OUR SERVICES</h4>
          {site.services.slice(0, 5).map((s: any) => <a href="#services" className="footer-link" key={s.id}>{s.name}</a>)}</div>
        <div className="col-lg-3"><h4 className="footer-heading">GET IN TOUCH</h4>
          {site.address && <p className="footer-desc"><i className="bi bi-geo-alt gold me-2" />{site.address}</p>}
          {site.phone && <p className="footer-desc"><i className="bi bi-telephone gold me-2" />{site.phone}</p>}
          <a href="#booking" className="btn btn-gold btn-sm mt-2">Book Appointment<i className="bi bi-arrow-right ms-1" /></a></div>
      </div>
      <div className="copyright d-flex flex-column flex-md-row justify-content-between gap-2"><span>&copy; {new Date().getFullYear()} {brand}. All rights reserved.</span><span>Designed with care for your confidence.</span></div>
    </div></footer>

    <a href="#booking" className="whatsapp-float" aria-label="Book appointment" title="Book your appointment"><i className="bi bi-calendar2-check" /></a>
    <button type="button" className={`back-top ${top ? 'show' : ''}`} aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><i className="bi bi-arrow-up" /></button>
  </div>;
}
