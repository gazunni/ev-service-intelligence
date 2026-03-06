import { Router } from 'express';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls } from '../services/nhtsa.js';

const router = Router();

function normalizeVin(vin) {
  return String(vin || '').trim().toUpperCase();
}

function isValidVin(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function canonicalCampaignId(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function pickRecallArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
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

// ── DECODE VIN ────────────────────────────────────────────────────────────
router.get('/decode', async (req, res) => {
  const vin = normalizeVin(req.query?.vin);
  if (!isValidVin(vin)) {
    return res.status(400).json({ error: 'Valid 17-char VIN required' });
  }

  try {
    const data = await decodeVIN(vin);
    res.json(data);
  } catch (e) {
    console.error('vin-decode error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/lookup', async (req, res) => {
  const vin = normalizeVin(req.body?.vin);
  if (!isValidVin(vin)) {
    return res.status(400).json({ error: 'Valid 17-char VIN required' });
  }

  try {
    const data = await decodeVIN(vin);
    res.json(data);
  } catch (e) {
    console.error('vin-lookup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FETCH VIN-SPECIFIC RECALLS ────────────────────────────────────────────
router.get('/recalls', async (req, res) => {
  const vin = normalizeVin(req.query?.vin);
  const make = String(req.query?.make || '').trim();
  const model = String(req.query?.model || '').trim();
  const year = String(req.query?.year || '').trim();

  if (!isValidVin(vin)) {
    return res.status(400).json({ error: 'Valid 17-char VIN required' });
  }

  try {
    const data = await fetchVINRecalls(vin, make, model, year);
    res.json(data);
  } catch (e) {
    console.error('vin-recalls error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── IMPORT VIN RECALLS TO DB ──────────────────────────────────────────────
router.post('/import', async (req, res) => {
  const vehicle = String(req.body?.vehicle || '').trim();
  const year = parseInt(req.body?.year, 10);
  const vin = normalizeVin(req.body?.vin);
  const make = String(req.body?.make || '').trim();
  const model = String(req.body?.model || '').trim();

  if (!vehicle || !Number.isInteger(year)) {
    return res.status(400).json({ error: 'vehicle, year and recalls required' });
  }

  try {
    let recalls = pickRecallArray(req.body?.recalls);

    if (!recalls.length && isValidVin(vin)) {
      const recallData = await fetchVINRecalls(vin, make, model, String(year));
      recalls = pickRecallArray(recallData);
    }

    if (!recalls.length) {
      return res.status(400).json({ error: 'vehicle, year and recalls required' });
    }

    let inserted = 0;
    let existing = 0;
    let skipped = 0;

    for (const r of recalls) {
      const campaignRaw = r.NHTSACampaignNumber || r.recallId || r.campaign_id || '';
      const campaignId = canonicalCampaignId(campaignRaw);
      if (!campaignId) {
        skipped++;
        continue;
      }

      const title =
        r.Component ||
        r.component ||
        r.Summary ||
        r.summary ||
        'Unknown Component';

      const risk =
        r.Summary ||
        r.summary ||
        r.Consequence ||
        r.consequence ||
        '';

      const remedy = r.Remedy || r.remedy || '';
      const existingRow = await findRecallRowForContext(vehicle, year, campaignId);
      const rowId = existingRow?.id || scopedRecallId(vehicle, year, campaignId, `r-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
      const rows = await query(
        `INSERT INTO recalls (id, vehicle_key, year, title, risk, remedy, source_pills, raw_nhtsa, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           title=EXCLUDED.title,
           risk=EXCLUDED.risk,
           remedy=EXCLUDED.remedy,
           source_pills=EXCLUDED.source_pills,
           raw_nhtsa=EXCLUDED.raw_nhtsa,
           updated_at=NOW()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          rowId,
          vehicle,
          year,
          title,
          risk,
          remedy,
          ['NHTSA Official'],
          JSON.stringify(r),
        ]
      );

      if (rows[0]?.inserted) inserted++;
      else if (existingRow) existing++;
      else skipped++;
    }

    res.json({ ok: true, count: inserted, inserted, existing, skipped });
  } catch (e) {
    console.error('vin-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
