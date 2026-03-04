import express from 'express';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── SECURITY HEADERS ─────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:      ["'self'"],
      scriptSrc:       ["'self'", "'unsafe-inline'"],
      styleSrc:        ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:         ["'self'", "https://fonts.gstatic.com"],
      imgSrc:          ["'self'", "data:"],
      connectSrc:      ["'self'", "https://api.nhtsa.gov", "https://api.anthropic.com"],
      frameSrc:        ["'none'"],
      objectSrc:       ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// Permissions-Policy — not yet in helmet, set manually
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), gyroscope=(), accelerometer=()');
  next();
});

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── DATABASE ─────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try { const r = await client.query(sql, params); return r.rows; }
  finally { client.release(); }
}

// ── VEHICLES ──────────────────────────────────
const VEHICLES = {
  equinox_ev: { make: 'Chevrolet', model: 'Equinox EV', nhtsa_make: 'CHEVROLET', nhtsa_model: 'EQUINOX EV' },
  blazer_ev:  { make: 'Chevrolet', model: 'Blazer EV',  nhtsa_make: 'CHEVROLET', nhtsa_model: 'BLAZER EV'  },
  mach_e:     { make: 'Ford',      model: 'Mustang Mach-E', nhtsa_make: 'FORD', nhtsa_model: 'MUSTANG MACH-E' },
};

// ── CORS ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── ROUTES ────────────────────────────────────

// GET /api/community
app.get('/api/community', async (req, res) => {
  const { vehicle, year } = req.query;
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  try {
    const rows = await query(
      `SELECT * FROM community WHERE vehicle_key=$1 AND year=$2 AND status='active'
       ORDER BY is_seeded DESC, confirmations DESC, created_at DESC`,
      [vehicle, parseInt(year)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/recalls
app.get('/api/recalls', async (req, res) => {
  const { vehicle, year } = req.query;
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  try {
    const rows = await query(
      `SELECT * FROM recalls WHERE vehicle_key=$1 AND year=$2 ORDER BY created_at DESC`,
      [vehicle, parseInt(year)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tsbs
app.get('/api/tsbs', async (req, res) => {
  const { vehicle, year } = req.query;
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  try {
    const rows = await query(
      `SELECT * FROM tsbs WHERE vehicle_key=$1 AND year=$2 ORDER BY created_at DESC`,
      [vehicle, parseInt(year)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sweep
app.post('/api/sweep', async (req, res) => {
  const { vehicle, year } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  const v = VEHICLES[vehicle];
  if (!v) return res.status(400).json({ error: 'Unknown vehicle' });
  const yr = parseInt(year);
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  async function fetchNHTSA(endpoint, make, model) {
    const url = `https://api.nhtsa.gov/${endpoint}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${yr}`;
    try {
      const r = await fetch(url);
      if (!r.ok) return [];
      const d = await r.json();
      return d.results || d.Results || [];
    } catch { return []; }
  }

  async function summarize(item, type) {
    const isRecall = type === 'recall';
    const prompt = isRecall
      ? `Summarize this NHTSA recall for ${v.make} ${v.model} owners. Return ONLY JSON: {"component":"...","severity":"CRITICAL|MODERATE|LOW","title":"max 8 words","risk":"...","remedy":"..."}`
      : `Summarize this NHTSA TSB for ${v.make} ${v.model} owners. Return ONLY JSON: {"component":"...","severity":"MODERATE|LOW","title":"max 8 words","summary":"2 sentences","remedy":"..."}`;
    const content = isRecall
      ? `Component: ${item.Component||''}\nSummary: ${item.Summary||''}\nConsequence: ${item.Consequence||''}\nRemedy: ${item.Remedy||''}`
      : `Bulletin: ${item.tsbNumber||''}\nSummary: ${item.Summary||''}`;
    try {
      const msg = await ai.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: prompt + '\n\n' + content }] });
      const match = (msg.content[0]?.text || '').match(/\{[\s\S]*?\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
  }

  try {
    const [rawRecalls, rawTSBs] = await Promise.all([
      fetchNHTSA('recalls/recallsByVehicle', v.nhtsa_make, v.nhtsa_model),
      fetchNHTSA('tsbs/tsbsByVehicle', v.nhtsa_make, v.nhtsa_model),
    ]);

    let recallsStored = 0, tsbsStored = 0;

    for (const r of rawRecalls) {
      const ai_data = await summarize(r, 'recall');
      const id = r.NHTSACampaignNumber || ('r-' + Date.now() + '-' + recallsStored);
      await query(
        `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,risk=EXCLUDED.risk,remedy=EXCLUDED.remedy,severity=EXCLUDED.severity,updated_at=NOW()`,
        [id, vehicle, yr, ai_data?.component||r.Component||'Unknown', ai_data?.severity||'CRITICAL',
         ai_data?.title||(r.Summary||'Recall').substring(0,100), ai_data?.risk||r.Consequence||'',
         ai_data?.remedy||r.Remedy||'', r.PotentialNumberOfUnitsAffected||null, ['NHTSA Official'], JSON.stringify(r)]
      );
      recallsStored++;
    }

    for (const t of rawTSBs) {
      const ai_data = await summarize(t, 'tsb');
      const id = t.tsbNumber || t.bulletinNumber || ('tsb-' + Date.now() + '-' + tsbsStored);
      await query(
        `INSERT INTO tsbs (id,vehicle_key,year,component,severity,title,summary,remedy,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,updated_at=NOW()`,
        [id, vehicle, yr, ai_data?.component||t.Component||'Unknown', ai_data?.severity||'MODERATE',
         ai_data?.title||t.tsbNumber||'TSB', ai_data?.summary||t.Summary||'',
         ai_data?.remedy||t.Summary||'', ['NHTSA Filed'], JSON.stringify(t)]
      );
      tsbsStored++;
    }

    await query(
      `INSERT INTO sweep_log (vehicle_key,year,recalls_found,tsbs_found,swept_at) VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (vehicle_key,year) DO UPDATE SET recalls_found=$3,tsbs_found=$4,swept_at=NOW()`,
      [vehicle, yr, recallsStored, tsbsStored]
    );

    res.json({ success: true, recalls: recallsStored, tsbs: tsbsStored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/submit
app.post('/api/submit', async (req, res) => {
  const { vehicle, year, title, detail, bulletin, sourceUrl, srcType } = req.body || {};
  if (!vehicle || !year || !title || !detail) return res.status(400).json({ error: 'vehicle, year, title and detail required' });
  const yr = parseInt(year);
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const existing = await query(
    `SELECT id, title, summary FROM community WHERE vehicle_key=$1 AND year=$2 AND status='active'`,
    [vehicle, yr]
  );

  let analysis = null;
  try {
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 600,
      system: `Vehicle service analyst. Match new report against existing records semantically. Return ONLY JSON: {"matchFound":true/false,"matchId":"id or null","matchConfidence":0.0-1.0,"component":"...","severity":"CRITICAL|MODERATE|LOW","cleanTitle":"max 8 words","summary":"2-3 sentences"}`,
      messages: [{ role: 'user', content: 'New: ' + JSON.stringify({ title, detail, bulletin }) + '\nExisting: ' + JSON.stringify(existing.slice(0,20).map(r => ({ id: r.id, title: r.title }))) }]
    });
    const match = (msg.content[0]?.text || '').match(/\{[\s\S]*?\}/);
    if (match) analysis = JSON.parse(match[0]);
  } catch {}

  if (analysis?.matchFound && analysis?.matchId) {
    await query(`UPDATE community SET confirmations=confirmations+1,updated_at=NOW() WHERE id=$1`, [analysis.matchId]);
    return res.json({ action: 'confirmed', matchId: analysis.matchId, confidence: analysis.matchConfidence });
  }

  const newId = 'usr-' + Date.now();
  await query(
    `INSERT INTO community (id,vehicle_key,year,component,severity,title,summary,remedy,bulletin_ref,source_pills,links,confirmations,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'','',$8,$9,1,'active')`,
    [newId, vehicle, yr, analysis?.component||'Unknown', analysis?.severity||'LOW',
     analysis?.cleanTitle||title, analysis?.summary||detail,
     [(srcType||'user') + ' — user submitted'],
     sourceUrl ? JSON.stringify([{ label: 'Source', type: srcType, url: sourceUrl }]) : '[]']
  );
  res.json({ action: 'created', id: newId });
});

// POST /api/research
app.post('/api/research', async (req, res) => {
  let { vehicle, year, text, srcType, srcUrl } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });

  // If no text but URL provided, fetch content from URL
  if (!text && srcUrl) {
    try {
      const fetchRes = await fetch(srcUrl, { headers: { 'User-Agent': 'EV-Service-Intelligence/1.0' } });
      if (!fetchRes.ok) throw new Error(`Failed to fetch URL: ${fetchRes.status}`);
      const contentType = fetchRes.headers.get('content-type') || '';
      if (contentType.includes('pdf')) {
        // For PDFs, send URL to Claude directly with a note
        text = `[PDF Document from ${srcUrl}] Please extract vehicle service issues from this NHTSA TSB PDF. URL: ${srcUrl}`;
      } else {
        text = await fetchRes.text();
        // Truncate if too long
        if (text.length > 15000) text = text.substring(0, 15000) + '... [truncated]';
      }
    } catch(e) {
      return res.status(400).json({ error: 'Could not fetch URL: ' + e.message });
    }
  }

  if (!text) return res.status(400).json({ error: 'text or srcUrl required' });
  const yr = parseInt(year);
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const existing = await query(
    `SELECT id, title FROM community WHERE vehicle_key=$1 AND year=$2 AND status='active'`,
    [vehicle, yr]
  );

  try {
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
      system: `Extract vehicle issues from owner text. Return ONLY a JSON array: [{"title":"...","component":"...","severity":"CRITICAL|MODERATE|LOW","summary":"2-3 sentences","symptoms":["..."],"remedy":"...","bulletinRef":"...","confidence":"HIGH|MEDIUM|LOW","likelyMatchId":"id or null","likelyMatchReason":"..."}]\nExisting: ${JSON.stringify(existing.map(r => ({ id: r.id, title: r.title })))}`,
      messages: [{ role: 'user', content: text }]
    });
    const txt = msg.content[0]?.text || '';
    const match = txt.match(/\[[\s\S]*\]/);
    const issues = match ? JSON.parse(match[0]) : [];

    const queued = [];
    for (const issue of issues) {
      const rows = await query(
        `INSERT INTO review_queue (vehicle_key,year,extracted,source_type,source_url,confidence,likely_match_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [vehicle, yr, JSON.stringify(issue), srcType||'unknown', srcUrl||null, issue.confidence||'MEDIUM', issue.likelyMatchId||null]
      );
      queued.push({ ...issue, queueId: rows[0]?.id });
    }
    res.json({ issues: queued, count: queued.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/approve
app.post('/api/approve', async (req, res) => {
  const { queueId, vehicle, year } = req.body || {};
  if (!queueId || !vehicle || !year) return res.status(400).json({ error: 'queueId, vehicle and year required' });

  const rows = await query(`SELECT * FROM review_queue WHERE id=$1 AND status='pending'`, [queueId]);
  if (!rows.length) return res.status(404).json({ error: 'Queue item not found' });

  const item = rows[0];
  const issue = typeof item.extracted === 'string' ? JSON.parse(item.extracted) : item.extracted;
  const newId = 'sweep-' + Date.now();

  await query(
    `INSERT INTO community (id,vehicle_key,year,component,severity,title,summary,symptoms,remedy,bulletin_ref,source_pills,links,confirmations,ai_sweep,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,TRUE,'active')`,
    [newId, vehicle, parseInt(year), issue.component||'Unknown', issue.severity||'LOW',
     issue.title||'Unknown Issue', issue.summary||'', issue.symptoms||[],
     issue.remedy||'', issue.bulletinRef||'AI research sweep',
     [(item.source_type||'sweep') + ' — AI sweep', 'Needs verification'],
     item.source_url ? JSON.stringify([{ label: 'Source', type: item.source_type, url: item.source_url }]) : '[]']
  );

  await query(`UPDATE review_queue SET status='approved',reviewed_at=NOW() WHERE id=$1`, [queueId]);
  res.json({ success: true, communityId: newId });
});

// ── ADD TSB DIRECTLY ────────────────────────
app.post('/api/tsb-add', async (req, res) => {
  try {
    const { vehicle, year, title, bulletin_ref, component, severity, summary, remedy, source_url } = req.body || {};
    if (!vehicle || !year || !title || !summary) return res.status(400).json({ error: 'vehicle, year, title and summary required' });
    const yr = parseInt(year);
    // Build id from bulletin ref or title
    const id = (bulletin_ref || title).toLowerCase().replace(/[^a-z0-9]+/g,'-').substring(0,40) + '-' + Date.now();
    // Store source_url and bulletin_ref in raw_nhtsa JSONB
    const raw = JSON.stringify({ bulletin_ref: bulletin_ref||null, source_url: source_url||null, remedy: remedy||null });
    const pills = '{NHTSA}';
    await query(
      `INSERT INTO tsbs (id, vehicle_key, year, title, component, severity, summary, remedy, source_pills, raw_nhtsa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [id, vehicle, yr, title, component||null, severity||'MODERATE', summary, remedy||null, pills, raw]
    );
    res.json({ ok: true });
  } catch(e) {
    console.error('tsb-add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── START ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EV Service Intelligence running on port ${PORT}`));
