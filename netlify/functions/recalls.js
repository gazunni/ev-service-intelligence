// netlify/functions/recalls.js
// GET /api/recalls?vehicle=equinox_ev&year=2025

import { query, ok, err, preflight } from ‘./_db.js’;

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();

const { vehicle, year } = event.queryStringParameters || {};
if (!vehicle || !year) return err(‘vehicle and year required’, 400);

try {
const rows = await query(
`SELECT * FROM recalls WHERE vehicle_key = $1 AND year = $2 ORDER BY created_at DESC`,
[vehicle, parseInt(year)]
);
return ok(rows);
} catch (e) {
console.error(‘recalls error:’, e);
return err(’Database error: ’ + e.message);
}
}
