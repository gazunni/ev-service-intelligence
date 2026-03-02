// get-data.js — Handles storage, NHTSA API, AI calls, and helper functions

export const VEHICLES = {
  equinox_ev: { make:'Chevrolet', model:'Equinox EV', nhtsa_make:'chevrolet', nhtsa_model:'Equinox%20EV' },
  blazer_ev:  { make:'Chevrolet', model:'Blazer EV',  nhtsa_make:'chevrolet', nhtsa_model:'Blazer%20EV' },
  mach_e:     { make:'Ford', model:'Mustang Mach-E', nhtsa_make:'ford', nhtsa_model:'Mach-E' },
};

export function getVehicle() { return ['equinox_ev','blazer_ev','mach_e'][document.getElementById('selModel').selectedIndex]; }
export function getYear() { return document.getElementById('selYear').value; }

// --- Simple localStorage database helpers ---
export async function dbGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
export async function dbSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){} }
export async function dbList(prefix) { try { return Object.keys(localStorage).filter(k => k.startsWith(prefix)); } catch(e){ return []; } }
export function sk(type, vkey, year, id){ return `${type}:${vkey}:${year}:${id}`.replace(/[\s\/'"]/g,'-').toLowerCase().substring(0,190); }

// --- NHTSA API ---
export async function fetchRecalls(vkey, year){
  const v = VEHICLES[vkey];
  try {
    const r = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${v.nhtsa_make}&model=${v.nhtsa_model}&modelYear=${year}`);
    if(!r.ok) return [];
    const d = await r.json();
    return d.results || [];
  } catch(e) { return []; }
}

// --- Claude API helpers (must have API key somewhere client-side or via Netlify Function) ---
export async function claudeCall(system, user, maxTokens=1000){
  try{
    const resp = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:maxTokens, system, messages:[{role:'user', content:user}] })
    });
    const d = await resp.json();
    return d.content?.map(c => c.text || '').join('') || '';
  } catch(e){ return ''; }
}

export async function aiSummarizeRecalls(recalls, vkey, year){
  if(!recalls.length) return [];
  const v = VEHICLES[vkey];
  const text = await claudeCall(
    `You are a vehicle safety expert. Summarize these recalls for ${v.make} ${v.model} ${year} owners. Return ONLY valid JSON array:\n[{"id":"campaign#","date":"YYYY-MM-DD","component":"component","severity":"CRITICAL|MODERATE|LOW","title":"short title","risk":"safety risk","remedy":"dealer fix","affectedUnits":number_or_null}]`,
    JSON.stringify(recalls), 2000
  );
  try { return JSON.parse(text.replace(/```json|```/g,'').trim()); } catch(e){ return []; }
}

// --- Known issues seeding ---
export async function seedKnownIssues(vkey, year){
  const now = Date.now();
  const KNOWN = {
    equinox_ev: [
      {id:'pip-water-ingress', title:'Passenger Floor Water Ingress / Mold Risk', component:'Body — Floor Seams / A/C Drain', severity:'MODERATE', source:'community', sourcePills:['Facebook Group','Forum','Dealer Confirmed'], summary:'Water accumulates under passenger-side carpet...', symptoms:['wet carpet passenger side','musty smell interior','mold under carpet'], remedy:'Dealer inspects and seals floor seams', bulletinRef:'Not filed with NHTSA', confirmations:47, year, links:[]},
      {id:'pip-vihp-calibration', title:'VIHP Regen / Brake Feel Inconsistency', component:'Powertrain — Regenerative Braking', severity:'LOW', source:'community', sourcePills:['Reddit','Forum'], summary:'Inconsistent one-pedal driving behavior...', symptoms:['inconsistent regen braking','brake pedal feel varies'], remedy:'Check for pending OTA software updates', bulletinRef:'No NHTSA filing', confirmations:23, year, links:[]},
    ],
    blazer_ev: [
      {id:'pip-blazer-software-launch', title:'Launch Software Bugs — Multiple Systems', component:'Software / Infotainment / ADAS', severity:'MODERATE', source:'community', sourcePills:['Forum','Reddit','Dealer Confirmed'], summary:'2024 Blazer EV launched with widespread software issues...', symptoms:['infotainment freezing','ADAS errors'], remedy:'Ensure vehicle has latest software', bulletinRef:'Multiple TSBs issued', confirmations:89, year, links:[]},
    ],
    mach_e: [
      {id:'pip-mache-12v-drain', title:'12V Battery Drain After Extended Parking', component:'Electrical — 12V Auxiliary Battery', severity:'MODERATE', source:'community', sourcePills:['Reddit','Forum'], summary:'Mach-E 12V auxiliary battery depletes after sitting several days...', symptoms:['dead 12v battery','car won\'t unlock'], remedy:'Ford issued updated software', bulletinRef:'Multiple TSBs filed', confirmations:112, year, links:[{label:'r/MachE discussion', type:'reddit', url:'https://reddit.com/r/MacHE'}]},
    ]
  };
  for(const issue of (KNOWN[vkey]||[])){
    const k = sk('community', vkey, year, issue.id);
    if(!(await dbGet(k))) await dbSet(k,{ ...issue, ts: now });
  }
}

// --- UI helpers ---
export function setLoading(id){ document.getElementById(id).innerHTML = '<div class="loading"><div class="spinner"></div><span>Fetching...</span></div>'; }
export function openSection(n){ document.getElementById('body'+cap(n)).classList.add('open'); document.getElementById('chv'+cap(n)).classList.add('open'); }
export function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
