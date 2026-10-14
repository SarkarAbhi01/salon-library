import { z } from 'zod';
import { prisma } from '../db';

export const RESERVED = new Set(['login', 'forgot', 'reset', 'student', 'book', 'api', 'admin', 'tenants', 'plans', 'maintenance', 'bookings', 'services', 'hours', 'slots', 'seats', 'students', 'admission', 'books', 'payments', 'announcements', 'reports', 'batches', 'settings', 'website', 'enquiries', 'health', 'track', 'sw', 'manifest', 'assets', 'favicon']);
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);

export async function uniqueSlug(base: string, ownerTenantId?: string, kind: 'library' | 'salon' = 'library') {
  let b = slugify(base) || kind;
  if (b.length < 3) b += kind === 'salon' ? '-salon' : '-lib';
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? b : `${b}-${i + 1}`;
    if (RESERVED.has(cand)) continue;
    const hit = await prisma.tenant.findUnique({ where: { slug: cand }, select: { id: true } });
    if (!hit || hit.id === ownerTenantId) return cand;
  }
  return `${b}-${Date.now().toString(36)}`;
}

export const siteContent = z.object({
  badge: z.string().max(80), heroTitle: z.string().max(120), heroText: z.string().max(400),
  aboutTitle: z.string().max(120), aboutText: z.string().max(1200), aboutPoints: z.array(z.string().min(1).max(100)).max(10),
  facilities: z.array(z.object({ icon: z.string().max(4), title: z.string().min(1).max(60), text: z.string().max(200) })).max(12),
  stats: z.array(z.object({ number: z.string().min(1).max(12), label: z.string().min(1).max(40) })).max(4),
  achievers: z.array(z.object({ name: z.string().min(1).max(80), exam: z.string().max(80), post: z.string().max(80), year: z.string().max(10) })).max(12),
  studyHours: z.string().max(100), email: z.union([z.string().email(), z.literal('')]),
}).partial();

export const DEFAULT_CONTENT = {
  badge: '📖 Dedicated Study Environment',
  heroTitle: 'Focus Better. Prepare Better. Achieve Your Goal.',
  heroText: 'A peaceful and disciplined study environment for students preparing for competitive examinations, government jobs and academic goals.',
  aboutTitle: 'A Place Where Preparation Meets Discipline',
  aboutText: 'Our library provides a peaceful and comfortable environment where students can concentrate on their studies without unnecessary distractions. It is suitable for students preparing for competitive examinations, government jobs and academic examinations.',
  aboutPoints: ['Peaceful study environment', 'Comfortable study space', 'Dedicated seating', 'Student-friendly facilities', 'Focused preparation environment'],
  facilities: [
    { icon: '📚', title: 'Dedicated Study Seats', text: 'Individual study space for focused preparation.' },
    { icon: '🤫', title: 'Silent Zone', text: 'A peaceful environment with minimum distractions.' },
    { icon: '📶', title: 'Wi-Fi', text: 'Internet access for online educational resources.' },
    { icon: '🔌', title: 'Charging Points', text: 'Convenient charging facilities for devices.' },
    { icon: '💧', title: 'Drinking Water', text: 'Drinking water facility available for students.' },
    { icon: '📹', title: 'Security', text: 'Security arrangements for a safe study environment.' },
  ],
  stats: [{ number: '500+', label: 'Students' }, { number: '24/7', label: 'Study Environment' }, { number: '100%', label: 'Study Focus' }, { number: '⭐', label: 'Student Success' }],
  achievers: [] as { name: string; exam: string; post: string; year: string }[],
  studyHours: 'Monday - Sunday, 6:00 AM – 10:00 PM',
  email: '',
};
export const withDefaults = (c: unknown) => ({ ...DEFAULT_CONTENT, ...((c as object) ?? {}) });

/** Salons (and any library created before slugs existed) get a public address at start-up, so every client has a home page. */
export async function backfillSlugs() {
  const rows = await prisma.tenant.findMany({ where: { slug: null }, select: { id: true, name: true, type: true } });
  for (const t of rows) await prisma.tenant.update({ where: { id: t.id }, data: { slug: await uniqueSlug(t.name, t.id, t.type === 'SALON' ? 'salon' : 'library') } }).catch(() => {});
}
