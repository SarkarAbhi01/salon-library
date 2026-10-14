import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const p = new PrismaClient();
const DAY = 86400000;

// Idempotent: safe to run many times (the old seed created duplicate tenants and then crashed on the unique e-mail).
async function tenantWithOwner(type: 'SALON' | 'LIBRARY', name: string, email: string, ownerName: string, hash: string) {
  let owner = await p.user.findUnique({ where: { email }, include: { tenant: true } });
  if (owner?.tenant) return owner.tenant;
  const tenant = await p.tenant.create({ data: { type, name, phone: '9999999999', address: 'Demo Street, Demo City', trialEndsAt: new Date(Date.now() + 14 * DAY) } });
  await p.user.create({ data: { tenantId: tenant.id, name: ownerName, email, passwordHash: hash, role: 'OWNER' } });
  return tenant;
}

async function main() {
  const hash = await bcrypt.hash('Admin@12345', 12);
  await p.user.upsert({ where: { email: 'admin@example.com' }, update: {}, create: { name: 'Super Admin', email: 'admin@example.com', passwordHash: hash, role: 'SUPER_ADMIN' } });

  // ── Salon ──
  const salon = await tenantWithOwner('SALON', 'Demo Salon', 'salon@example.com', 'Salon Owner', hash);
  if (!(await p.service.count({ where: { tenantId: salon.id } }))) {
    await p.service.createMany({ data: [
      { tenantId: salon.id, name: 'Haircut', durationMin: 45, basePriceCents: 40000, flexiblePriceMinCents: 25000 },
      { tenantId: salon.id, name: 'Hair Spa', durationMin: 60, basePriceCents: 80000, flexiblePriceMinCents: 50000 },
    ] });
    // Open Mon–Sat so the public booking page has slots straight away
    await p.businessHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map(d => ({ tenantId: salon.id, dayOfWeek: d, open: d !== 0, morningStart: '09:00', morningEnd: '13:00', noonStart: null, noonEnd: null, eveningStart: '16:00', eveningEnd: '20:00' })) });
  }

  if (!salon.slug) await p.tenant.update({ where: { id: salon.id }, data: { slug: 'demo-salon' } });

  // ── Library ──
  const lib = await tenantWithOwner('LIBRARY', 'Demo Competitive Library', 'library@example.com', 'Library Owner', hash);
  await p.librarySetting.upsert({ where: { tenantId: lib.id }, update: {}, create: { tenantId: lib.id } });
  if (!lib.slug) await p.tenant.update({ where: { id: lib.id }, data: { slug: 'demo-library' } });
  if (!(await p.batch.count({ where: { tenantId: lib.id } }))) {
    for (let d = 0; d < 7; d++) {
      await p.batch.create({ data: { tenantId: lib.id, name: 'Morning Batch', dayOfWeek: d, startTime: '07:00', endTime: '11:00', capacity: 30 } });
      await p.batch.create({ data: { tenantId: lib.id, name: 'Evening Batch', dayOfWeek: d, startTime: '17:00', endTime: '21:00', capacity: 30 } });
    }
  }
  if (!(await p.membershipPlan.count({ where: { tenantId: lib.id } }))) {
    await p.membershipPlan.createMany({ data: [
      { tenantId: lib.id, name: '1 Month', months: 1, priceCents: 80000, description: 'Reserved seat access' },
      { tenantId: lib.id, name: '3 Months', months: 3, priceCents: 210000, description: 'Save 12%' },
      { tenantId: lib.id, name: '6 Months', months: 6, priceCents: 400000, description: 'Best value' },
    ] });
  }
  if (!(await p.room.count({ where: { tenantId: lib.id } }))) {
    for (const [name, floor, prefix] of [['Silent Hall A', 1, 'A'], ['Cabin Block B', 2, 'B']] as const) {
      const room = await p.room.create({ data: { tenantId: lib.id, name, floor } });
      await p.seat.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ tenantId: lib.id, roomId: room.id, label: `${prefix}${i + 1}`, row: Math.floor(i / 5), col: i % 5 })) });
    }
  }
  if (!(await p.book.count({ where: { tenantId: lib.id } }))) {
    await p.book.createMany({ data: [
      { tenantId: lib.id, title: 'Indian Polity', author: 'M. Laxmikanth', category: 'Polity', shelf: 'P-01', copies: 4, available: 4, isbn: '9789353165482' },
      { tenantId: lib.id, title: 'Quantitative Aptitude', author: 'R. S. Aggarwal', category: 'Maths', shelf: 'M-02', copies: 5, available: 5 },
      { tenantId: lib.id, title: 'General Science', author: 'Lucent', category: 'Science', shelf: 'S-03', copies: 3, available: 3 },
      { tenantId: lib.id, title: 'Modern History of India', author: 'Bipan Chandra', category: 'History', shelf: 'H-01', copies: 2, available: 2 },
    ] });
  }
  if (!(await p.student.findFirst({ where: { tenantId: lib.id, email: 'student@example.com' } }))) {
    const s = await p.student.create({ data: { tenantId: lib.id, name: 'Demo Student', email: 'student@example.com', phone: '8888888888', cardNo: 'LIB-100001', passwordHash: hash, examGoal: 'UPSC' } });
    const plan = await p.membershipPlan.findFirstOrThrow({ where: { tenantId: lib.id, months: 3 } });
    const start = new Date(), end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 3);
    const m = await p.membership.create({ data: { tenantId: lib.id, studentId: s.id, planId: plan.id, studentName: s.name, studentPhone: s.phone, months: 3, feeCents: plan.priceCents, startDate: start, endDate: end } });
    await p.payment.create({ data: { tenantId: lib.id, studentId: s.id, membershipId: m.id, kind: 'MEMBERSHIP', amountCents: plan.priceCents, method: 'CASH', status: 'PAID', paidAt: new Date(), invoiceNo: 'INV-DEMO-00001' } });
  }

  console.log('Seeded.\n  SuperAdmin:    admin@example.com   / Admin@12345\n  Salon owner:   salon@example.com   / Admin@12345\n  Library owner: library@example.com / Admin@12345\n  Student:       student@example.com / Admin@12345  (pick "Demo Competitive Library" on the student login)\n  Public library page: http://localhost:5173/demo-library');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
