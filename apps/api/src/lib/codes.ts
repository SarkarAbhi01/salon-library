import crypto from 'crypto';
import { prisma } from '../db';

// No 0/O/1/I so a code read out over the phone cannot be mistaken.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const random = (n: number) => Array.from(crypto.randomBytes(n), b => ALPHABET[b % ALPHABET.length]).join('');

/** SB-XXXXXX for salon bookings, LB-XXXXXX for library seat bookings. Retries on the (very unlikely) clash. */
export async function newBookingCode(kind: 'SALON' | 'LIBRARY'): Promise<string> {
  const prefix = kind === 'SALON' ? 'SB' : 'LB';
  for (let i = 0; i < 10; i++) {
    const code = `${prefix}-${random(6)}`;
    const taken = kind === 'SALON'
      ? await prisma.booking.findUnique({ where: { code }, select: { id: true } })
      : await prisma.seatBooking.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new Error('Could not allocate a booking code');
}

/** Old rows created before booking codes existed get one at start-up, so every booking can be tracked. */
export async function backfillCodes() {
  const [bs, ss] = await Promise.all([
    prisma.booking.findMany({ where: { code: null }, select: { id: true }, take: 2000 }),
    prisma.seatBooking.findMany({ where: { code: null }, select: { id: true }, take: 2000 }),
  ]);
  for (const b of bs) await prisma.booking.update({ where: { id: b.id }, data: { code: await newBookingCode('SALON') } }).catch(() => {});
  for (const b of ss) await prisma.seatBooking.update({ where: { id: b.id }, data: { code: await newBookingCode('LIBRARY') } }).catch(() => {});
}

/** Normalises what a person types ("sb 7k3m9q", "SB7K3M9Q") to the stored form. */
export function normaliseCode(raw: string) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 3 ? `${s.slice(0, 2)}-${s.slice(2)}` : s;
}
