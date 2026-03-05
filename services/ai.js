import Anthropic from '@anthropic-ai/sdk';

function ai() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const VEHICLE_MAP = `equinox_ev=Chevrolet Equinox EV, blazer_ev=Chevrolet Blazer EV, mach_e=Ford Mustang Mach-E, honda_prologue=Honda Prologue`;

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

// ── EXTRACT RECALL FROM PDF/URL ───────────────────────────────────────────
export async function extractRecallFromUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching URL`);
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
  return JSON.parse(raw);
}

// ── EXTRACT TSB FROM PDF/URL ──────────────────────────────────────────────
export async function extractTSBFromUrl(url) {
  const isPdf = /\.pdf$/i.test(url) || url.includes('/odi/tsbs/');
  let messageContent;

  if (isPdf) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to fetch PDF: ${r.status}`);
    const base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    messageContent = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: `Extract TSB information. Return ONLY valid JSON: {"bulletin":"...","title":"max 10 words","component":"...","severity":"CRITICAL|MODERATE|LOW","summary":"2-3 sentences","remedy":"...","affected_vehicles":[{"vehicle":"key","years":[2024]}]}\nMap vehicles: ${VEHICLE_MAP}. Empty array if none match. Return ONLY JSON.` }
    ];
  } else {
    const r = await fetch(url);
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
  return JSON.parse(match[0]);
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
