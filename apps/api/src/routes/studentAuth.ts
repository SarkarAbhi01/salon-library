import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { sign } from '../middleware/auth';
import { parse } from '../lib/util';
import { authLimiter } from './auth';

const r = Router();
const lib = (id: string) => prisma.tenant.findFirst({ where: { id, type: 'LIBRARY', status: 'ACTIVE', enabled: true } });

export async function newCardNo(tenantId: string) {
  for (let i = 0; i < 10; i++) {
    const cardNo = 'LIB-' + String(Math.floor(100000 + Math.random() * 900000));
    if (!(await prisma.student.findUnique({ where: { tenantId_cardNo: { tenantId, cardNo } } }))) return cardNo;
  }
  throw new Error('Could not allocate card number');
}

r.post('/register', authLimiter, async (req, res) => {
  const d = parse(z.object({ libraryId: z.string(), name: z.string().min(2), email: z.string().email(), phone: z.string().min(6).optional(), password: z.string().min(8), examGoal: z.string().max(100).optional() }), req.body, res);
  if (!d) return;
  if (!(await lib(d.libraryId))) return res.status(404).json({ error: 'Library not found' });
  const email = d.email.toLowerCase();
  if (await prisma.student.findUnique({ where: { tenantId_email: { tenantId: d.libraryId, email } } })) return res.status(409).json({ error: 'This email is already registered at this library' });
  const s = await prisma.student.create({ data: { tenantId: d.libraryId, name: d.name, email, phone: d.phone, examGoal: d.examGoal, passwordHash: await bcrypt.hash(d.password, 12), cardNo: await newCardNo(d.libraryId) } });
  res.status(201).json({ id: s.id, cardNo: s.cardNo });
});

r.post('/login', authLimiter, async (req, res) => {
  const d = parse(z.object({ libraryId: z.string(), identifier: z.string().min(2), password: z.string().min(1) }), req.body, res);
  if (!d) return;
  const t = await lib(d.libraryId);
  if (!t) return res.status(404).json({ error: 'Library not found' });
  const id = d.identifier.trim();
  const s = await prisma.student.findFirst({ where: { tenantId: t.id, OR: [{ email: id.toLowerCase() }, { cardNo: id.toUpperCase() }] } });
  if (!s || !(await bcrypt.compare(d.password, s.passwordHash))) return res.status(401).json({ error: 'Invalid credentials' });
  if (s.status !== 'ACTIVE') return res.status(403).json({ error: 'Your account is blocked. Contact the library.' });
  res.json({
    token: sign({ id: s.id, role: 'STUDENT', tenantId: t.id, tenantType: 'LIBRARY' }),
    user: { id: s.id, name: s.name, email: s.email, role: 'STUDENT', tenant: { id: t.id, type: 'LIBRARY', name: t.name } },
  });
});

export default r;
