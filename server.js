import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import recallsRouter   from './routes/recalls.js';
import tsbsRouter      from './routes/tsbs.js';
import vinRouter       from './routes/vin.js';
import communityRouter from './routes/community.js';
import adminRouter     from './routes/admin.js';
import { checkAdminAny } from './routes/admin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── SECURITY HEADERS ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:              ["'self'"],
      scriptSrc:               ["'self'", "'unsafe-inline'"],
      styleSrc:                ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:                 ["'self'", "https://fonts.gstatic.com"],
      imgSrc:                  ["'self'", "data:"],
      connectSrc:              ["'self'", "https://api.anthropic.com"],
      frameSrc:                ["'none'"],
      objectSrc:               ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), gyroscope=(), accelerometer=()');
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── REQUEST LOGGING ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ── ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/recalls',   recallsRouter);
app.use('/api/tsbs',      tsbsRouter);
app.use('/api/vin',       vinRouter);
app.use('/api/community', communityRouter);
app.use('/api/admin',     adminRouter);

// ── LEGACY ROUTE ALIASES (keep old client URLs working) ───────────────────
// Rewrite URL and re-dispatch so existing index.html needs no changes
function fwd(router, newUrl) {
  return (req, res, next) => { req.url = newUrl; router(req, res, next); };
}
function fwdParam(router, prefix) {
  return (req, res, next) => { req.url = prefix + req.params.id; router(req, res, next); };
}

app.post('/api/sweep',           fwd(recallsRouter,   '/sweep'));
app.post('/api/submit',          fwd(communityRouter, '/submit'));
app.post('/api/research',        fwd(communityRouter, '/research'));
app.post('/api/approve',         fwd(communityRouter, '/approve'));
app.post('/api/confirm',         fwd(communityRouter, '/confirm'));
app.post('/api/tsb-clone',       fwd(tsbsRouter,      '/clone'));
app.post('/api/community-clone', fwd(communityRouter, '/clone'));
app.post('/api/forum-fetch',       fwd(communityRouter, '/forum-fetch'));
app.post('/api/community-dedupe',   fwd(communityRouter, '/dedupe'));
app.post('/api/tsb-add',         fwd(tsbsRouter,      '/add'));
app.post('/api/tsb-fetch',       fwd(tsbsRouter,      '/fetch'));
app.post('/api/recall-fetch',    fwd(recallsRouter,   '/fetch'));
app.post('/api/recall-add',      fwd(recallsRouter,   '/add'));
app.post('/api/nhtsa-import',    fwd(recallsRouter,   '/nhtsa-import'));
app.get('/api/vin-decode',       fwd(vinRouter,       '/decode'));
app.get('/api/vin-recalls',      fwd(vinRouter,       '/recalls'));
app.post('/api/vin-import',      fwd(vinRouter,       '/import'));

// Admin delete aliases
app.delete('/api/recalls/:id',   fwdParam(adminRouter, '/recalls/'));
app.delete('/api/tsbs/:id',      fwdParam(adminRouter, '/tsbs/'));
app.delete('/api/community/:id', fwdParam(adminRouter, '/community/'));

// ── START ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EV Service Intelligence running on port ${PORT}`));
