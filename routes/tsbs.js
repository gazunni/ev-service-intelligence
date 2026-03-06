import { Router } from 'express';
import { query } from '../services/database.js';
import { extractTSBFromUrl, extractTSBFromBase64, validateTSBExtraction } from '../services/ai.js';

const router = Router();

// ── GET TSBs ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { vehicle, year } = req.query;
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  try {
    const rows = await query(
      `SELECT * FROM tsbs WHERE vehicle_key=$1 AND year=$2 AND COALESCE(status,'active') != 'suppressed' ORDER BY created_at DESC`,
      [vehicle, parseInt(year)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FETCH & EXTRACT FROM PDF/URL ──────────────────────────────────────────
router.post('/fetch', async (req, res) => {
  const { url, pdfBase64, filename } = req.body || {};
  if (!url && !pdfBase64) return res.status(400).json({ error: 'url or pdfBase64 required' });
  try {
    const raw = pdfBase64
      ? await extractTSBFromBase64(pdfBase64, filename || 'upload.pdf')
      : await extractTSBFromUrl(url);
    const data = validateTSBExtraction(raw);
    res.json(data);
  } catch (e) {
    console.error('tsb-fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADD TSB DIRECTLY ──────────────────────────────────────────────────────
router.post('/add', async (req, res) => {
  const { vehicle, year, title, bulletin_ref, component, severity, summary, remedy, source_url } = req.body || {};
  if (!vehicle || !year || !title || !summary)
    return res.status(400).json({ error: 'vehicle, year, title and summary required' });
  try {
    const yr = parseInt(year);
    const id = (vehicle + '-' + yr + '-' + (bulletin_ref || title))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const raw = JSON.stringify({ bulletin_ref: bulletin_ref || null, source_url: source_url || null, remedy: remedy || null });
    await query(
      `INSERT INTO tsbs (id,vehicle_key,year,title,component,severity,summary,remedy,source_pills,raw_nhtsa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [id, vehicle, yr, title, component || null, severity || 'MODERATE', summary, remedy || null, '{NHTSA}', raw]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('tsb-add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── CLONE TSB TO ADDITIONAL VEHICLES ─────────────────────────────────────
router.post('/clone', async (req, res) => {
  const { src_id, targets } = req.body || {};
  if (!src_id || !targets?.length)
    return res.status(400).json({ error: 'src_id and targets required' });
  try {
    const rows = await query(`SELECT * FROM tsbs WHERE id=$1`, [src_id]);
    if (!rows.length) return res.status(404).json({ error: 'Source TSB not found' });
    const src = rows[0];
    const bulletin = src.raw_nhtsa?.bulletin_ref
      ? src.raw_nhtsa.bulletin_ref.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      : 'tsb';
    let count = 0;
    for (const { vehicle, year } of targets) {
      const newId = (vehicle + '-' + year + '-' + bulletin).toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
      await query(
        `INSERT INTO tsbs (id,vehicle_key,year,title,component,severity,summary,remedy,source_pills,raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [newId, vehicle, parseInt(year), src.title, src.component, src.severity, src.summary, src.remedy, src.source_pills, src.raw_nhtsa]
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch (e) {
    console.error('tsb-clone error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
