//admin.js
import { Router } from 'express';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls, VEHICLES } from '../services/nhtsa.js';

const router = Router();
if (!process.env.ADMIN_KEY) throw new Error('ADMIN_KEY environment variable is not set — set it in Railway before deploying');
const ADMIN_KEY = process.env.ADMIN_KEY;

// ── AUTH HELPERS ──────────────────────────────────────────────────────────
function checkAdmin(req, res) {
  const key = req.body?.key;
  if (key !== ADMIN_KEY) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

export function checkAdminAny(req, res) {
  const key = req.body?.key || req.query?.key || req.headers['x-admin-key'] || '';
  if (key !== ADMIN_KEY) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}


function decodeField(fields, id) {
  return (fields.find(f => f.VariableId === id) || {}).Value || '';
}

function normalizeVehicleKey(raw = '') {
  const key = String(raw || '').trim();
  return Object.prototype.hasOwnProperty.call(VEHICLES, key) ? key : '';
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
    if (md.includes('model 3') || md == '3') return 'tesla_model_3';
    if (md.includes('model y') || md == 'y') return 'tesla_model_y';
  }
  return '';
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

function seedIdFor(vehicleKey, year) {
  return `${vehicleKey}_${year}`;
}

// ── NHTSA TEST (no auth — remove after debugging) ───────────────────────
router.get('/nhtsa-test', async (req, res) => {
  const { vehicle } = req.query;
  const VMAP = {
    tesla_model_3: { make: 'TESLA', model: 'MODEL 3' },
    tesla_model_y: { make: 'TESLA', model: 'MODEL Y' },
  };
  const v = VMAP[vehicle] || VMAP['tesla_model_3'];
  try {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.make)}&model=${encodeURIComponent(v.model)}`;
    const r = await fetch(url);
    const d = await r.json();
    const all = d.results || d.Results || [];
    res.json({
      status: r.status,
      totalCount: all.length,
      uniqueYears: [...new Set(all.map(r=>r.ModelYear))].sort(),
      campaigns: all.map(r=>({
        campaign: r.NHTSACampaignNumber,
        year: r.ModelYear,
        component: r.Component
      }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── NHTSA DEBUG ──────────────────────────────────────────────────────────
// Fetches raw NHTSA data for a vehicle and returns it directly — helps diagnose
// why certain recalls aren't being captured
router.get('/nhtsa-debug', async (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'] || '';
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  const { vehicle, year } = req.query;
  if (!vehicle) return res.status(400).json({ error: 'vehicle required' });

  const VEHICLES = {
    tesla_model_3: { nhtsa_make: 'TESLA', nhtsa_model: 'MODEL 3' },
    tesla_model_y: { nhtsa_make: 'TESLA', nhtsa_model: 'MODEL Y' },
    equinox_ev:    { nhtsa_make: 'CHEVROLET', nhtsa_model: 'EQUINOX EV' },
    mach_e:        { nhtsa_make: 'FORD', nhtsa_model: 'MUSTANG MACH-E' },
    honda_prologue:{ nhtsa_make: 'HONDA', nhtsa_model: 'PROLOGUE' },
  };
  const v = VEHICLES[vehicle];
  if (!v) return res.status(400).json({ error: 'Unknown vehicle' });

  try {
    const results = {};
    // Test 1: with year
    if (year) {
      const url1 = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(v.nhtsa_model)}&modelYear=${year}`;
      const r1 = await fetch(url1);
      const d1 = await r1.json();
      results.withYear = { count: (d1.results||d1.Results||[]).length, url: url1, sample: (d1.results||d1.Results||[]).slice(0,2).map(r=>({campaign:r.NHTSACampaignNumber,year:r.ModelYear,component:r.Component})) };
    }
    // Test 2: without year
    const url2 = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(v.nhtsa_model)}`;
    const r2 = await fetch(url2);
    const d2 = await r2.json();
    const all = d2.results || d2.Results || [];
    results.withoutYear = { count: all.length, url: url2, uniqueYears: [...new Set(all.map(r=>r.ModelYear))].sort(), sample: all.slice(0,3).map(r=>({campaign:r.NHTSACampaignNumber,year:r.ModelYear,component:r.Component})) };

    // Test 3: NHTSA complaints count for comparison
    const url3 = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(v.nhtsa_model)}${year?'&modelYear='+year:''}`;
    results.complaintsUrl = url3;

    res.json(results);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── RUN MIGRATIONS ───────────────────────────────────────────────────────
router.post('/migrate', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const migrations = [
      `CREATE INDEX IF NOT EXISTS idx_recalls_vehicle_year   ON recalls(vehicle_key, year)`,
      `CREATE INDEX IF NOT EXISTS idx_tsbs_vehicle_year      ON tsbs(vehicle_key, year)`,
      `CREATE INDEX IF NOT EXISTS idx_community_vehicle_year ON community(vehicle_key, year, status)`,
      `CREATE INDEX IF NOT EXISTS idx_review_queue_status    ON review_queue(status, vehicle_key, year)`,
      `ALTER TABLE recalls  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
      `ALTER TABLE tsbs     ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`,
      `CREATE TABLE IF NOT EXISTS seed_vins (
        id              TEXT PRIMARY KEY,
        vehicle_key     TEXT NOT NULL,
        year            INT  NOT NULL,
        vin             TEXT NOT NULL UNIQUE,
        trim_hint       TEXT,
        note            TEXT,
        source          TEXT DEFAULT 'manual',
        is_active       BOOLEAN DEFAULT TRUE,
        last_seeded_at  TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(vehicle_key, year)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_seed_vins_active       ON seed_vins(is_active, vehicle_key, year)`,
    ];

    for (const sql of migrations) await query(sql);

    await query(`
      DELETE FROM recalls r1
      USING recalls r2
      WHERE r1.ctid < r2.ctid
        AND r1.vehicle_key = r2.vehicle_key
        AND r1.year = r2.year
        AND r1.id = r2.id
    `);

    await query(`ALTER TABLE recalls DROP CONSTRAINT IF EXISTS recalls_pkey`);
    await query(`
      ALTER TABLE recalls
      ADD CONSTRAINT recalls_pkey PRIMARY KEY (vehicle_key, year, id)
    `);

    res.json({
      ok: true,
      message: `✓ DB migration complete — indexes ensured, status columns ensured, recalls PK updated to (vehicle_key, year, id), seed_vins ready`
    });
  } catch (e) {
    console.error('migrate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SEED VINS: ADD / LIST / RUN ──────────────────────────────────────────
router.post('/seed-vins/add', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const vehicleKey = normalizeVehicleKey(req.body?.vehicle_key || req.body?.vehicle || '');
  const year = parseInt(req.body?.year, 10);
  const vin = String(req.body?.vin || '').trim().toUpperCase();
  const trimHint = String(req.body?.trim_hint || '').trim();
  const note = String(req.body?.note || '').trim();
  if (!vehicleKey) return res.status(400).json({ error: 'Valid vehicle_key required' });
  if (!Number.isInteger(year)) return res.status(400).json({ error: 'Valid year required' });
  if (vin.length !== 17) return res.status(400).json({ error: 'Valid 17-character VIN required' });

  try {
    const id = seedIdFor(vehicleKey, year);
    const rows = await query(
      `INSERT INTO seed_vins (id, vehicle_key, year, vin, trim_hint, note, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET
         vin = EXCLUDED.vin,
         trim_hint = EXCLUDED.trim_hint,
         note = EXCLUDED.note,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [id, vehicleKey, year, vin, trimHint || null, note || null]
    );
    res.json({ ok: true, message: `✓ Seed VIN saved for ${vehicleKey} ${year}`, seed: rows[0] || null });
  } catch (e) {
    console.error('seed-vins add error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/seed-vins/list', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const seeds = await query(`SELECT * FROM seed_vins ORDER BY vehicle_key, year`);
    res.json({ ok: true, seeds });
  } catch (e) {
    console.error('seed-vins list error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/seed-vins/run', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  const onlyId = String(req.body?.id || '').trim();
  try {
    const seeds = onlyId
      ? await query(`SELECT * FROM seed_vins WHERE id=$1 AND is_active=TRUE ORDER BY vehicle_key, year`, [onlyId])
      : await query(`SELECT * FROM seed_vins WHERE is_active=TRUE ORDER BY vehicle_key, year`);

    if (!seeds.length) {
      return res.json({ ok: true, message: '✓ No active seed VINs to run', totals: { seeds: 0, inserted: 0, skipped: 0 }, lines: [] });
    }

    let totalInserted = 0;
    let totalSkipped = 0;
    const lines = [];

    for (const seed of seeds) {
      try {
        const decoded = await decodeVIN(seed.vin);
        const fields = decoded.Results || decoded.results || [];
        const make = decodeField(fields, 26);
        const model = decodeField(fields, 28);
        const decodedYear = parseInt(decodeField(fields, 29), 10) || seed.year;
        const mappedVehicle = detectVehicleKey(make, model, seed.vin);

        if (decodedYear !== seed.year || mappedVehicle !== seed.vehicle_key) {
          lines.push(`⚠ ${seed.vehicle_key} ${seed.year}: VIN mismatch — decoded ${mappedVehicle || 'unknown'} ${decodedYear}`);
          continue;
        }

        const recallData = await fetchVINRecalls(seed.vin, make, model, String(decodedYear));
        const recalls = recallData.results || [];
        let inserted = 0;
        let skipped = 0;

        for (const r of recalls) {
          const campaignId = extractCampaignId(r);
          if (!campaignId) { skipped++; continue; }

          const rows = await query(
            `INSERT INTO recalls (id, vehicle_key, year, title, risk, remedy, source_pills, raw_nhtsa)
             VALUES ($1,$2,$3,$4,$5,$6,ARRAY['NHTSA Official','Seed VIN'], $7)
             ON CONFLICT (vehicle_key, year, id) DO NOTHING
             RETURNING id`,
            [
              campaignId,
              seed.vehicle_key,
              seed.year,
              r.Component || r.component || r.title || 'Unknown Component',
              r.Summary || r.summary || r.Consequence || r.consequence || r.risk || '',
              r.Remedy || r.remedy || '',
              JSON.stringify({ ...r, __seed_vin: { vin: seed.vin, seedId: seed.id } }),
            ]
          );

          if (rows.length > 0) inserted++;
          else skipped++;
        }

        await query(`UPDATE seed_vins SET last_seeded_at=NOW(), updated_at=NOW() WHERE id=$1`, [seed.id]);
        totalInserted += inserted;
        totalSkipped += skipped;
        lines.push(`✓ ${seed.vehicle_key} ${seed.year}: ${inserted} inserted · ${skipped} skipped`);
      } catch (e) {
        lines.push(`⚠ ${seed.vehicle_key} ${seed.year}: ${e.message}`);
      }
    }

    res.json({
      ok: true,
      message: `✓ Seed run complete — ${seeds.length} VIN${seeds.length!==1?'s':''} processed · ${totalInserted} inserted · ${totalSkipped} skipped`,
      totals: { seeds: seeds.length, inserted: totalInserted, skipped: totalSkipped },
      lines
    });
  } catch (e) {
    console.error('seed-vins run error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE RECALL (soft — sets status=suppressed) ────────────────────────
router.delete('/recalls/:id', async (req, res) => {
  if (!checkAdminAny(req, res)) return;
  try {
    await query(`UPDATE recalls SET status='suppressed', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE TSB (soft — sets status=suppressed) ───────────────────────────
router.delete('/tsbs/:id', async (req, res) => {
  if (!checkAdminAny(req, res)) return;
  try {
    await query(`UPDATE tsbs SET status='suppressed', updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE COMMUNITY ISSUE ───────────────────────────────────────────────
router.delete('/community/:id', async (req, res) => {
  if (!checkAdminAny(req, res)) return;
  try {
    await query(`DELETE FROM community WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DEDUPLICATE ───────────────────────────────────────────────────────────
router.post('/dedupe', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    let total = 0;

    // Step 1: Normalize IDs — delete collisions, then rename to canonical uppercase
    await query(`
      DELETE FROM recalls r1
      WHERE id ~ '[^A-Z0-9]'
        AND LENGTH(REGEXP_REPLACE(id,'[^A-Za-z0-9]','','g')) BETWEEN 6 AND 12
        AND REGEXP_REPLACE(id,'[^A-Za-z0-9]','','g') ~ '[0-9]'
        AND EXISTS (
          SELECT 1 FROM recalls r2
          WHERE r2.id = UPPER(REGEXP_REPLACE(r1.id, '[^A-Za-z0-9]', '', 'g'))
            AND r2.ctid != r1.ctid
        )
    `);
    await query(`
      UPDATE recalls SET id = UPPER(REGEXP_REPLACE(id,'[^A-Za-z0-9]','','g'))
      WHERE id ~ '[^A-Z0-9]'
        AND LENGTH(REGEXP_REPLACE(id,'[^A-Za-z0-9]','','g')) BETWEEN 6 AND 12
        AND REGEXP_REPLACE(id,'[^A-Za-z0-9]','','g') ~ '[0-9]'
    `);

    // Step 2: Dedupe by campaign number per vehicle+year
    // Match on raw_nhtsa campaign field OR the ID itself if it looks like a campaign number
    const allRecalls = await query(`
      SELECT id, vehicle_key, year, created_at,
             UPPER(COALESCE(
               raw_nhtsa->>'NHTSACampaignNumber',
               raw_nhtsa->>'campaign_id',
               CASE WHEN id ~ '^[0-9]{2}[A-Z][0-9]{6}$' THEN id ELSE '' END,
               ''
             )) as campaign,
             CASE WHEN raw_nhtsa->>'source_url' IS NOT NULL AND raw_nhtsa->>'source_url' != '' THEN 0 ELSE 1 END as has_url
      FROM recalls ORDER BY vehicle_key, year, campaign, has_url ASC, created_at ASC
    `);
    const campaignGroups = {};
    for (const r of allRecalls) {
      if (!r.campaign) continue;
      const key = `${r.vehicle_key}|${r.year}|${r.campaign}`;
      (campaignGroups[key] = campaignGroups[key] || []).push(r.id);
    }
    for (const ids of Object.values(campaignGroups)) {
      for (const id of ids.slice(1)) {
        await query(`DELETE FROM recalls WHERE id=$1`, [id]);
        total++;
      }
    }

    // Step 3: Dedupe by component keyword per vehicle+year
    const allForTitle = await query(`
      SELECT id, vehicle_key, year, title, created_at, raw_nhtsa->>'source_url' as source_url
      FROM recalls ORDER BY vehicle_key, year, created_at ASC
    `);
    const kwGroups = {};
    for (const r of allForTitle) {
      const words = (r.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 6);
      const colonPart = (r.title || '').split(':')[0].toLowerCase().replace(/[^a-z]/g, '').substring(0, 12);
      const kw = colonPart.length >= 6 ? colonPart : (words[0] || r.id);
      const key = `${r.vehicle_key}|${r.year}|${kw}`;
      (kwGroups[key] = kwGroups[key] || []).push(r);
    }
    for (const rows of Object.values(kwGroups)) {
      if (rows.length > 1) {
        rows.sort((a, b) => {
          if (a.source_url && !b.source_url) return -1;
          if (!a.source_url && b.source_url) return 1;
          return new Date(a.created_at) - new Date(b.created_at);
        });
        for (const r of rows.slice(1)) {
          await query(`DELETE FROM recalls WHERE id=$1`, [r.id]);
          total++;
        }
      }
    }

    // Step 4: Dedupe TSBs by title per vehicle+year
    await query(`
      DELETE FROM tsbs WHERE ctid NOT IN (
        SELECT MIN(ctid) FROM tsbs GROUP BY vehicle_key, year, LOWER(TRIM(COALESCE(title,'')))
      )
    `);

    res.json({ message: total > 0 ? `✓ Removed ${total} duplicate rows` : '✓ No duplicates found' });
  } catch (e) {
    console.error('dedupe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── RECALL AUDIT ─────────────────────────────────────────────────────────
router.get('/recall-audit', async (req, res) => {
  const key = req.query.key || req.headers['x-admin-key'] || '';
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const all = await query(`
      SELECT id, vehicle_key, year, title, created_at,
             raw_nhtsa->>'NHTSACampaignNumber' as campaign
      FROM recalls ORDER BY vehicle_key, year, title
    `);
    const groups = {};
    for (const r of all) {
      const k = `${r.vehicle_key}-${r.year}`;
      (groups[k] = groups[k] || []).push(r);
    }
    const dupes = [];
    for (const rows of Object.values(groups)) {
      const byCampaign = {};
      for (const r of rows) {
        if (r.campaign) (byCampaign[r.campaign] = byCampaign[r.campaign] || []).push(r);
      }
      for (const [camp, campRows] of Object.entries(byCampaign)) {
        if (campRows.length > 1) dupes.push({ reason: 'same_campaign', campaign: camp, rows: campRows });
      }
    }
    res.json({ total: all.length, duplicates: dupes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DB STATS ─────────────────────────────────────────────────────────────
router.post('/stats', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const [recalls, tsbs, community, queue, suppressed, lastSweep, byVehicle] = await Promise.all([
      query(`SELECT COUNT(*) FROM recalls WHERE COALESCE(status,'active') != 'suppressed'`),
      query(`SELECT COUNT(*) FROM tsbs WHERE COALESCE(status,'active') != 'suppressed'`),
      query(`SELECT COUNT(*) FROM community WHERE status='active'`),
      query(`SELECT COUNT(*) FROM review_queue WHERE status='pending'`),
      query(`SELECT COUNT(*) FROM recalls WHERE status='suppressed'`),
      query(`SELECT vehicle_key, MAX(swept_at) as last_swept FROM sweep_log GROUP BY vehicle_key ORDER BY last_swept DESC LIMIT 1`),
      query(`SELECT vehicle_key,
               COUNT(*) FILTER (WHERE COALESCE(r.status,'active')!='suppressed') as recalls
             FROM recalls r GROUP BY vehicle_key ORDER BY vehicle_key`),
    ]);

    // Legacy message format for existing UI
    const message = [
      `recalls: ${recalls[0].count}`,
      `tsbs: ${tsbs[0].count}`,
      `community: ${community[0].count}`,
      `review_queue: ${queue[0].count}`,
    ].join(' · ');

    res.json({
      message,
      dashboard: {
        recalls:      parseInt(recalls[0].count),
        tsbs:         parseInt(tsbs[0].count),
        community:    parseInt(community[0].count),
        pendingQueue: parseInt(queue[0].count),
        suppressed:   parseInt(suppressed[0].count),
        lastSwept:    lastSweep[0]?.last_swept || null,
        lastSweptVehicle: lastSweep[0]?.vehicle_key || null,
        byVehicle:    byVehicle.map(r => ({ vehicle: r.vehicle_key, recalls: parseInt(r.recalls) })),
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CLEAR SWEEP LOG ───────────────────────────────────────────────────────
router.post('/clear-sweep', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const result = await query(`DELETE FROM sweep_log`);
    res.json({ message: `✓ Sweep log cleared (${result.rowCount || 0} rows)` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CLEAR REVIEW QUEUE ────────────────────────────────────────────────────
router.post('/clear-queue', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const result = await query(`DELETE FROM review_queue WHERE status='pending'`);
    res.json({ message: `✓ Cleared ${result.rowCount || 0} pending queue items` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
