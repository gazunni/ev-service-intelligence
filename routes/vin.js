import { Router } from 'express';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls } from '../services/nhtsa.js';

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
router.post('/import', async (req, res) => {
  const { vehicle, year, recalls } = req.body || {};
  if (!vehicle || !year || !recalls?.length)
    return res.status(400).json({ error: 'vehicle, year and recalls required' });
  try {
    const yr = parseInt(year);
    let count = 0;
    for (const r of recalls) {
      const campaignRaw = r.NHTSACampaignNumber || r.recallId || '';
      if (!campaignRaw) continue;
      const id = campaignRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!id) continue;
      await query(
        `INSERT INTO recalls (id,vehicle_key,year,title,risk,remedy,source_pills,raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [id, vehicle, yr,
         r.Component || r.component || 'Unknown Component',
         r.Summary || r.summary || r.Consequence || r.consequence || '',
         r.Remedy || r.remedy || '',
         '{NHTSA Official}', JSON.stringify(r)]
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch (e) {
    console.error('vin-import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
