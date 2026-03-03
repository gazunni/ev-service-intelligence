// netlify/functions/sweep.js
// POST /api/sweep
// Body: { vehicle: 'equinox_ev', year: 2025 }
// Fetches NHTSA recalls + TSBs, AI-summarizes, stores in Neon

import Anthropic from '@anthropic-ai/sdk';
import { query, ok, err, preflight } from './_db.js';

const VEHICLES = {
equinox_ev: { make: 'Chevrolet', model: 'Equinox EV', nhtsa_make: 'CHEVROLET', nhtsa_model: 'EQUINOX EV' },
blazer_ev:  { make: 'Chevrolet', model: 'Blazer EV',  nhtsa_make: 'CHEVROLET', nhtsa_model: 'BLAZER EV'  },
mach_e:     { make: 'Ford', model: 'Mustang Mach-E',  nhtsa_make: 'FORD',      nhtsa_model: 'MUSTANG MACH-E' },
};

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchNHTSA(endpoint, make, model, year) {
const url = `https://api.nhtsa.gov/${endpoint}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
try {
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 15000);
const r = await fetch(url, { signal: controller.signal });
clearTimeout(timeoutId);
if (!r.ok) {
  console.error('NHTSA API error:', r.status, r.statusText, 'URL:', url);
  return [];
}
const d = await r.json();
// NHTSA API may use 'results' or 'Results' depending on endpoint
const results = d.results || d.Results || d.result || d.Result || [];
console.log('NHTSA response for', endpoint, ':', Array.isArray(results) ? results.length + ' results' : 'non-array response');
return Array.isArray(results) ? results : [];
} catch (e) {
console.error('NHTSA fetch error:', e.message, 'URL:', url);
return [];
}
}

async function summarizeOne(item, vehicleName, type) {
const isRecall = type === 'recall';
const prompt = isRecall
? `Summarize this NHTSA recall for ${vehicleName} owners in plain English. Return ONLY a JSON object, no markdown: {"component":"affected part plain English","severity":"CRITICAL or MODERATE or LOW","title":"what is wrong max 8 words","risk":"what could happen to owner","remedy":"what dealer will do"}`
: `Summarize this NHTSA TSB for ${vehicleName} owners in plain English. Return ONLY a JSON object, no markdown: {"component":"affected part","severity":"MODERATE or LOW","title":"max 8 words plain English","summary":"2 sentence description","remedy":"what fix involves"}`;

const content = isRecall
? `Component: ${item.Component || ''}\nSummary: ${item.Summary || ''}\nConsequence: ${item.Consequence || ''}\nRemedy: ${item.Remedy || ''}`
: `Bulletin: ${item.tsbNumber || ''}\nSummary: ${item.Summary || ''}`;

try {
const msg = await ai.messages.create({
model: 'claude-haiku-4-5-20251001',
max_tokens: 400,
messages: [{ role: 'user', content: prompt + '\n\n' + content }],
});
const text = msg.content[0]?.text || '';
const match = text.match(/{[\s\S]*?}/);
if (match) return JSON.parse(match[0]);
} catch (e) {
console.error('AI summarize error:', e);
}
return null;
}

export async function handler(event) {
if (event.httpMethod === 'OPTIONS') return preflight();
if (event.httpMethod !== 'POST') return err('POST required', 405);

let body;
try { body = JSON.parse(event.body || '{}'); }
catch { return err('Invalid JSON', 400); }

const { vehicle, year } = body;
if (!vehicle || !year) return err('vehicle and year required', 400);

const v = VEHICLES[vehicle];
if (!v) return err('Unknown vehicle', 400);

const yr = parseInt(year);
let recallsStored = 0;
let tsbsStored = 0;

// ── FETCH NHTSA DATA (recalls and TSBs in parallel) ──
const [rawRecalls, rawTSBs] = await Promise.all([
  fetchNHTSA('recalls/recallsByVehicle', v.nhtsa_make, v.nhtsa_model, yr),
  fetchNHTSA('tsbs/tsbsByVehicle', v.nhtsa_make, v.nhtsa_model, yr),
]);

// ── STORE RECALLS — store basic data first, then try AI enhancement ──
for (const r of rawRecalls) {
  const recallId = r.NHTSACampaignNumber || r.nhtsa_campaign_number || ('r-' + Date.now() + '-' + recallsStored);
  // Store basic data immediately (no AI needed)
  const basicTitle = (r.Summary || r.summary || 'Safety Recall').substring(0, 100);
  const basicComponent = r.Component || r.component || 'Unknown';
  const basicConsequence = r.Consequence || r.consequence || '';
  const basicRemedy = r.Remedy || r.remedy || '';
  const units = r.PotentialNumberOfUnitsAffected || r.potential_number_of_units_affected || null;

  await query(
    `INSERT INTO recalls (id, vehicle_key, year, component, severity, title, risk, remedy, affected_units, source_pills, raw_nhtsa, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, risk=EXCLUDED.risk, remedy=EXCLUDED.remedy, severity=EXCLUDED.severity, component=EXCLUDED.component, updated_at=NOW()`,
    [
      recallId, vehicle, yr,
      basicComponent, 'CRITICAL',
      basicTitle, basicConsequence, basicRemedy,
      units, ['NHTSA Official'], JSON.stringify(r),
    ]
  );
  recallsStored++;
}

// ── STORE TSBs — same pattern, store basic data first ──
for (const t of rawTSBs) {
  const tsbId = t.tsbNumber || t.tsb_number || t.bulletinNumber || t.bulletin_number || ('tsb-' + Date.now() + '-' + tsbsStored);
  const basicTitle = t.tsbNumber || t.tsb_number || 'TSB';
  const basicSummary = t.Summary || t.summary || '';
  const basicComponent = t.Component || t.component || 'Unknown';

  await query(
    `INSERT INTO tsbs (id, vehicle_key, year, component, severity, title, summary, remedy, source_pills, raw_nhtsa, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, remedy=EXCLUDED.remedy, updated_at=NOW()`,
    [
      tsbId, vehicle, yr,
      basicComponent, 'MODERATE',
      basicTitle, basicSummary, basicSummary,
      ['NHTSA Filed'], JSON.stringify(t),
    ]
  );
  tsbsStored++;
}

// ── Try AI enhancement for stored records (best-effort, don't block) ──
try {
  const recallsToEnhance = rawRecalls.slice(0, 5); // Limit to prevent timeout
  const aiPromises = recallsToEnhance.map(r => {
    const recallId = r.NHTSACampaignNumber || r.nhtsa_campaign_number;
    if (!recallId) return Promise.resolve();
    return summarizeOne(r, `${v.make} ${v.model}`, 'recall').then(async (ai_data) => {
      if (!ai_data) return;
      await query(
        `UPDATE recalls SET component=COALESCE($2,component), severity=COALESCE($3,severity), title=COALESCE($4,title), risk=COALESCE($5,risk), remedy=COALESCE($6,remedy) WHERE id=$1`,
        [recallId, ai_data.component, ai_data.severity, ai_data.title, ai_data.risk, ai_data.remedy]
      );
    }).catch(e => console.error('AI enhance error:', e.message));
  });
  // Run AI enhancement with a 6-second budget
  await Promise.race([
    Promise.allSettled(aiPromises),
    new Promise(resolve => setTimeout(resolve, 6000)),
  ]);
} catch (e) {
  console.error('AI enhancement phase error (non-blocking):', e.message);
}

// ── LOG ──
await query(
  `INSERT INTO sweep_log (vehicle_key, year, recalls_found, tsbs_found, swept_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (vehicle_key, year) DO UPDATE SET recalls_found=$3, tsbs_found=$4, swept_at=NOW()`,
  [vehicle, yr, recallsStored, tsbsStored]
);

return ok({ success: true, recalls: recallsStored, tsbs: tsbsStored });
}
