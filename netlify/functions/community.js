// netlify/functions/community.js
// GET /api/community?vehicle=equinox_ev&year=2025

import { query, ok, err, preflight } from ‘./_db.js’;

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();

const { vehicle, year } = event.queryStringParameters || {};
if (!vehicle || !year) return err(‘vehicle and year required’, 400);

try {
const rows = await query(
`SELECT * FROM community WHERE vehicle_key = $1 AND year = $2 AND status = 'active' ORDER BY is_seeded DESC, confirmations DESC, created_at DESC`,
[vehicle, parseInt(year)]
);
return ok(rows);
} catch (e) {
console.error(‘community error:’, e);
return err(’Database error: ’ + e.message);
}
}
