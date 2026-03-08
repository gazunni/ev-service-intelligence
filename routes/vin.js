//vin.js
import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls, VEHICLES } from '../services/nhtsa.js';

const router = Router();


function decodeField(fields, id) {
  return (fields.find(f => f.VariableId === id) || {}).Value || '';
}

function detectVehicleKey(make = '', model = '', vin = '') {
  const mk = String(make || '').toLowerCase().trim();
  const md = String(model || '').toLowerCase().trim();
  const v  = String(vin || '').toUpperCase().trim();

  if (mk.includes('chevrolet') || mk.includes('chevy')) {
    if (md.includes('equinox')) return 'equinox_ev';
    if (md.includes('blazer')) return 'blazer_ev';
    if (md.includes('bolt euv')) return 'bolt_euv';
    if (md.includes('bolt')) {
      if (v.startsWith('1G1FZ6EV') || v.startsWith('1G1FY6EV')) return 'bolt_ev_gen2';
      return 'bolt_ev';
    }
  }
  if (mk.includes('ford')) {
    if (md.includes('mach') || md.includes('mustang')) return 'mach_e';
  }
  if (mk.includes('honda')) {
    if (md.includes('prologue')) return 'honda_prologue';
  }
  if (mk.includes('tesla')) {
    if (md.includes('model 3') || md === '3') return 'tesla_model_3';
    if (md.includes('model y') || md === 'y') return 'tesla_model_y';
  }
  return '';
}

function maskVin(vin = '') {
  const clean = String(vin || '').trim().toUpperCase();
  if (clean.length !== 17) return clean;
  return clean.slice(0, 8) + '*****' + clean.slice(-4);
}

function hashVin(vin = '') {
  return crypto.createHash('sha256').update(String(vin || '').trim().toUpperCase()).digest('hex');
}

async function logVinSeen(vin, make, model, year, trim) {
  const vehicleKey = detectVehicleKey(make, model, vin);
  const yr = parseInt(year, 10);
  if (!vehicleKey || !Number.isInteger(yr)) return;

  const vinHash = hashVin(vin);
  const maskedVin = maskVin(vin);

  await query(
    `INSERT INTO vin_seen (vin_hash, masked_vin, vehicle_key, year, make, model, trim, last_seen_at, seen_count, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),1,'vin_lookup')
     ON CONFLICT (vin_hash) DO UPDATE SET
       last_seen_at = NOW(),
       seen_count = vin_seen.seen_count + 1,
       vehicle_key = EXCLUDED.vehicle_key,
       year = EXCLUDED.year,
       make = EXCLUDED.make,
       model = EXCLUDED.model,
       trim = COALESCE(EXCLUDED.trim, vin_seen.trim)`,
    [vinHash, maskedVin, vehicleKey, yr, make || null, model || null, trim || null]
  );
}


// ── DECODE VIN ────────────────────────────────────────────────────────────
router.get('/decode', async (req, res) => {
  const { vin } = req.query;
  if (!vin || vin.length !== 17) return res.status(400).json({ error: 'Valid 17-char VIN required' });
  try {
    const decoded = await decodeVIN(vin);
    try {
      const fields = decoded.Results || decoded.results || [];
      const make = decodeField(fields, 26);
      const model = decodeField(fields, 28);
      const year = decodeField(fields, 29);
      const trim = decodeField(fields, 38);
      await logVinSeen(vin, make, model, year, trim);
    } catch (logErr) {
      console.error('vin-seen log error:', logErr.message);
    }
    res.json(decoded);
  } catch (e) {
    console.error('vin-decode error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FETCH VIN-SPECIFIC RECALLS ────────────────────────────────────────────
router.get('/recalls', async (req, res) => {
  const { vin, make, model, year } = req.query;
  if (!vin || vin.length !== 17) return res.status(400).json({ error: 'Valid 17-char VIN required' });
  try {
    res.json(await fetchVINRecalls(vin, make, model, year));
  } catch (e) {
    console.error('vin-recalls error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── IMPORT VIN RECALLS TO DB ──────────────────────────────────────────────
function normalizeVehicleKey(raw = '') {
  const key = String(raw || '').trim();
  return Object.prototype.hasOwnProperty.call(VEHICLES, key) ? key : '';
}

function extractCampaignId(r = {}) {
  const candidates = [
    r.NHTSACampaignNumber,
    r.nhtsaCampaignNumber,
    r.campaignNumber,
    r.campaign_id,
    r.campaignId,
    r.recallId,
    r.id,
    r.raw_nhtsa?.NHTSACampaignNumber,
    r.raw_nhtsa?.campaign_id,
    r.raw_nhtsa?.recallId,
  ];
  for (const candidate of candidates) {
    const clean = String(candidate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean) return clean;
  }
  return '';
}

router.post('/import', async (req, res) => {
  const {
    vehicle,
    year,
    recalls,
    decodedVehicle,
    decodedYear,
    vin,
  } = req.body || {};

  if (!vehicle || !year || !recalls?.length) {
    return res.status(400).json({ error: 'vehicle, year and recalls required' });
  }

  const selectedVehicle = normalizeVehicleKey(vehicle);
  const sourceVehicle = normalizeVehicleKey(decodedVehicle || vehicle);
  const selectedYear = parseInt(year, 10);
  const sourceYear = parseInt(decodedYear || year, 10);

  if (!selectedVehicle || !sourceVehicle) {
    return res.status(400).json({ error: 'Unsupported vehicle for VIN import' });
  }
  if (!Number.isInteger(selectedYear) || !Number.isInteger(sourceYear)) {
    return res.status(400).json({ error: 'Valid year required for VIN import' });
  }
  if (selectedVehicle !== sourceVehicle || selectedYear !== sourceYear) {
    return res.status(409).json({
      error: 'VIN vehicle/year does not match selected vehicle/year',
      selectedVehicle,
      selectedYear,
      decodedVehicle: sourceVehicle,
      decodedYear: sourceYear,
    });
  }

  try {
    let inserted = 0;
    let skipped = 0;
    const insertedIds = [];

    for (const r of recalls) {
      const id = extractCampaignId(r);
      if (!id) {
        skipped++;
        continue;
      }

      const result = await query(
        `INSERT INTO recalls (id,vehicle_key,year,title,risk,remedy,source_pills,raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (vehicle_key, year, id) DO NOTHING
         RETURNING id`,
        [
          id,
          sourceVehicle,
          sourceYear,
          r.Component || r.component || r.title || 'Unknown Component',
          r.Summary || r.summary || r.Consequence || r.consequence || r.risk || '',
          r.Remedy || r.remedy || '',
          '{NHTSA Official}',
          JSON.stringify({ ...r, __vin_import: { vin: vin || null, sourceVehicle, sourceYear } }),
        ]
      );

      if (result.rowCount > 0) {
        inserted++;
        insertedIds.push(id);
      } else {
        skipped++;
      }
    }

    res.json({ ok: true, inserted, skipped, insertedIds, count: inserted });
  } catch (e) {
    console.error('vin-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
