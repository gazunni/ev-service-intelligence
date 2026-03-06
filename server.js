import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import recallsRouter from './routes/recalls.js';
import tsbsRouter from './routes/tsbs.js';
import vinRouter from './routes/vin.js';
import communityRouter from './routes/community.js';
import adminRouter from './routes/admin.js';
import pool, { closePool } from './services/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';

function parseAllowedOrigins(value) {
  return (value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin or server-to-server
  if (allowedOrigins.length === 0) return true; // default open until env is set
  return allowedOrigins.includes(origin);
}

// ── SECURITY HEADERS ──────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://api.anthropic.com', 'https://api.nhtsa.gov', 'https://vpic.nhtsa.dot.gov'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
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
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (origin && !isOriginAllowed(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(join(__dirname, 'public')));

// ── REQUEST LOGGING ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/readyz') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ── HEALTH ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ev-service-intelligence', env: NODE_ENV });
});

app.get('/readyz', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'up' });
  } catch (error) {
    res.status(503).json({ ok: false, database: 'down', error: error.message });
  }
});

// ── ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/recalls', recallsRouter);
app.use('/api/tsbs', tsbsRouter);
app.use('/api/vin', vinRouter);
app.use('/api/community', communityRouter);
app.use('/api/admin', adminRouter);

// ── LEGACY ROUTE ALIASES (keep old client URLs working) ───────────────────
function fwd(router, newUrl) {
  return (req, res, next) => {
    req.url = newUrl;
    router(req, res, next);
  };
}
function fwdParam(router, prefix) {
  return (req, res, next) => {
    req.url = prefix + req.params.id;
    router(req, res, next);
  };
}

app.post('/api/sweep', fwd(recallsRouter, '/sweep'));
app.post('/api/submit', fwd(communityRouter, '/submit'));
app.post('/api/research', fwd(communityRouter, '/research'));
app.post('/api/approve', fwd(communityRouter, '/approve'));
app.post('/api/confirm', fwd(communityRouter, '/confirm'));
app.post('/api/tsb-clone', fwd(tsbsRouter, '/clone'));
app.post('/api/community-clone', fwd(communityRouter, '/clone'));
app.post('/api/forum-fetch', fwd(communityRouter, '/forum-fetch'));
app.post('/api/community-dedupe', fwd(communityRouter, '/dedupe'));
app.post('/api/tsb-add', fwd(tsbsRouter, '/add'));
app.post('/api/tsb-fetch', fwd(tsbsRouter, '/fetch'));
app.post('/api/recall-fetch', fwd(recallsRouter, '/fetch'));
app.post('/api/recall-add', fwd(recallsRouter, '/add'));
app.post('/api/nhtsa-import', fwd(recallsRouter, '/nhtsa-import'));
app.get('/api/vin-decode', fwd(vinRouter, '/decode'));
app.get('/api/vin-recalls', fwd(vinRouter, '/recalls'));
app.post('/api/vin-import', fwd(vinRouter, '/import'));

app.delete('/api/recalls/:id', fwdParam(adminRouter, '/recalls/'));
app.delete('/api/tsbs/:id', fwdParam(adminRouter, '/tsbs/'));
app.delete('/api/community/:id', fwdParam(adminRouter, '/community/'));

// ── API 404 / ERROR HANDLERS ──────────────────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

app.use((err, _req, res, _next) => {
  console.error('unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
});

// ── FRONTEND FALLBACK ─────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ── START / SHUTDOWN ──────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`EV Service Intelligence running on port ${PORT}`);
  if (allowedOrigins.length) {
    console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
  } else {
    console.log('Allowed origins: * (set ALLOWED_ORIGINS to lock this down)');
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    try {
      await closePool();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
