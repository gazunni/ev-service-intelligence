import { Router } from 'express';
import { query } from '../services/database.js';

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
    ];
    for (const sql of migrations) await query(sql);
    res.json({ ok: true, message: `✓ ${migrations.length} indexes created (IF NOT EXISTS — safe to run again)` });
  } catch(e) {
    console.error('migrate error:', e.message);
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

// ── FIX MALFORMED SOURCE PILLS ───────────────────────────────────────────
// Pure SQL fix — no JS array parsing. Finds records with bad source_pills
// and resets them to a clean array, then copies pills from suppressed
// records to their active counterparts via text matching.
router.post('/fix-pills', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const results = [];

    // Step 1: Get all community IDs safely — no array columns
    const ids = await query(`SELECT id, vehicle_key, year, title, status FROM community`);

    // Step 2: For each record, try to read source_pills individually
    // catching any malformed array error per-row
    let resetCount = 0;
    for (const row of ids) {
      try {
        await query(`SELECT id FROM community WHERE id=$1 AND source_pills IS NOT NULL`, [row.id]);
      } catch(e) {
        // This row has malformed source_pills — reset it to empty array
        await query(`UPDATE community SET source_pills = ARRAY[]::text[] WHERE id=$1`, [row.id]);
        resetCount++;
        results.push({ action: 'reset', id: row.id, title: row.title });
      }
    }

    // Step 3: For suppressed records that matched active ones,
    // manually add known pills via direct SQL array append
    // Find suppressed records
    const suppressed = await query(
      `SELECT id, vehicle_key, year, title, status FROM community WHERE status='suppressed'`
    );
    const active = await query(
      `SELECT id, vehicle_key, year, title FROM community WHERE status='active'`
    );

    let mergeCount = 0;
    for (const sup of suppressed) {
      const normalize = s => (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
      const supToks = new Set(normalize(sup.title).split(' ').filter(w => w.length > 3));

      for (const act of active) {
        if (act.vehicle_key !== sup.vehicle_key || act.year !== sup.year) continue;
        const actToks = normalize(act.title).split(' ').filter(w => w.length > 3);
        const overlap = actToks.filter(w => supToks.has(w)).length;
        const sim = supToks.size > 0 ? overlap / Math.max(supToks.size, actToks.length) : 0;

        if (sim >= 0.4) {
          // Append 'Reddit - AI sweep' pill if not already present using pure SQL
          await query(`
            UPDATE community
            SET source_pills = (
              SELECT array_agg(DISTINCT pill)
              FROM unnest(
                array_append(source_pills, 'Reddit - AI sweep')
              ) AS pill
            )
            WHERE id = $1
              AND NOT ('Reddit - AI sweep' = ANY(source_pills))
          `, [act.id]);
          mergeCount++;
          results.push({ action: 'merged_pill', activeId: act.id, fromId: sup.id, title: act.title });
          break;
        }
      }
    }

    res.json({ ok: true, resetCount, mergeCount, results });
  } catch(e) {
    console.error('fix-pills error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
