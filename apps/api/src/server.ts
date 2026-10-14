import { env } from './env';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import auth from './routes/auth';
import admin from './routes/admin';
import tenant from './routes/tenant';
import salon from './routes/salon';
import library from './routes/library';
import student from './routes/student';
import studentAuth from './routes/studentAuth';
import publicApi from './routes/public';
import { HttpError } from './lib/util';
import { startJobs } from './lib/jobs';
import { backfillSlugs } from './lib/site';
import { backfillCodes } from './lib/codes';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: env.webOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_, res) => res.json({ ok: true, service: 'salon-library-api' }));
app.use('/api/auth', auth);
app.use('/api/student-auth', studentAuth);
app.use('/api/public', publicApi);
app.use('/api/admin', admin);
app.use('/api/tenant', tenant);
app.use('/api/salon', salon);
app.use('/api/library', library);
app.use('/api/student', student);
app.use((_, res) => res.status(404).json({ error: 'Not found' }));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid data' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err?.code === 'P2002') return res.status(409).json({ error: 'A record with these details already exists' });
  if (err?.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  if (err?.code === 'P2034') return res.status(409).json({ error: 'Another request changed this at the same time. Please retry.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.port, () => {
  console.log(`API http://localhost:${env.port}`);
  startJobs();
  // one-off catch-up for data created before slugs / booking codes existed (safe to run on every start)
  backfillSlugs().then(backfillCodes).catch(e => console.error('[backfill]', e));
});
