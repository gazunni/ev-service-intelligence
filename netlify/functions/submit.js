// netlify/functions/submit.js
// POST /api/submit
// Body: { vehicle, year, title, detail, bulletin, sourceUrl, srcType }

import Anthropic from ‘@anthropic-ai/sdk’;
import { query, ok, err, preflight } from ‘./_db.js’;

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();
if (event.httpMethod !== ‘POST’) return err(‘POST required’, 405);

let body;
try { body = JSON.parse(event.body || ‘{}’); }
catch { return err(‘Invalid JSON’, 400); }

const { vehicle, year, title, detail, bulletin, sourceUrl, srcType } = body;
if (!vehicle || !year || !title || !detail) return err(‘vehicle, year, title and detail required’, 400);

const yr = parseInt(year);

// Load existing community records for dedup
const existing = await query(
`SELECT id, title, summary, symptoms FROM community WHERE vehicle_key = $1 AND year = $2 AND status = 'active'`,
[vehicle, yr]
);

// AI dedup
let analysis = null;
try {
const sys = `Vehicle service bulletin analyst. Semantically match a new owner report against existing records. "wet carpet", "soaked floor", "water under seat" = same issue. Be semantic not literal. Return ONLY valid JSON, no markdown: {"matchFound":true/false,"matchId":"id of match or null","matchConfidence":0.0-1.0,"component":"component","severity":"CRITICAL|MODERATE|LOW","cleanTitle":"max 8 words","summary":"2-3 sentence plain English summary"}`;

```
const msg = await ai.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 600,
  messages: [{
    role: 'user',
    content: 'New issue:\n' + JSON.stringify({ title, detail, bulletin })
      + '\n\nExisting records:\n' + JSON.stringify(existing.map(r => ({ id: r.id, title: r.title, summary: r.summary })).slice(0, 20))
  }],
  system: sys,
});

const text = msg.content[0]?.text || '';
const match = text.match(/\{[\s\S]*?\}/);
if (match) analysis = JSON.parse(match[0]);
```

} catch (e) {
console.error(‘Dedup AI error:’, e);
}

if (analysis?.matchFound && analysis?.matchId) {
// Increment confirmations on existing record
await query(
`UPDATE community SET confirmations = confirmations + 1, updated_at = NOW() WHERE id = $1`,
[analysis.matchId]
);
return ok({
action: ‘confirmed’,
matchId: analysis.matchId,
confidence: analysis.matchConfidence,
message: ‘Added as confirmation to existing record’,
});
}

// Insert new community record
const newId = ‘usr-’ + Date.now();
const srcLabel = (srcType || ‘user’).charAt(0).toUpperCase() + (srcType || ‘user’).slice(1);

await query(
`INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, remedy, bulletin_ref, source_pills, links, confirmations, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,'active')`,
[
newId, vehicle, yr,
analysis?.component || ‘Unknown’,
analysis?.severity  || ‘LOW’,
analysis?.cleanTitle || title,
analysis?.summary    || detail,
‘’,
bulletin || ‘Not filed with NHTSA’,
[srcLabel + ’ — user submitted’],
sourceUrl ? JSON.stringify([{ label: ‘Source link’, type: srcType, url: sourceUrl }]) : ‘[]’,
]
);

return ok({
action: ‘created’,
id: newId,
title: analysis?.cleanTitle || title,
message: ‘New community issue created’,
});
}
