import { Router } from 'express';
import { query } from '../services/database.js';
import { classifySubmission, extractResearchIssues, extractForumThread } from '../services/ai.js';

const router = Router();

// ── GET COMMUNITY ISSUES ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
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

// ── SUBMIT COMMUNITY ISSUE ────────────────────────────────────────────────
router.post('/submit', async (req, res) => {
  const { vehicle, year, title, detail, bulletin, sourceUrl, srcType } = req.body || {};
  if (!vehicle || !year || !title || !detail)
    return res.status(400).json({ error: 'vehicle, year, title and detail required' });
  const yr = parseInt(year);

  const existing = await query(
    `SELECT id, title, summary FROM community WHERE vehicle_key=$1 AND year=$2 AND status='active'`,
    [vehicle, yr]
  );

  let analysis = null;
  try { analysis = await classifySubmission(title, detail, bulletin, existing); } catch {}

  if (analysis?.matchFound && analysis?.matchId) {
    await query(`UPDATE community SET confirmations=confirmations+1,updated_at=NOW() WHERE id=$1`, [analysis.matchId]);
    return res.json({ action: 'confirmed', matchId: analysis.matchId, confidence: analysis.matchConfidence });
  }

  const newId = 'usr-' + Date.now();
  await query(
    `INSERT INTO community (id,vehicle_key,year,component,severity,title,summary,remedy,bulletin_ref,source_pills,links,confirmations,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'','',$8,$9,1,'active')`,
    [newId, vehicle, yr,
     analysis?.component || 'Unknown', analysis?.severity || 'LOW',
     analysis?.cleanTitle || title, analysis?.summary || detail,
     [(srcType || 'user') + ' — user submitted'],
     sourceUrl ? JSON.stringify([{ label: 'Source', type: srcType, url: sourceUrl }]) : '[]']
  );
  res.json({ action: 'created', id: newId });
});

// ── RESEARCH SWEEP → REVIEW QUEUE ────────────────────────────────────────
router.post('/research', async (req, res) => {
  let { vehicle, year, text, srcType, srcUrl } = req.body || {};
  if (!vehicle || !year) return res.status(400).json({ error: 'vehicle and year required' });

  // Fetch text from URL if no text provided
  if (!text && srcUrl) {
    try {
      const fetchRes = await fetch(srcUrl, { headers: { 'User-Agent': 'EV-Service-Intelligence/1.0' } });
      if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status}`);
      const ct = fetchRes.headers.get('content-type') || '';
      text = ct.includes('pdf')
        ? `[PDF from ${srcUrl}] Extract vehicle service issues. URL: ${srcUrl}`
        : (await fetchRes.text()).substring(0, 15000);
    } catch (e) {
      return res.status(400).json({ error: 'Could not fetch URL: ' + e.message });
    }
  }
  if (!text) return res.status(400).json({ error: 'text or srcUrl required' });

  const yr = parseInt(year);
  const existing = await query(
    `SELECT id, title FROM community WHERE vehicle_key=$1 AND year=$2 AND status='active'`,
    [vehicle, yr]
  );

  try {
    const issues = await extractResearchIssues(text, existing);
    const queued = [];
    for (const issue of issues) {
      const rows = await query(
        `INSERT INTO review_queue (vehicle_key,year,extracted,source_type,source_url,confidence,likely_match_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [vehicle, yr, JSON.stringify(issue), srcType || 'unknown', srcUrl || null,
         issue.confidence || 'MEDIUM', issue.likelyMatchId || null]
      );
      queued.push({ ...issue, queueId: rows[0]?.id });
    }
    res.json({ issues: queued, count: queued.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── APPROVE QUEUE ITEM → COMMUNITY ───────────────────────────────────────
router.post('/approve', async (req, res) => {
  const { queueId, vehicle, year } = req.body || {};
  if (!queueId || !vehicle || !year)
    return res.status(400).json({ error: 'queueId, vehicle and year required' });

  const rows = await query(`SELECT * FROM review_queue WHERE id=$1 AND status='pending'`, [queueId]);
  if (!rows.length) return res.status(404).json({ error: 'Queue item not found' });

  const item = rows[0];
  const issue = typeof item.extracted === 'string' ? JSON.parse(item.extracted) : item.extracted;
  const newId = 'sweep-' + Date.now();

  await query(
    `INSERT INTO community (id,vehicle_key,year,component,severity,title,summary,symptoms,remedy,bulletin_ref,source_pills,links,confirmations,ai_sweep,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,TRUE,'active')`,
    [newId, vehicle, parseInt(year),
     issue.component || 'Unknown', issue.severity || 'LOW',
     issue.title || 'Unknown Issue', issue.summary || '',
     issue.symptoms || [], issue.remedy || '',
     issue.bulletinRef || 'AI research sweep',
     [(item.source_type || 'sweep') + ' — AI sweep', 'Needs verification'],
     item.source_url ? JSON.stringify([{ label: 'Source', type: item.source_type, url: item.source_url }]) : '[]']
  );

  await query(`UPDATE review_queue SET status='approved',reviewed_at=NOW() WHERE id=$1`, [queueId]);
  res.json({ success: true, communityId: newId });
});

// ── CONFIRM COMMUNITY ISSUE ───────────────────────────────────────────────
router.post('/confirm', async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    await query(`UPDATE community SET confirmations=confirmations+1,updated_at=NOW() WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CLONE COMMUNITY ISSUE TO ADDITIONAL VEHICLES ─────────────────────────
router.post('/clone', async (req, res) => {
  const { src_id, targets } = req.body || {};
  if (!src_id || !targets?.length)
    return res.status(400).json({ error: 'src_id and targets required' });
  try {
    const rows = await query(`SELECT * FROM community WHERE id=$1`, [src_id]);
    if (!rows.length) return res.status(404).json({ error: 'Source community issue not found' });
    const src = rows[0];

    const toJsonStr = v => {
      if (!v) return '[]';
      if (typeof v === 'string') return v;
      return JSON.stringify(v);
    };

    let count = 0;
    for (const { vehicle, year } of targets) {
      const newId = (vehicle + '-' + year + '-' + src.id)
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60);
      await query(
        `INSERT INTO community (id,vehicle_key,year,title,component,severity,summary,symptoms,remedy,bulletin_ref,source_pills,links,confirmations,ai_sweep,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [newId, vehicle, parseInt(year),
         src.title, src.component, src.severity, src.summary,
         toJsonStr(src.symptoms), src.remedy, src.bulletin_ref,
         toJsonStr(src.source_pills), toJsonStr(src.links),
         src.confirmations || 1, src.ai_sweep || false, src.status || 'active']
      );
      count++;
    }
    res.json({ ok: true, count });
  } catch (e) {
    console.error('community-clone error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── COMMUNITY DEDUPE ─────────────────────────────────────────────────────
// Finds and merges duplicate community issues for a vehicle/year.
// Keeps the record with most confirmations, adds confirmations from merged records,
// combines summaries if they add detail, then suppresses the duplicates.
router.post('/dedupe', async (req, res) => {
  try {
    const issues = await query(
      `SELECT id, vehicle_key, year, title, summary, component, confirmations, status, source_pills, links
       FROM community WHERE status='active' ORDER BY vehicle_key, year, confirmations DESC`
    );

    const merged = [];
    const suppressed = new Set();

    for (let i = 0; i < issues.length; i++) {
      if (suppressed.has(issues[i].id)) continue;
      const base = issues[i];

      for (let j = i + 1; j < issues.length; j++) {
        if (suppressed.has(issues[j].id)) continue;
        const cand = issues[j];

        // Only compare same vehicle + year
        if (base.vehicle_key !== cand.vehicle_key || base.year !== cand.year) continue;

        // Title similarity check — normalize and compare
        const normalize = s => (s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
        const baseTok = new Set(normalize(base.title).split(' ').filter(w => w.length > 3));
        const candTok = normalize(cand.title).split(' ').filter(w => w.length > 3);
        const overlap = candTok.filter(w => baseTok.has(w)).length;
        const similarity = baseTok.size > 0 ? overlap / Math.max(baseTok.size, candTok.length) : 0;

        if (similarity >= 0.4) {
          // Merge source_pills — combine unique pills from both records
          const parseArr = v => {
            if (!v) return [];
            if (Array.isArray(v)) return v;
            try { return JSON.parse(v); } catch { return []; }
          };
          const basePills = parseArr(base.source_pills);
          const candPills = parseArr(cand.source_pills);
          const mergedPills = [...new Set([...basePills, ...candPills])];

          // Merge links — combine unique links from both records
          const baseLinks = parseArr(base.links);
          const candLinks = parseArr(cand.links);
          const seenUrls = new Set(baseLinks.map(l => l.url || l));
          const newLinks = candLinks.filter(l => !seenUrls.has(l.url || l));
          const mergedLinks = [...baseLinks, ...newLinks];

          // Update winner with merged pills, links and combined confirmations
          await query(
            `UPDATE community SET
               confirmations = confirmations + $1,
               source_pills  = $2,
               links         = $3,
               updated_at    = NOW()
             WHERE id = $4`,
            [cand.confirmations || 1, JSON.stringify(mergedPills), JSON.stringify(mergedLinks), base.id]
          );
          await query(`UPDATE community SET status='suppressed' WHERE id=$1`, [cand.id]);
          suppressed.add(cand.id);
          merged.push({
            kept: base.id, suppressed: cand.id, title: base.title,
            similarity: Math.round(similarity * 100),
            addedPills: candPills.filter(p => !basePills.includes(p))
          });
        }
      }
    }

    res.json({ ok: true, mergedCount: merged.length, merged });
  } catch(e) {
    console.error('community-dedupe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── FORUM THREAD EXTRACTION ("Generified" © 2026) ────────────────────────
router.post('/forum-fetch', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const result = await extractForumThread(url);
    res.json(result);
  } catch(e) {
    console.error('forum-fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
