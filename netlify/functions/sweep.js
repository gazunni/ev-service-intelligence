// netlify/functions/sweep.js
// POST /api/sweep
// Body: { vehicle: ‘equinox_ev’, year: 2025 }
// Fetches NHTSA recalls + TSBs, AI-summarizes, stores in Neon

import Anthropic from ‘@anthropic-ai/sdk’;
import { query, ok, err, preflight } from ‘./_db.js’;

const VEHICLES = {
equinox_ev: { make: ‘Chevrolet’, model: ‘Equinox EV’, nhtsa_make: ‘CHEVROLET’, nhtsa_model: ‘EQUINOX EV’ },
blazer_ev:  { make: ‘Chevrolet’, model: ‘Blazer EV’,  nhtsa_make: ‘CHEVROLET’, nhtsa_model: ‘BLAZER EV’  },
mach_e:     { make: ‘Ford’, model: ‘Mustang Mach-E’,  nhtsa_make: ‘FORD’,      nhtsa_model: ‘MUSTANG MACH-E’ },
};

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchNHTSA(endpoint, make, model, year) {
const url = `https://api.nhtsa.gov/${endpoint}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`;
try {
const r = await fetch(url);
if (!r.ok) return [];
const d = await r.json();
return d.results || [];
} catch (e) {
console.error(‘NHTSA fetch error:’, e);
return [];
}
}

async function summarizeOne(item, vehicleName, type) {
const isRecall = type === ‘recall’;
const prompt = isRecall
? `Summarize this NHTSA recall for ${vehicleName} owners in plain English. Return ONLY a JSON object, no markdown: {"component":"affected part plain English","severity":"CRITICAL or MODERATE or LOW","title":"what is wrong max 8 words","risk":"what could happen to owner","remedy":"what dealer will do"}`
: `Summarize this NHTSA TSB for ${vehicleName} owners in plain English. Return ONLY a JSON object, no markdown: {"component":"affected part","severity":"MODERATE or LOW","title":"max 8 words plain English","summary":"2 sentence description","remedy":"what fix involves"}`;

const content = isRecall
? `Component: ${item.Component || ''}\nSummary: ${item.Summary || ''}\nConsequence: ${item.Consequence || ''}\nRemedy: ${item.Remedy || ''}`
: `Bulletin: ${item.tsbNumber || ''}\nSummary: ${item.Summary || ''}`;

try {
const msg = await ai.messages.create({
model: ‘claude-haiku-4-5-20251001’,
max_tokens: 400,
messages: [{ role: ‘user’, content: prompt + ‘\n\n’ + content }],
});
const text = msg.content[0]?.text || ‘’;
const match = text.match(/{[\s\S]*?}/);
if (match) return JSON.parse(match[0]);
} catch (e) {
console.error(‘AI summarize error:’, e);
}
return null;
}

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();
if (event.httpMethod !== ‘POST’) return err(‘POST required’, 405);

let body;
try { body = JSON.parse(event.body || ‘{}’); }
catch { return err(‘Invalid JSON’, 400); }

const { vehicle, year } = body;
if (!vehicle || !year) return err(‘vehicle and year required’, 400);

const v = VEHICLES[vehicle];
if (!v) return err(‘Unknown vehicle’, 400);

const yr = parseInt(year);
let recallsStored = 0;
let tsbsStored = 0;

// ── RECALLS ──
const rawRecalls = await fetchNHTSA(‘recalls/recallsByVehicle’, v.nhtsa_make, v.nhtsa_model, yr);
for (const r of rawRecalls) {
const ai_data = await summarizeOne(r, `${v.make} ${v.model}`, ‘recall’);
await query(
`INSERT INTO recalls (id, vehicle_key, year, component, severity, title, risk, remedy, affected_units, source_pills, raw_nhtsa, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, risk=EXCLUDED.risk, remedy=EXCLUDED.remedy, severity=EXCLUDED.severity, updated_at=NOW()`,
[
r.NHTSACampaignNumber || (‘r-’ + Date.now()),
vehicle, yr,
ai_data?.component || r.Component || ‘Unknown’,
ai_data?.severity  || ‘MODERATE’,
ai_data?.title     || (r.Summary || ‘Safety Recall’).substring(0, 100),
ai_data?.risk      || r.Consequence || ‘’,
ai_data?.remedy    || r.Remedy || ‘’,
r.PotentialNumberOfUnitsAffected || null,
[‘NHTSA Official’],
JSON.stringify(r),
]
);
recallsStored++;
}

// ── TSBs ──
const rawTSBs = await fetchNHTSA(‘tsbs/tsbsByVehicle’, v.nhtsa_make, v.nhtsa_model, yr);
for (const t of rawTSBs) {
const ai_data = await summarizeOne(t, `${v.make} ${v.model}`, ‘tsb’);
await query(
`INSERT INTO tsbs (id, vehicle_key, year, component, severity, title, summary, remedy, source_pills, raw_nhtsa, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary, remedy=EXCLUDED.remedy, updated_at=NOW()`,
[
t.tsbNumber || t.bulletinNumber || (‘tsb-’ + Date.now()),
vehicle, yr,
ai_data?.component || t.Component || ‘Unknown’,
ai_data?.severity  || ‘MODERATE’,
ai_data?.title     || t.tsbNumber || ‘TSB’,
ai_data?.summary   || t.Summary || ‘’,
ai_data?.remedy    || t.Summary || ‘’,
[‘NHTSA Filed’],
JSON.stringify(t),
]
);
tsbsStored++;
}

// ── LOG ──
await query(
`INSERT INTO sweep_log (vehicle_key, year, recalls_found, tsbs_found, swept_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (vehicle_key, year) DO UPDATE SET recalls_found=$3, tsbs_found=$4, swept_at=NOW()`,
[vehicle, yr, recallsStored, tsbsStored]
);

return ok({ success: true, recalls: recallsStored, tsbs: tsbsStored });
}
