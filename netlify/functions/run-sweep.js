// functions/run-sweep.js
import fetch from 'node-fetch';
import { Client } from 'neon-js'; // placeholder for your Neon client setup

const VEHICLES = {
  equinox_ev: { make:'Chevrolet', model:'Equinox EV', nhtsa_make:'chevrolet', nhtsa_model:'Equinox%20EV' },
  blazer_ev:  { make:'Chevrolet', model:'Blazer EV',  nhtsa_make:'chevrolet', nhtsa_model:'Blazer%20EV' },
  mach_e:     { make:'Ford',      model:'Mustang Mach-E', nhtsa_make:'ford',  nhtsa_model:'Mach-E' },
};

async function fetchRecalls(vkey, year) {
  const v = VEHICLES[vkey];
  try {
    const res = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${v.nhtsa_make}&model=${v.nhtsa_model}&modelYear=${year}`);
    if(!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch(e) { return []; }
}

async function claudeCall(system, user, maxTokens=1000){
  try{
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','X-API-Key':process.env.CLAUDE_KEY},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:maxTokens,system,messages:[{role:'user',content:user}]})
    });
    const d = await resp.json();
    return d.content?.map(c=>c.text||'').join('')||'';
  } catch(e){ return ''; }
}

async function aiSummarizeRecalls(recalls, vkey, year) {
  if(!recalls.length) return [];
  const v = VEHICLES[vkey];
  const text = await claudeCall(
    `You are a vehicle safety expert. Summarize these recalls for ${v.make} ${v.model} ${year} owners. Return ONLY a valid JSON array, no markdown.`,
    JSON.stringify(recalls),
    2000
  );
  try { return JSON.parse(text.replace(/```json|```/g,'').trim()); }
  catch(e){ return []; }
}

// Neon DB helper
const neon = new Client({ connectionString: process.env.NEON_URI });

async function storeRecord(table, record){
  await neon.query(`INSERT INTO ${table} (id, data, ts) VALUES ($1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET data=$2, ts=NOW()`, [record.id, JSON.stringify(record)]);
}

export async function handler(event, context) {
  const { vehicle, year } = event.queryStringParameters || {};
  if(!vehicle || !year || !VEHICLES[vehicle]) return { statusCode:400, body:'Missing or invalid vehicle/year' };

  // Fetch recalls
  const rawRecalls = await fetchRecalls(vehicle, year);
  const summarized = await aiSummarizeRecalls(rawRecalls, vehicle, year);

  // Seed known issues (example: equinox)
  const KNOWN = {
    equinox_ev: [
      { id:'pip-water-ingress', title:'Passenger Floor Water Ingress', component:'Body — Floor Seams', severity:'MODERATE', summary:'Water accumulates under passenger carpet.', remedy:'Dealer inspects and seals floor seams.', confirmations:47 },
    ],
  };
  const knownIssues = (KNOWN[vehicle]||[]).map(i => ({ ...i, year }));

  // Save to Neon
  for(const rec of [...summarized, ...knownIssues]) await storeRecord('records', rec);

  return {
    statusCode:200,
    body: JSON.stringify({ message:'Sweep complete', recalls:summarized, knownIssues })
  };
}
