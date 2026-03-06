import { Router } from 'express';
import { query } from '../services/database.js';
import { VEHICLES, fetchNHTSARecalls, fetchAllNHTSARecalls, canonicalRecallId, detectSeverity } from '../services/nhtsa.js';
import { extractRecallFromUrl, extractRecallFromBase64, summarizeRecall, summarizeTSB, validateRecallExtraction } from '../services/ai.js';
import { fetchNHTSATSBs } from '../services/nhtsa.js';

const router = Router();

function normalizeCampaignId(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function scopedRecallId(vehicle, year, campaignId, fallback) {
  if (!campaignId) return fallback;
  return `${vehicle}:${year}:${campaignId}`;
}

async function findRecallRowForContext(vehicle, year, campaignId) {
  if (!campaignId) return null;
  const rows = await query(
    `SELECT id
       FROM recalls
      WHERE vehicle_key = $1
        AND year = $2
        AND (
          UPPER(REGEXP_REPLACE(COALESCE(id,''), '[^A-Z0-9]', '', 'g')) = $3
          OR UPPER(REGEXP_REPLACE(COALESCE(raw_nhtsa->>'NHTSACampaignNumber', raw_nhtsa->>'campaign_id', ''), '[^A-Z0-9]', '', 'g')) = $3
        )
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1`,
    [vehicle, year, campaignId]
  );
  return rows[0] || null;
}

async function upsertRecallForContext({ vehicle, year, campaignId, component, severity, title, risk, remedy, affectedUnits, sourcePills, rawNhtsa, status='active' }) {
  const existing = campaignId ? await findRecallRowForContext(vehicle, year, campaignId) : null;
  const fallbackId = `r-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const rowId = existing?.id || scopedRecallId(vehicle, year, campaignId, fallbackId) || fallbackId;
  const rows = await query(
    `INSERT INTO recalls (id,vehicle_key,year,component,severity,title,risk,remedy,affected_units,source_pills,raw_nhtsa,status,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (id) DO UPDATE SET
       component=EXCLUDED.component,
       severity=EXCLUDED.severity,
       title=EXCLUDED.title,
       risk=EXCLUDED.risk,
       remedy=EXCLUDED.remedy,
       affected_units=EXCLUDED.affected_units,
       source_pills=EXCLUDED.source_pills,
       raw_nhtsa=EXCLUDED.raw_nhtsa,
       status=CASE WHEN recalls.status = 'suppressed' THEN recalls.status ELSE EXCLUDED.status END,
       updated_at=NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [rowId, vehicle, year, component, severity, title, risk, remedy, affectedUnits, sourcePills, rawNhtsa, status]
  );
  return { id: rowId, inserted: !!rows[0]?.inserted, existed: !!existing };
}

// ── GET RECALLS ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { vehicle, year } = req.query;
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });
  try {
    const rows = await query(
      req.query.includeSuppressed
        ? `SELECT * FROM recalls WHERE vehicle_key=$1 AND year=$2 ORDER BY created_at DESC`
        : `SELECT * FROM recalls WHERE vehicle_key=$1 AND year=$2 AND COALESCE(status,'active') != 'suppressed' ORDER BY created_at DESC`,
      [vehicle, parseInt(year)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NHTSA DIRECT IMPORT ───────────────────────────────────────────────────
router.post('/nhtsa-import', async (req, res) => {
  const { vehicle, year } = req.body || {};
  if (!vehicle) return res.status(400).json({ error: 'vehicle required' });
  if (!VEHICLES[vehicle]) return res.status(400).json({ error: 'Unknown vehicle' });
  const yr = year ? parseInt(year) : null;
  try {
    const recalls = yr ? await fetchNHTSARecalls(vehicle, yr) : await fetchAllNHTSARecalls(vehicle);
    const importMap = new Map();
    for (const rc of recalls) {
      const id = canonicalRecallId(rc.NHTSACampaignNumber || rc.recallId, null);
      if (!id) { importMap.set('fallback-' + importMap.size, rc); continue; }
      if (importMap.has(id)) {
        const ex = importMap.get(id);
        const newComp = rc.Component || '';
        if (newComp && !(ex.Component||'').includes(newComp))
          ex.Component = ((ex.Component||'') + ' / ' + newComp).substring(0, 120);
      } else {
        importMap.set(id, { ...rc });
      }
    }
    const dedupedRecalls = Array.from(importMap.values());
    let stored = 0, updated = 0;

    for (const rc of dedupedRecalls) {
      const campaignId = normalizeCampaignId(rc.NHTSACampaignNumber || rc.recallId);
      const title = (rc.Component || rc.Summary || 'Recall').substring(0, 120);
      const severity = detectSeverity(rc.Consequence);
      const recallYear = yr || parseInt(rc.ModelYear || rc.modelYear || 0) || 2024;
      const result = await upsertRecallForContext({
        vehicle,
        year: recallYear,
        campaignId,
        component: rc.Component || 'Unknown',
        severity,
        title,
        risk: rc.Consequence || '',
        remedy: rc.Remedy || '',
        affectedUnits: rc.PotentialNumberOfUnitsAffected || null,
        sourcePills: ['NHTSA Official'],
        rawNhtsa: JSON.stringify(rc),
      });
      result.inserted ? stored++ : updated++;
    }
    res.json({ ok: true, found: recalls.length, stored, updated });
  } catch (e) {
    console.error('nhtsa-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FETCH & EXTRACT FROM PDF/URL ──────────────────────────────────────────
router.post('/fetch', async (req, res) => {
  const { url, pdfBase64, filename } = req.body || {};
  if (!url && !pdfBase64) return res.status(400).json({ error: 'url or pdfBase64 required' });
  try {
    const raw = pdfBase64
      ? await extractRecallFromBase64(pdfBase64, filename || 'upload.pdf')
      : await extractRecallFromUrl(url);
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
    const primaryId = source === 'tc' ? (tc_campaign_id || campaign_id || '') : (campaign_id || tc_campaign_id || '');
    const campaignId = normalizeCampaignId(primaryId);
    const pillsArr = source === 'tc'   ? ['Transport Canada']
                   : source === 'both' ? ['NHTSA Official', 'Transport Canada']
                   :                    ['NHTSA Official'];
    const raw = JSON.stringify({ campaign_id, tc_campaign_id, source_url, affected_units });
    const result = await upsertRecallForContext({
      vehicle,
      year: yr,
      campaignId,
      component: title || 'Unknown',
      severity: severity || 'MODERATE',
      title,
      risk: (summary || risk) || '',
      remedy: remedy || '',
      affectedUnits: affected_units || null,
      sourcePills: pillsArr,
      rawNhtsa: raw,
    });
    res.json({ ok: true, inserted: result.inserted, updated: !result.inserted, id: result.id });
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

    let recallsStored = 0, recallsUpdated = 0, tsbsStored = 0;

    const recallMap = new Map();
    for (const r of rawRecalls) {
      const id = canonicalRecallId(r.NHTSACampaignNumber || r.recallId, null);
      if (!id) { recallMap.set('fallback-' + recallMap.size, r); continue; }
      if (recallMap.has(id)) {
        const existing = recallMap.get(id);
        const existComp = existing.Component || '';
        const newComp   = r.Component || '';
        if (newComp && !existComp.includes(newComp)) {
          existing.Component = (existComp + ' / ' + newComp).substring(0, 120);
        }
      } else {
        recallMap.set(id, { ...r });
      }
    }
    const deduped = Array.from(recallMap.values());

    for (const r of deduped) {
      const campaignId = normalizeCampaignId(r.NHTSACampaignNumber || r.recallId);
      const title = (r.Component || r.Summary || 'Recall').substring(0, 120);
      const result = await upsertRecallForContext({
        vehicle,
        year: yr,
        campaignId,
        component: r.Component || 'Unknown',
        severity: detectSeverity(r.Consequence),
        title,
        risk: r.Consequence || '',
        remedy: r.Remedy || '',
        affectedUnits: r.PotentialNumberOfUnitsAffected || null,
        sourcePills: ['NHTSA Official'],
        rawNhtsa: JSON.stringify(r),
      });
      result.inserted ? recallsStored++ : recallsUpdated++;
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
      [vehicle, yr, recallsStored + recallsUpdated, tsbsStored]
    );

    res.json({ success: true, recalls: recallsStored, recallUpdates: recallsUpdated, tsbs: tsbsStored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
