// netlify/functions/research.js
// POST /api/research
// Body: { vehicle, year, text, srcType, srcUrl }
// Extracts structured issues from raw text, adds to review_queue

import Anthropic from ‘@anthropic-ai/sdk’;
import { query, ok, err, preflight } from ‘./_db.js’;

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function handler(event) {
if (event.httpMethod === ‘OPTIONS’) return preflight();
if (event.httpMethod !== ‘POST’) return err(‘POST required’, 405);

let body;
try { body = JSON.parse(event.body || ‘{}’); }
catch { return err(‘Invalid JSON’, 400); }

const { vehicle, year, text, srcType, srcUrl } = body;
if (!vehicle || !year || !text) return err(‘vehicle, year and text required’, 400);

const yr = parseInt(year);

// Load existing records for duplicate detection
const existing = await query(
`SELECT id, title, summary FROM community WHERE vehicle_key = $1 AND year = $2 AND status = 'active'`,
[vehicle, yr]
);

const sys = `You are a vehicle issue researcher extracting structured problems from owner-written content.
Extract every distinct vehicle problem or defect mentioned.
Return ONLY a valid JSON array. Empty array [] if none found. No markdown.
[{
“title”: “plain English issue title max 8 words”,
“component”: “affected component”,
“severity”: “CRITICAL or MODERATE or LOW”,
“summary”: “2-3 sentence plain English description”,
“symptoms”: [“symptom 1”, “symptom 2”],
“remedy”: “known fix or empty string”,
“bulletinRef”: “TSB/bulletin number if mentioned else empty string”,
“confidence”: “HIGH or MEDIUM or LOW”,
“likelyMatchId”: “id from existing records if duplicate else null”,
“likelyMatchReason”: “brief reason or null”
}]

Existing records:
${JSON.stringify(existing.map(r => ({ id: r.id, title: r.title })))}`;

let issues = [];
try {
const msg = await ai.messages.create({
model: ‘claude-haiku-4-5-20251001’,
max_tokens: 2000,
system: sys,
messages: [{ role: ‘user’, content: text }],
});
const txt = msg.content[0]?.text || ‘’;
const match = txt.match(/[[\s\S]*]/);
if (match) issues = JSON.parse(match[0]);
} catch (e) {
console.error(‘Research AI error:’, e);
return err(’AI extraction failed: ’ + e.message);
}

// Store each extracted issue in review_queue
const queued = [];
for (const issue of issues) {
const rows = await query(
`INSERT INTO review_queue (vehicle_key, year, extracted, source_type, source_url, confidence, likely_match_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
[vehicle, yr, JSON.stringify(issue), srcType || ‘unknown’, srcUrl || null, issue.confidence || ‘MEDIUM’, issue.likelyMatchId || null]
);
queued.push({ …issue, queueId: rows[0]?.id });
}

return ok({ issues: queued, count: queued.length });
}
