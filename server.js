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
      connectSrc:      ["'self'", "https://api.anthropic.com"],
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
      // Store recalls directly from NHTSA — no AI needed, data is already structured
      const campaignRaw = r.NHTSACampaignNumber || r.recallId || '';
      // Normalize campaign ID: remove trailing zeros variation, lowercase, strip non-alphanumeric
      const id = campaignRaw.toLowerCase().replace(/[^a-z0-9]+/g,'-') || ('r-' + Date.now() + '-' + recallsStored);
      const title = (r.Component || r.Summary || 'Recall').substring(0, 120);
      const severity = (r.Consequence||'').toLowerCase().includes('crash') || (r.Consequence||'').toLowerCase().includes('injur') || (r.Consequence||'').toLowerCase().includes('fatal') ? 'CRITICAL' : 'MODERATE';
      await query(
        `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,risk=EXCLUDED.risk,remedy=EXCLUDED.remedy,severity=EXCLUDED.severity,raw_nhtsa=EXCLUDED.raw_nhtsa,updated_at=NOW()`,
        [id, vehicle, yr, r.Component||'Unknown', severity, title,
         r.Consequence||'', r.Remedy||'', r.PotentialNumberOfUnitsAffected||null, ['NHTSA Official'], JSON.stringify(r)]
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

// ── CLONE TSB TO MORE VEHICLES ──────────────
app.post('/api/tsb-clone', async (req, res) => {
  try {
    const { src_id, targets } = req.body || {};
    if (!src_id || !targets?.length) return res.status(400).json({ error: 'src_id and targets required' });

    // Fetch the source TSB
    const rows = await query(`SELECT * FROM tsbs WHERE id=$1`, [src_id]);
    if (!rows.length) return res.status(404).json({ error: 'Source TSB not found' });
    const src = rows[0];

    let count = 0;
    const bulletin = (src.raw_nhtsa && src.raw_nhtsa.bulletin_ref) ? src.raw_nhtsa.bulletin_ref.toLowerCase().replace(/[^a-z0-9]+/g,'-') : 'tsb';
    for (const { vehicle, year } of targets) {
      const newId = (vehicle + '-' + year + '-' + bulletin).toLowerCase().replace(/[^a-z0-9]+/g,'-').substring(0,60);
      await query(
        `INSERT INTO tsbs (id, vehicle_key, year, title, component, severity, summary, remedy, source_pills, raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [newId, vehicle, parseInt(year), src.title, src.component, src.severity, src.summary, src.remedy, src.source_pills, src.raw_nhtsa]
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch(e) {
    console.error('tsb-clone error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADD TSB DIRECTLY ────────────────────────
app.post('/api/tsb-add', async (req, res) => {
  try {
    const { vehicle, year, title, bulletin_ref, component, severity, summary, remedy, source_url } = req.body || {};
    if (!vehicle || !year || !title || !summary) return res.status(400).json({ error: 'vehicle, year, title and summary required' });
    const yr = parseInt(year);
    // Deterministic ID: vehicle + year + bulletin (no timestamp = no duplicates)
    const idBase = (vehicle + '-' + yr + '-' + (bulletin_ref || title)).toLowerCase().replace(/[^a-z0-9]+/g,'-').substring(0,60);
    const id = idBase;
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

// ── NHTSA DIRECT RECALL IMPORT ───────────────
// Fetches ALL recalls from NHTSA for a vehicle/year and stores directly — no AI
app.post('/api/nhtsa-import', async (req, res) => {
  const { vehicle, year } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  const v = VEHICLES[vehicle];
  if (!v) return res.status(400).json({ error: 'Unknown vehicle' });
  const yr = parseInt(year);
  try {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(v.nhtsa_model)}&modelYear=${yr}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: `NHTSA returned ${r.status}` });
    const data = await r.json();
    const recalls = data.results || data.Results || [];
    let stored = 0, skipped = 0;
    for (const rc of recalls) {
      const campaignRaw = rc.NHTSACampaignNumber || rc.recallId || '';
      const id = campaignRaw.toLowerCase().replace(/[^a-z0-9]+/g,'-') || ('r-'+Date.now()+'-'+stored);
      const title = (rc.Component || rc.Summary || 'Recall').substring(0, 120);
      const severity = (rc.Consequence||'').toLowerCase().match(/crash|injur|fatal|death/) ? 'CRITICAL' : 'MODERATE';
      const result = await query(
        `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title, risk=EXCLUDED.risk, remedy=EXCLUDED.remedy,
           severity=EXCLUDED.severity, raw_nhtsa=EXCLUDED.raw_nhtsa, updated_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [id, vehicle, yr, rc.Component||'Unknown', severity, title,
         rc.Consequence||'', rc.Remedy||'', rc.PotentialNumberOfUnitsAffected||null,
         ['NHTSA Official'], JSON.stringify(rc)]
      );
      result[0]?.inserted ? stored++ : skipped++;
    }
    res.json({ ok: true, found: recalls.length, stored, updated: skipped });
  } catch(e) {
    console.error('nhtsa-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── RECALL FETCH & EXTRACT ───────────────────
app.post('/api/recall-fetch', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    // Fetch the document
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching URL`);
    const contentType = r.headers.get('content-type') || '';
    const isPdf = contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf');

    let messageContent;
    if (isPdf) {
      // Fetch PDF as binary, encode as base64, send as document to Claude
      const buffer = await r.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      messageContent = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 }
        },
        {
          type: 'text',
          text: 'Extract the NHTSA recall fields from this document. Respond ONLY with valid JSON, no markdown. Fields: campaign (campaign number e.g. 25V404000), title (component/system affected), summary (defect description), risk (consequence if not fixed), remedy (what dealers will do), units (number of vehicles as string).'
        }
      ];
    } else {
      // HTML/text page - strip tags and truncate
      const text = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 12000);
      messageContent = `Extract NHTSA recall fields from this text. Respond ONLY with valid JSON. Fields: campaign, title, summary, risk, remedy, units.

${text}`;
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You extract NHTSA recall data. Respond ONLY with a valid JSON object, no markdown fences, no explanation.
Fields to extract:
- campaign: NHTSA campaign number (e.g. 25V404000)
- title: component/system affected (e.g. SERVICE BRAKES, HYDRAULIC)
- summary: full defect description
- risk: consequence if not fixed
- remedy: what dealers will do to fix it
- units: number of vehicles affected as a string
- affected_vehicles: array of objects with keys "vehicle" and "years" (array of ints). 
  Map vehicle names to: "equinox_ev" for Chevrolet Equinox EV, "blazer_ev" for Chevrolet Blazer EV, "mach_e" for Ford Mustang Mach-E.
  Example: [{"vehicle":"mach_e","years":[2021,2022,2023,2024,2025]},{"vehicle":"equinox_ev","years":[2024,2025]}]
  Only include vehicles that are actually mentioned. Use empty array if none of our three vehicles are affected.
If any field is not found use empty string or empty array.`,
        messages: [{ role: 'user', content: messageContent }]
      })
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message || 'Claude API error');
    const raw = aiData.content?.[0]?.text || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const extracted = JSON.parse(cleaned);
    res.json(extracted);
  } catch(e) {
    console.error('recall-fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── RECALL DIRECT ADD ─────────────────────────
app.post('/api/recall-add', async (req, res) => {
  try {
    const { vehicle, year, campaign_id, tc_campaign_id, title, summary, risk, remedy, affected_units, severity, source_url, source } = req.body || {};
    if (!vehicle || !year || !title || !summary) return res.status(400).json({ error: 'vehicle, year, title and summary required' });
    const yr = parseInt(year);
    const primaryId = source === 'tc' ? (tc_campaign_id || title) : (campaign_id || title);
    const id = primaryId.toLowerCase().replace(/[^a-z0-9]+/g,'-').substring(0,60);
    const pillsArr = source === 'tc'   ? ['Transport Canada']
                   : source === 'both' ? ['NHTSA Official','Transport Canada']
                   :                    ['NHTSA Official'];
    const pills = '{' + pillsArr.join(',') + '}';
    const raw = JSON.stringify({ campaign_id, tc_campaign_id, source_url, affected_units });

    await query(
      `INSERT INTO recalls (id, vehicle_key, year, title, risk, remedy, severity, source_pills, raw_nhtsa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title, risk=EXCLUDED.risk,
         remedy=EXCLUDED.remedy, updated_at=NOW()`,
      [id, vehicle, yr, title, (summary||risk)||'', remedy||'', severity||'MODERATE', pills, raw]
    );
    res.json({ ok: true });
  } catch(e) {
    console.error('recall-add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── VIN PROXY ENDPOINTS ─────────────────────
app.get('/api/vin-decode', async (req, res) => {
  const { vin } = req.query;
  if (!vin || vin.length !== 17) return res.status(400).json({ error: 'Valid 17-char VIN required' });
  try {
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`);
    const data = await r.json();
    res.json(data);
  } catch(e) {
    console.error('vin-decode error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vin-recalls', async (req, res) => {
  const { vin, make, model, year } = req.query;
  if (!vin || vin.length !== 17) return res.status(400).json({ error: 'Valid 17-char VIN required' });
  try {
    // Step 1: Get unrepaired recalls for this specific VIN
    const vinRes = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicleId?vinId=${encodeURIComponent(vin)}`);
    const vinData = await vinRes.json();
    const unrepairedIds = new Set((vinData.results||[]).map(r => r.NHTSACampaignNumber||''));

    // Step 2: Get ALL recalls ever issued for this make/model/year
    // Try multiple model name variations - NHTSA may use different names than VIN decode
    let allRecalls = [];
    if (make && model && year) {
      const modelVariants = [model];
      // Add EV suffix variants for known EV models
      if (!model.toUpperCase().includes('EV')) modelVariants.push(model + ' EV');
      // Add common NHTSA alternate names
      if (model.toUpperCase() === 'EQUINOX') modelVariants.push('EQUINOX EV', 'Equinox EV');
      if (model.toUpperCase() === 'BLAZER') modelVariants.push('BLAZER EV', 'Blazer EV');
      if (model.toUpperCase().includes('MUSTANG') || model.toUpperCase().includes('MACH')) {
        modelVariants.push('Mustang Mach-E', 'MUSTANG MACH-E');
      }

      for (const m of modelVariants) {
        const allRes = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(m)}&modelYear=${encodeURIComponent(year)}`);
        const allData = await allRes.json();
        const found = allData.results || [];
        if (found.length) { allRecalls = found; break; }
      }
      console.log(`vin-recalls: ${make} ${model} ${year} → ${allRecalls.length} recalls found`);
    }

    // Step 2b: If still no results, VIN-based endpoint may have them as "unrepaired"
    // Merge unrepaired into allRecalls if allRecalls is empty
    if (!allRecalls.length && vinData.results && vinData.results.length) {
      allRecalls = vinData.results;
      console.log(`vin-recalls: falling back to VIN-direct results: ${allRecalls.length}`);
    }

    // Step 3: Tag each recall as outstanding or completed
    const tagged = allRecalls.map(r => ({
      ...r,
      isOutstanding: unrepairedIds.has(r.NHTSACampaignNumber),
      completionDate: unrepairedIds.has(r.NHTSACampaignNumber) ? null : 'Remedied'
    }));

    // If no make/model/year provided, just return VIN-specific unrepaired
    const results = tagged.length ? tagged : (vinData.results||[]).map(r => ({...r, isOutstanding: true}));
    res.json({ results, unrepairedCount: unrepairedIds.size, totalCount: results.length });
  } catch(e) {
    console.error('vin-recalls error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── VIN RECALL IMPORT ───────────────────────
app.post('/api/vin-import', async (req, res) => {
  try {
    const { vehicle, year, recalls } = req.body || {};
    if (!vehicle || !year || !recalls?.length) return res.status(400).json({ error: 'vehicle, year and recalls required' });
    const yr = parseInt(year);
    let count = 0;

    for (const r of recalls) {
      const campaignId = (r.NHTSACampaignNumber || r.recallId || '').toLowerCase().replace(/[^a-z0-9]+/g,'-');
      if (!campaignId) continue;
      const id = `${vehicle}-${yr}-${campaignId}`;
      const title = r.Component || r.component || 'Unknown Component';
      const summary = r.Summary || r.summary || r.Consequence || r.consequence || '';
      const remedy  = r.Remedy  || r.remedy  || '';
      const risk    = r.Consequence || r.consequence || '';
      const pills   = '{NHTSA Official}';
      const raw     = JSON.stringify(r);

      await query(
        `INSERT INTO recalls (id, vehicle_key, year, title, risk, remedy, source_pills, raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [id, vehicle, yr, title, summary||risk||'', remedy||'', pills, raw]
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch(e) {
    console.error('vin-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN ENDPOINTS ─────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || 'gazunni-admin';

function checkAdmin(req, res) {
  const { key } = req.body || {};
  if (key !== ADMIN_KEY) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

app.post('/api/admin/dedupe', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    let total = 0;

    // 1. Dedupe TSBs by vehicle+year+bulletin_ref, then by title
    const tsbRef = await query(`
      DELETE FROM tsbs WHERE ctid NOT IN (
        SELECT MIN(ctid) FROM tsbs
        WHERE bulletin_ref IS NOT NULL AND bulletin_ref != ''
        GROUP BY vehicle_key, year, bulletin_ref
      ) AND bulletin_ref IS NOT NULL AND bulletin_ref != ''
    `);
    total += tsbRef.length || 0;

    const tsbTitle = await query(`
      DELETE FROM tsbs WHERE ctid NOT IN (
        SELECT MIN(ctid) FROM tsbs GROUP BY vehicle_key, year, title
      )
    `);
    total += tsbTitle.length || 0;

    // 2. Dedupe recalls by NHTSA campaign number extracted from raw_nhtsa
    // Keep the row with most data (prefer manually added with source_url over sweep)
    const dupCampaigns = await query(`
      SELECT vehicle_key, year, raw_nhtsa->>'NHTSACampaignNumber' as campaign
      FROM recalls
      WHERE raw_nhtsa->>'NHTSACampaignNumber' IS NOT NULL
      GROUP BY vehicle_key, year, raw_nhtsa->>'NHTSACampaignNumber'
      HAVING COUNT(*) > 1
    `);

    for (const dup of dupCampaigns) {
      // Keep row with source_url if exists, otherwise keep oldest
      await query(`
        DELETE FROM recalls WHERE id IN (
          SELECT id FROM recalls
          WHERE vehicle_key=$1 AND year=$2
            AND raw_nhtsa->>'NHTSACampaignNumber'=$3
          ORDER BY
            CASE WHEN raw_nhtsa->>'source_url' IS NOT NULL THEN 0 ELSE 1 END,
            created_at ASC
          OFFSET 1
        )
      `, [dup.vehicle_key, dup.year, dup.campaign]);
      total++;
    }

    // 3. Dedupe recalls by vehicle+year+title (catches manual + sweep same recall)
    const recallTitle = await query(`
      DELETE FROM recalls WHERE ctid NOT IN (
        SELECT MIN(ctid) FROM recalls GROUP BY vehicle_key, year, LOWER(TRIM(title))
      )
    `);
    total += recallTitle.length || 0;

    res.json({ message: total > 0
      ? `✓ Removed ${total} duplicate rows (recalls + TSBs)`
      : '✓ No duplicates found' });
  } catch(e) {
    console.error('dedupe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/recall-audit', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    // Find recalls that look like duplicates (same vehicle+year, similar title)
    const all = await query(`
      SELECT id, vehicle_key, year, title, created_at,
             raw_nhtsa->>'NHTSACampaignNumber' as campaign
      FROM recalls ORDER BY vehicle_key, year, title
    `);
    // Group by vehicle+year, find title overlaps
    const groups = {};
    for (const r of all) {
      const key = r.vehicle_key + '-' + r.year;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    const dupes = [];
    for (const [key, rows] of Object.entries(groups)) {
      // Find rows with same campaign number
      const byCampaign = {};
      for (const r of rows) {
        if (r.campaign) {
          if (!byCampaign[r.campaign]) byCampaign[r.campaign] = [];
          byCampaign[r.campaign].push(r);
        }
      }
      for (const [camp, campRows] of Object.entries(byCampaign)) {
        if (campRows.length > 1) dupes.push({ reason: 'same_campaign', campaign: camp, rows: campRows });
      }
    }
    res.json({ total: all.length, duplicates: dupes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/stats', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const tables = ['recalls','tsbs','community','review_queue','sweep_log'];
    const counts = await Promise.all(tables.map(t => query(`SELECT COUNT(*) FROM ${t}`).then(r => `${t}: ${r[0].count}`)));
    res.json({ message: counts.join(' · ') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/clear-sweep', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const result = await query(`DELETE FROM sweep_log`);
    res.json({ message: `✓ Sweep log cleared (${result.rowCount || 0} rows)` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/clear-queue', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const result = await query(`DELETE FROM review_queue WHERE status='pending'`);
    res.json({ message: `✓ Cleared ${result.rowCount || 0} pending queue items` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── START ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`EV Service Intelligence running on port ${PORT}`));
