// Load .env from the project root even when the API is started from apps/api (npm workspaces sets cwd there).
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env (32+ characters).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL must be set in .env.');
  process.exit(1);
}
export const env = {
  jwtSecret: process.env.JWT_SECRET,
  port: Number(process.env.PORT || 4000),
  webOrigins: (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim()),
  // "mock" lets the dev UI complete a fake online payment. Set PAYMENT_PROVIDER=razorpay/stripe etc. and implement a webhook for production.
  paymentProvider: process.env.PAYMENT_PROVIDER || 'mock',
};

// Browser push (optional). Generate keys once with:  npx web-push generate-vapid-keys
// Without them the app works normally and the "notify me" buttons are simply hidden.
export const vapid = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
};
