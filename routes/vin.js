import { Router } from 'express';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls, VEHICLES } from '../services/nhtsa.js';

const router = Router();

// ── DECODE VIN ────────────────────────────────────────────────────────────
router.get('/decode', async (req, res) => {
  const { vin } = req.query;
  if (!vin || vin.length !== 17) return res.status(400).json({ error: 'Valid 17-char VIN required' });
  try {
    res.json(await decodeVIN(vin));
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
      const campaignRaw = r.NHTSACampaignNumber || r.recallId || '';
      if (!campaignRaw) {
        skipped++;
        continue;
      }
      const id = campaignRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!id) {
        skipped++;
        continue;
      }

      const result = await query(
        `INSERT INTO recalls (id,vehicle_key,year,title,risk,remedy,source_pills,raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          id,
          sourceVehicle,
          sourceYear,
          r.Component || r.component || 'Unknown Component',
          r.Summary || r.summary || r.Consequence || r.consequence || '',
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

    res.json({ ok: true, inserted, skipped, insertedIds });
  } catch (e) {
    console.error('vin-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
