// netlify/functions/approve.js
// POST /api/approve
// Body: { queueId, vehicle, year }
// Moves a review_queue item into the live community table

import { query, ok, err, preflight } from ‘./_db.js’;

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();
if (event.httpMethod !== ‘POST’) return err(‘POST required’, 405);

let body;
try { body = JSON.parse(event.body || ‘{}’); }
catch { return err(‘Invalid JSON’, 400); }

const { queueId, vehicle, year } = body;
if (!queueId || !vehicle || !year) return err(‘queueId, vehicle and year required’, 400);

// Load the queue item
const rows = await query(
`SELECT * FROM review_queue WHERE id = $1 AND status = 'pending'`,
[queueId]
);
if (!rows.length) return err(‘Queue item not found or already processed’, 404);

const item = rows[0];
const issue = typeof item.extracted === ‘string’ ? JSON.parse(item.extracted) : item.extracted;
const newId = ‘sweep-’ + Date.now();

// Insert into community
await query(
`INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, ai_sweep, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,TRUE,'active')`,
[
newId,
vehicle,
parseInt(year),
issue.component || ‘Unknown’,
issue.severity  || ‘LOW’,
issue.title     || ‘Unknown Issue’,
issue.summary   || ‘’,
issue.symptoms  || [],
issue.remedy    || ‘’,
issue.bulletinRef || ‘Surfaced via AI research sweep’,
[((item.source_type || ‘AI sweep’).charAt(0).toUpperCase() + (item.source_type || ‘sweep’).slice(1)) + ’ — AI sweep’, ‘Needs verification’],
item.source_url ? JSON.stringify([{ label: ‘Source’, type: item.source_type, url: item.source_url }]) : ‘[]’,
]
);

// Mark queue item approved
await query(
`UPDATE review_queue SET status = 'approved', reviewed_at = NOW() WHERE id = $1`,
[queueId]
);

return ok({ success: true, communityId: newId });
}
