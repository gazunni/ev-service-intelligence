import Anthropic from '@anthropic-ai/sdk';

// ── IN-MEMORY CACHE ───────────────────────────────────────────────────────
// Caches expensive PDF/URL extraction results by URL
// TTL: 24 hours — avoids repeat Claude API calls for same document
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, ts: Date.now() });
}

function ai() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── AI OUTPUT VALIDATION ─────────────────────────────────────────────────
const VALID_SEVERITIES = new Set(['CRITICAL', 'MODERATE', 'LOW']);
const VALID_VEHICLES   = new Set(['equinox_ev', 'blazer_ev', 'mach_e', 'honda_prologue', 'tesla_model_3', 'tesla_model_y']);

export function validateRecallExtraction(data) {
  if (!data || typeof data !== 'object') throw new Error('AI returned invalid JSON');
  // Sanitize fields — never trust raw AI output going into DB
  return {
    campaign:          (data.campaign || '').toString().substring(0, 20),
    title:             (data.title    || '').toString().substring(0, 120),
    summary:           (data.summary  || '').toString().substring(0, 2000),
    risk:              (data.risk     || '').toString().substring(0, 1000),
    remedy:            (data.remedy   || '').toString().substring(0, 1000),
    units:             (data.units    || '').toString().substring(0, 20),
    affected_vehicles: (Array.isArray(data.affected_vehicles) ? data.affected_vehicles : [])
      .filter(v => v && VALID_VEHICLES.has(v.vehicle))
      .map(v => ({ vehicle: v.vehicle, years: (v.years||[]).filter(y => Number.isInteger(y) && y >= 2020 && y <= 2030) })),
  };
}

export function validateTSBExtraction(data) {
  if (!data || typeof data !== 'object') throw new Error('AI returned invalid JSON');
  return {
    bulletin:          (data.bulletin  || '').toString().substring(0, 30),
    title:             (data.title     || '').toString().substring(0, 120),
    component:         (data.component || '').toString().substring(0, 100),
    severity:          VALID_SEVERITIES.has(data.severity) ? data.severity : 'MODERATE',
    summary:           (data.summary   || '').toString().substring(0, 2000),
    remedy:            (data.remedy    || '').toString().substring(0, 1000),
    affected_vehicles: (Array.isArray(data.affected_vehicles) ? data.affected_vehicles : [])
      .filter(v => v && VALID_VEHICLES.has(v.vehicle))
      .map(v => ({ vehicle: v.vehicle, years: (v.years||[]).filter(y => Number.isInteger(y) && y >= 2020 && y <= 2030) })),
  };
}

const VEHICLE_MAP = `equinox_ev=Chevrolet Equinox EV, blazer_ev=Chevrolet Blazer EV, mach_e=Ford Mustang Mach-E, honda_prologue=Honda Prologue, tesla_model_3=Tesla Model 3, tesla_model_y=Tesla Model Y`;

// ── SUMMARIZE NHTSA RECALL (sweep) ───────────────────────────────────────
export async function summarizeRecall(item, vehicleName) {
  const prompt = `Summarize this NHTSA recall for ${vehicleName} owners. Return ONLY JSON: {"component":"...","severity":"CRITICAL|MODERATE|LOW","title":"max 8 words","risk":"...","remedy":"..."}`;
  const content = `Component: ${item.Component||''}\nSummary: ${item.Summary||''}\nConsequence: ${item.Consequence||''}\nRemedy: ${item.Remedy||''}`;
  try {
    const msg = await ai().messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: prompt + '\n\n' + content }]
    });
    const match = (msg.content[0]?.text || '').match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// ── SUMMARIZE NHTSA TSB (sweep) ──────────────────────────────────────────
export async function summarizeTSB(item, vehicleName) {
  const prompt = `Summarize this NHTSA TSB for ${vehicleName} owners. Return ONLY JSON: {"component":"...","severity":"MODERATE|LOW","title":"max 8 words","summary":"2 sentences","remedy":"..."}`;
  const content = `Bulletin: ${item.tsbNumber||''}\nSummary: ${item.Summary||''}`;
  try {
    const msg = await ai().messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 400,
      messages: [{ role: 'user', content: prompt + '\n\n' + content }]
    });
    const match = (msg.content[0]?.text || '').match(/\{[\s\S]*?\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

// ── BROWSER-LIKE FETCH (bypasses 403 blocks on PDF hosts) ───────────────
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.google.com/',
};
async function fetchWithHeaders(url) {
  const r = await fetch(url, { headers: BROWSER_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching URL`);
  return r;
}

// ── EXTRACT RECALL FROM PDF/URL ───────────────────────────────────────────
export async function extractRecallFromUrl(url) {
  const cached = cacheGet('recall:' + url);
  if (cached) { console.log('cache hit: recall', url); return cached; }
  const r = await fetchWithHeaders(url);
  const contentType = r.headers.get('content-type') || '';
  const isPdf = contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf');

  let messageContent;
  if (isPdf) {
    const base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: `Extract NHTSA recall fields. Respond ONLY with valid JSON, no markdown. Fields: campaign, title, summary, risk, remedy, units, affected_vehicles.\nMap vehicles: ${VEHICLE_MAP}.\nExample affected_vehicles: [{"vehicle":"mach_e","years":[2021,2022]}]. Empty array if none match.` }
    ];
  } else {
    const text = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 12000);
    messageContent = `Extract NHTSA recall fields. Respond ONLY with valid JSON. Fields: campaign, title, summary, risk, remedy, units, affected_vehicles.\n\n${text}`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You extract NHTSA recall data. Respond ONLY with a valid JSON object, no markdown. Map vehicles: ${VEHICLE_MAP}.`,
      messages: [{ role: 'user', content: messageContent }],
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Claude API error');
  const raw = (data.content?.[0]?.text || '{}').replace(/```json|```/g, '').trim();
  const result = JSON.parse(raw);
  cacheSet('recall:' + url, result);
  return result;
}

// ── EXTRACT TSB FROM PDF/URL ──────────────────────────────────────────────
export async function extractTSBFromUrl(url) {
  const cached = cacheGet('tsb:' + url);
  if (cached) { console.log('cache hit: tsb', url); return cached; }
  const isPdf = /\.pdf$/i.test(url) || url.includes('/odi/tsbs/');
  let messageContent;

  if (isPdf) {
    const r = await fetchWithHeaders(url);
    const base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: `Extract TSB information. Return ONLY valid JSON: {"bulletin":"...","title":"max 10 words","component":"...","severity":"CRITICAL|MODERATE|LOW","summary":"2-3 sentences","remedy":"...","affected_vehicles":[{"vehicle":"key","years":[2024]}]}\nMap vehicles: ${VEHICLE_MAP}. Empty array if none match. Return ONLY JSON.` }
    ];
  } else {
    const r = await fetchWithHeaders(url);
    const text = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 10000);
    messageContent = `Extract TSB info. Return ONLY JSON: {bulletin,title,component,severity,summary,remedy,affected_vehicles}\n\n${text}`;
  }

  const msgOpts = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: messageContent }],
  };
  if (isPdf) msgOpts.betas = ['pdfs-2024-09-25'];

  const msg = await ai().messages.create(msgOpts);
  const rawText = msg.content[0]?.text || '';
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse AI response');
  const result = JSON.parse(match[0]);
  cacheSet('tsb:' + url, result);
  return result;
}

// ── EXTRACT COMMUNITY ISSUE FROM FORUM THREAD ("Generified" © 2026) ────────
// Synthesizes a forum thread into an anonymized, structured community issue.
// No personal data, usernames, or quoted text is preserved — only the
// generified pattern: what the problem is, how common, what helps.
export async function extractForumThread(url) {
  const cached = cacheGet('forum:' + url);
  if (cached) { console.log('cache hit: forum', url); return cached; }

  const r = await fetchWithHeaders(url);

  // Strip HTML tags, collapse whitespace, limit size
  const raw = await r.text();
  const text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .substring(0, 18000);

  const prompt = `You are analyzing a community forum thread about an electric vehicle issue.
Your job is to "generify" the thread — synthesize it into an anonymized, structured issue report.
Do NOT quote any specific user. Do NOT include usernames, dates, or personal details.
Only extract the pattern: what the problem is, how widespread it seems, what helps.

Respond ONLY with valid JSON, no markdown, no preamble. Fields:

{
  "title": "Short descriptive title of the issue (max 80 chars)",
  "component": "Affected system/component (e.g. ELECTRICAL SYSTEM, BRAKES, SOFTWARE)",
  "severity": "CRITICAL | MODERATE | LOW",
  "summary": "2-4 sentence generified description of the issue pattern. No personal details. No quotes.",
  "symptoms": ["symptom 1", "symptom 2"],
  "remedy": "Known fixes or workarounds reported by the community, or empty string if none",
  "frequency": "WIDESPREAD | COMMON | OCCASIONAL | RARE — your assessment of how many owners affected",
  "confidence": "HIGH | MEDIUM | LOW — based on number of corroborating reports and consistency",
  "confidence_reason": "One sentence explaining the confidence rating",
  "affected_vehicles": [{"vehicle": "vehicle_key", "years": [2022, 2023]}],
  "source_type": "community_forum"
}

Vehicle keys: ${VEHICLE_MAP}

Forum thread content:
${text}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You synthesize forum threads into generified, anonymized vehicle issue reports.
You never quote users directly. You never include personal information.
You assess confidence based on how many distinct voices report the same pattern.
Respond ONLY with a valid JSON object.`,
      messages: [{ role: 'user', content: prompt }],
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Claude API error');
  const cleaned = (data.content?.[0]?.text || '{}').replace(/\`\`\`json|\`\`\`/g, '').trim();
  const result = JSON.parse(cleaned);
  cacheSet('forum:' + url, result);
  return result;
}

// ── EXTRACT RECALL FROM BASE64 PDF (client-uploaded, bypasses 403) ─────────
export async function extractRecallFromBase64(base64, filename) {
  const cacheKey = 'recall-b64:' + filename + ':' + base64.substring(0, 32);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const messageContent = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    { type: 'text', text: `Extract NHTSA recall fields. Respond ONLY with valid JSON, no markdown. Fields: campaign, title, summary, risk, remedy, units, affected_vehicles.\nMap vehicles: ${VEHICLE_MAP}.\nExample affected_vehicles: [{"vehicle":"mach_e","years":[2021,2022]}]. Empty array if none match.` }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You extract NHTSA recall data. Respond ONLY with a valid JSON object. Map vehicles: ${VEHICLE_MAP}.`,
      messages: [{ role: 'user', content: messageContent }],
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Claude API error');
  const raw = (data.content?.[0]?.text || '{}').replace(/\`\`\`json|\`\`\`/g, '').trim();
  const result = JSON.parse(raw);
  cacheSet(cacheKey, result);
  return result;
}

// ── EXTRACT TSB FROM BASE64 PDF (client-uploaded, bypasses 403) ──────────
export async function extractTSBFromBase64(base64, filename) {
  const cacheKey = 'tsb-b64:' + filename + ':' + base64.substring(0, 32);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const messageContent = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    { type: 'text', text: `Extract TSB information. Return ONLY valid JSON: {"bulletin":"...","title":"max 10 words","component":"...","severity":"CRITICAL|MODERATE|LOW","summary":"2-3 sentences","remedy":"...","affected_vehicles":[{"vehicle":"key","years":[2024]}]}\nMap vehicles: ${VEHICLE_MAP}. Empty array if none match. Return ONLY JSON.` }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You extract TSB data from PDFs. Respond ONLY with a valid JSON object. Map vehicles: ${VEHICLE_MAP}.`,
      messages: [{ role: 'user', content: messageContent }],
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Claude API error');
  const raw = (data.content?.[0]?.text || '{}').replace(/\`\`\`json|\`\`\`/g, '').trim();
  const result = JSON.parse(raw);
  cacheSet(cacheKey, result);
  return result;
}

// ── MATCH/CLASSIFY COMMUNITY SUBMISSION ──────────────────────────────────
export async function classifySubmission(title, detail, bulletin, existing) {
  const msg = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    system: `Vehicle service analyst. Match new report against existing records semantically. Return ONLY JSON: {"matchFound":true/false,"matchId":"id or null","matchConfidence":0.0-1.0,"component":"...","severity":"CRITICAL|MODERATE|LOW","cleanTitle":"max 8 words","summary":"2-3 sentences"}`,
    messages: [{ role: 'user', content: 'New: ' + JSON.stringify({ title, detail, bulletin }) + '\nExisting: ' + JSON.stringify(existing.slice(0, 20).map(r => ({ id: r.id, title: r.title }))) }]
  });
  const match = (msg.content[0]?.text || '').match(/\{[\s\S]*?\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ── EXTRACT ISSUES FROM RESEARCH TEXT ────────────────────────────────────
export async function extractResearchIssues(text, existing) {
  const msg = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 2000,
    system: `Extract vehicle issues from owner text. Return ONLY a JSON array: [{"title":"...","component":"...","severity":"CRITICAL|MODERATE|LOW","summary":"2-3 sentences","symptoms":["..."],"remedy":"...","bulletinRef":"...","confidence":"HIGH|MEDIUM|LOW","likelyMatchId":"id or null","likelyMatchReason":"..."}]\nExisting: ${JSON.stringify(existing.map(r => ({ id: r.id, title: r.title })))}`,
    messages: [{ role: 'user', content: text }]
  });
  const txt = msg.content[0]?.text || '';
  const match = txt.match(/\[[\s\S]*\]/);
  return match ? JSON.parse(match[0]) : [];
}
