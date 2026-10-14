import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getUser, useLoad, Loading, Page, Stat, Empty, dt, type U } from './lib/ui';
import { Login, Forgot, Reset, StudentLogin, StudentRegister } from './pages/auth';
import { Tenants, Plans, Maintenance } from './pages/admin';
import { Services, Hours, Bookings } from './pages/salon';
import { LibDashboard, Seats, Students, Admission, Batches, Books, Payments, Announcements, Reports, Settings, Website, Enquiries } from './pages/library';
import { StudentHome, StudentSeats, StudentBookings, StudentStudy, StudentBooks, StudentMembership, StudentNotifications, StudentProfile } from './pages/student';
import { SalonList, SalonBook, BookingStatusPage } from './pages/public';
import PublicSite from './pages/publicSite';
import TrackPage from './pages/track';
import { ThemePage } from './pages/theme';
import { applyTheme, clearTheme, resolveTheme } from './lib/theme';

type Item = [string, string];
function navFor(u: U, themeOn = false): Item[] {
  if (u.role === 'SUPER_ADMIN') return [['/', 'Dashboard'], ['/tenants', 'Clients'], ['/plans', 'Plans'], ['/maintenance', 'Maintenance']];
  if (u.role === 'STUDENT') return [['/student', 'Home'], ['/student/seats', 'Book seat'], ['/student/bookings', 'My bookings'], ['/student/study', 'Study timer'], ['/student/books', 'Books'], ['/student/membership', 'Membership & payments'], ['/student/notifications', 'Notifications'], ['/student/profile', 'Profile & ID card']];
  if (u.tenant?.type === 'SALON') return [['/', 'Dashboard'], ['/bookings', 'Bookings'], ['/services', 'Services'], ['/hours', 'Hours & closures']];
  return [['/', 'Dashboard'], ['/seats', 'Seats & check-in'], ['/students', 'Students'], ['/admission', 'Admission'], ['/books', 'Books'], ['/payments', 'Payments'], ['/announcements', 'Announcements'], ['/website', 'Public website'], ['/enquiries', 'Enquiries'], ['/reports', 'Reports'], ['/batches', 'Batches'], ['/settings', 'Rules'], ...(themeOn ? [['/theme', 'Theme'] as Item] : [])];
}

/** Library owners only: loads the theme the SuperAdmin allowed + the owner chose, and keeps it in step with the calendar. */
function useLibraryTheme(u: U) {
  const lib = u.role === 'OWNER' && u.tenant?.type === 'LIBRARY';
  const [t, setT] = useState<{ enabled: boolean; mode: string; name: string } | null>(null);
  const load = () => { if (lib) api.get('/tenant/theme').then(r => setT(r.data)).catch(() => setT({ enabled: false, mode: 'FIXED', name: 'classic' })); };
  useEffect(() => {
    load(); window.addEventListener('theme-changed', load); window.addEventListener('focus', load);
    const poll = setInterval(load, 2 * 60 * 1000); // SuperAdmin switching the Theme menu off/on shows up without a manual refresh
    return () => { window.removeEventListener('theme-changed', load); window.removeEventListener('focus', load); clearInterval(poll); };
  }, [lib, u.id]); // eslint-disable-line
  useEffect(() => {
    if (!lib) return clearTheme();
    // Theme switched off by the SuperAdmin → back to the default look immediately.
    if (!t || !t.enabled) return clearTheme();
    applyTheme(resolveTheme(t.mode, t.name));
    const timer = setInterval(() => applyTheme(resolveTheme(t.mode, t.name)), 6 * 3600 * 1000); // picks up a new month/season while the tab stays open
    return () => { clearInterval(timer); };
  }, [lib, t]);
  useEffect(() => () => clearTheme(), []);
  return lib && !!t?.enabled;
}

function Layout({ children }: { children: ReactNode }) {
  const nav = useNavigate(), u = getUser();
  const themeOn = useLibraryTheme(u);
  const logout = () => { const s = u.role === 'STUDENT'; localStorage.clear(); clearTheme(); nav(s ? '/student/login' : '/login'); };
  return <div className="shell"><aside><h2>{u.role === 'SUPER_ADMIN' ? 'SuperAdmin' : u.tenant?.name}</h2>
    <nav>{navFor(u, themeOn).map(([to, label]) => <NavLink key={to} to={to} end={to === '/' || to === '/student'}>{label}</NavLink>)}<button className="secondary" onClick={logout}>Logout</button></nav></aside>
    <section className="content"><header><span>{u.name}</span><span className="pill">{u.role === 'SUPER_ADMIN' ? 'SUPER ADMIN' : u.role === 'STUDENT' ? 'STUDENT' : u.tenant?.type}</span></header>{children}</section></div>;
}

/** Auth + role guard. Wrong-role users are bounced to their own home instead of seeing broken pages. */
function Guard({ role, type, children }: { role: U['role']; type?: 'SALON' | 'LIBRARY'; children: ReactNode }) {
  const u = getUser();
  if (!localStorage.getItem('token') || !u.role) return <Navigate to={role === 'STUDENT' ? '/student/login' : '/login'} replace />;
  if (u.role !== role || (type && u.tenant?.type !== type)) return <Navigate to={u.role === 'STUDENT' ? '/student' : '/'} replace />;
  return <Layout>{children}</Layout>;
}

/** Salon owner: where customers find the salon's home page + booking form, and the switch for phone alerts. */
function SalonSitePanel() {
  const { data } = useLoad<any>(() => api.get('/tenant/profile').then(r => r.data));
  if (!data?.slug) return null;
  const url = `${window.location.origin}/${data.slug}`;
  return <div className="panel"><h2>Your salon website</h2>
    <p>Customers see your home page, services, opening hours and booking form here:</p>
    <p><a href={url} target="_blank" rel="noreferrer"><b>{url}</b></a></p>
    <div className="btnrow"><button className="secondary" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button><NavLink to="/bookings"><button type="button">Open bookings</button></NavLink></div>
  </div>;
}

function Dashboard() {
  const u = getUser();
  const { data, error, reload } = useLoad<any>(() => api.get(u.role === 'SUPER_ADMIN' ? '/admin/dashboard' : '/tenant/dashboard').then(r => r.data), [], 30000);
  if (!data) return <Loading error={error} retry={reload} />;
  const entries = Object.entries(data.counts);
  const max = Math.max(1, ...entries.map(([, v]) => Number(v)));
  return <Page title="Dashboard">
    {u.role === 'OWNER' && u.tenant?.type === 'SALON' && <SalonSitePanel />}
    <div className="grid">{entries.map(([k, v]) => <Stat key={k} k={k} v={String(v)} />)}</div>
    <div className="panel chart"><h2>Overview</h2>{entries.map(([k, v]) => <div className="barrow" key={k}><span>{k.replaceAll('_', ' ')}</span><div className="bar"><i style={{ width: `${Math.max(2, (Number(v) / max) * 100)}%` }} /></div><b>{String(v)}</b></div>)}</div>
    <div className="panel"><h2>Recent activity</h2>{data.recent?.length ? data.recent.map((x: any) => <div className="row" key={x.id}><span>{x.action}</span><small>{dt(x.createdAt)}</small></div>) : <Empty text="No recent activity." />}</div>
  </Page>;
}

const OwnerHome = () => (getUser().tenant?.type === 'LIBRARY' ? <LibDashboard /> : <Dashboard />);
const Home = () => { const u = getUser(); return u.role === 'SUPER_ADMIN' ? <Dashboard /> : <OwnerHome />; };

/**
 * "/" — decides what to show from the *current* login every time it renders.
 * (Before, this was decided once when <App/> first rendered, so after a fresh login the old, empty login state was used
 *  and the dashboard only appeared after a manual refresh.)
 */
function Root() {
  const u = getUser(), token = localStorage.getItem('token');
  if (!token || !u.role) return <Navigate to="/login" replace />;
  if (u.role === 'STUDENT') return <Navigate to="/student" replace />;
  return <Guard role={u.role}><Home /></Guard>;
}

export default function App() {
  useLocation(); // re-render on every navigation so route elements below always read the latest login
  const owner = (el: ReactNode, type?: 'SALON' | 'LIBRARY') => <Guard role="OWNER" type={type}>{el}</Guard>;
  const admin = (el: ReactNode) => <Guard role="SUPER_ADMIN">{el}</Guard>;
  const stu = (el: ReactNode) => <Guard role="STUDENT">{el}</Guard>;
  return <Routes>
    <Route path="/login" element={<Login />} /><Route path="/forgot" element={<Forgot />} /><Route path="/reset" element={<Reset />} />
    <Route path="/student/login" element={<StudentLogin />} /><Route path="/student/register" element={<StudentRegister />} />
    <Route path="/book" element={<SalonList />} /><Route path="/book/:id" element={<SalonBook />} /><Route path="/book/status/:id" element={<BookingStatusPage />} />
    <Route path="/track" element={<TrackPage />} />

    <Route path="/" element={<Root />} />
    <Route path="/tenants" element={admin(<Tenants />)} /><Route path="/plans" element={admin(<Plans />)} /><Route path="/maintenance" element={admin(<Maintenance />)} />

    <Route path="/bookings" element={owner(<Bookings />, 'SALON')} /><Route path="/services" element={owner(<Services />, 'SALON')} /><Route path="/hours" element={owner(<Hours />, 'SALON')} />
    <Route path="/slots" element={<Navigate to="/bookings" replace />} />

    <Route path="/seats" element={owner(<Seats />, 'LIBRARY')} /><Route path="/students" element={owner(<Students />, 'LIBRARY')} /><Route path="/admission" element={owner(<Admission />, 'LIBRARY')} />
    <Route path="/books" element={owner(<Books />, 'LIBRARY')} /><Route path="/payments" element={owner(<Payments />, 'LIBRARY')} /><Route path="/announcements" element={owner(<Announcements />, 'LIBRARY')} />
    <Route path="/reports" element={owner(<Reports />, 'LIBRARY')} /><Route path="/batches" element={owner(<Batches />, 'LIBRARY')} /><Route path="/settings" element={owner(<Settings />, 'LIBRARY')} /><Route path="/website" element={owner(<Website />, 'LIBRARY')} /><Route path="/enquiries" element={owner(<Enquiries />, 'LIBRARY')} />
    <Route path="/theme" element={owner(<ThemePage />, 'LIBRARY')} />

    <Route path="/student" element={stu(<StudentHome />)} /><Route path="/student/seats" element={stu(<StudentSeats />)} /><Route path="/student/bookings" element={stu(<StudentBookings />)} />
    <Route path="/student/study" element={stu(<StudentStudy />)} /><Route path="/student/books" element={stu(<StudentBooks />)} /><Route path="/student/membership" element={stu(<StudentMembership />)} />
    <Route path="/student/notifications" element={stu(<StudentNotifications />)} /><Route path="/student/profile" element={stu(<StudentProfile />)} />
    <Route path="/:slug" element={<PublicSite />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
