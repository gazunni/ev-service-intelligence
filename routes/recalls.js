import { Router } from 'express';
import { query } from '../services/database.js';
import { VEHICLES, fetchNHTSARecalls, canonicalRecallId, detectSeverity } from '../services/nhtsa.js';
import { extractRecallFromUrl, summarizeRecall, summarizeTSB, validateRecallExtraction } from '../services/ai.js';
import { fetchNHTSATSBs } from '../services/nhtsa.js';

const router = Router();

// ── GET RECALLS ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
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

// ── NHTSA DIRECT IMPORT ───────────────────────────────────────────────────
router.post('/nhtsa-import', async (req, res) => {
  const { vehicle, year } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  if (!VEHICLES[vehicle]) return res.status(400).json({ error: 'Unknown vehicle' });
  const yr = parseInt(year);
  try {
    const recalls = await fetchNHTSARecalls(vehicle, yr);
    let stored = 0, skipped = 0;

    for (const rc of recalls) {
      const id = canonicalRecallId(rc.NHTSACampaignNumber || rc.recallId, 'r-' + Date.now() + '-' + stored);
      const title = (rc.Component || rc.Summary || 'Recall').substring(0, 120);
      const severity = detectSeverity(rc.Consequence);
      const result = await query(
        `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title, risk=EXCLUDED.risk, remedy=EXCLUDED.remedy,
           severity=EXCLUDED.severity, raw_nhtsa=EXCLUDED.raw_nhtsa, updated_at=NOW()
         RETURNING (xmax = 0) AS inserted`,
        [id, vehicle, yr, rc.Component || 'Unknown', severity, title,
         rc.Consequence || '', rc.Remedy || '', rc.PotentialNumberOfUnitsAffected || null,
         ['NHTSA Official'], JSON.stringify(rc)]
      );
      result[0]?.inserted ? stored++ : skipped++;
    }
    res.json({ ok: true, found: recalls.length, stored, updated: skipped });
  } catch (e) {
    console.error('nhtsa-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FETCH & EXTRACT FROM PDF/URL ──────────────────────────────────────────
router.post('/fetch', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const raw = await extractRecallFromUrl(url);
    const data = validateRecallExtraction(raw);
    res.json(data);
  } catch (e) {
    console.error('recall-fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADD RECALL DIRECTLY ───────────────────────────────────────────────────
router.post('/add', async (req, res) => {
  const { vehicle, year, campaign_id, tc_campaign_id, title, summary, risk, remedy,
          affected_units, severity, source_url, source } = req.body || {};
  if (!vehicle || !year || !title || !summary)
    return res.status(400).json({ error: 'vehicle, year, title and summary required' });
  try {
    const yr = parseInt(year);
    const primaryId = source === 'tc' ? (tc_campaign_id || title) : (campaign_id || title);
    const rawId = primaryId.replace(/[^A-Za-z0-9]/g, '');
    const id = rawId.length <= 12 && rawId.length >= 6 && /\d/.test(rawId)
      ? rawId.toUpperCase()
      : primaryId.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
    const pillsArr = source === 'tc'   ? ['Transport Canada']
                   : source === 'both' ? ['NHTSA Official', 'Transport Canada']
                   :                    ['NHTSA Official'];
    const pills = '{' + pillsArr.join(',') + '}';
    const raw = JSON.stringify({ campaign_id, tc_campaign_id, source_url, affected_units });
    await query(
      `INSERT INTO recalls (id,vehicle_key,year,title,risk,remedy,severity,source_pills,raw_nhtsa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, risk=EXCLUDED.risk, remedy=EXCLUDED.remedy, updated_at=NOW()`,
      [id, vehicle, yr, title, (summary || risk) || '', remedy || '', severity || 'MODERATE', pills, raw]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('recall-add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── AI SWEEP (recalls + TSBs for one vehicle/year) ────────────────────────
router.post('/sweep', async (req, res) => {
  const { vehicle, year } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  const v = VEHICLES[vehicle];
  if (!v) return res.status(400).json({ error: 'Unknown vehicle' });
  const yr = parseInt(year);
  try {
    const [rawRecalls, rawTSBs] = await Promise.all([
      fetchNHTSARecalls(vehicle, yr),
      fetchNHTSATSBs(vehicle, yr),
    ]);

    let recallsStored = 0, tsbsStored = 0;

    for (const r of rawRecalls) {
      const id = canonicalRecallId(r.NHTSACampaignNumber || r.recallId, 'r-' + Date.now() + '-' + recallsStored);
      const title = (r.Component || r.Summary || 'Recall').substring(0, 120);
      await query(
        `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,risk=EXCLUDED.risk,remedy=EXCLUDED.remedy,severity=EXCLUDED.severity,raw_nhtsa=EXCLUDED.raw_nhtsa,updated_at=NOW()`,
        [id, vehicle, yr, r.Component || 'Unknown', detectSeverity(r.Consequence), title,
         r.Consequence || '', r.Remedy || '', r.PotentialNumberOfUnitsAffected || null, ['NHTSA Official'], JSON.stringify(r)]
      );
      recallsStored++;
    }

    for (const t of rawTSBs) {
      const ai_data = await summarizeTSB(t, `${v.make} ${v.model}`);
      const id = t.tsbNumber || t.bulletinNumber || ('tsb-' + Date.now() + '-' + tsbsStored);
      await query(
        `INSERT INTO tsbs (id,vehicle_key,year,component,severity,title,summary,remedy,source_pills,raw_nhtsa,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,updated_at=NOW()`,
        [id, vehicle, yr, ai_data?.component || t.Component || 'Unknown', ai_data?.severity || 'MODERATE',
         ai_data?.title || t.tsbNumber || 'TSB', ai_data?.summary || t.Summary || '',
         ai_data?.remedy || t.Summary || '', ['NHTSA Filed'], JSON.stringify(t)]
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

export default router;
