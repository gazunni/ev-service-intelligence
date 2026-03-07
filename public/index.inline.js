//index.inline.js
// ── HELPERS ──────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function getVehicle(){ return document.getElementById('selModel').value; }
function getYear(){ return document.getElementById('selYear').value; }

const VEHICLE_LABELS = {
  equinox_ev: 'Chevrolet Equinox EV',
  blazer_ev: 'Chevrolet Blazer EV',
  mach_e: 'Ford Mustang Mach-E',
  honda_prologue: 'Honda Prologue',
  tesla_model_3: 'Tesla Model 3',
  tesla_model_y: 'Tesla Model Y',
};

function vehicleLabel(key) {
  return VEHICLE_LABELS[key] || key || 'Unknown vehicle';
}

function canonicalKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectVehicleKey(make, model) {
  const m = canonicalKey(make);
  const d = canonicalKey(model);
  if (m === 'chevrolet' && d === 'equinoxev') return 'equinox_ev';
  if (m === 'chevrolet' && d === 'blazerev') return 'blazer_ev';
  if (m === 'ford' && (d === 'mustangmache' || d === 'mache')) return 'mach_e';
  if (m === 'honda' && d === 'prologue') return 'honda_prologue';
  if (m === 'tesla' && d === 'model3') return 'tesla_model_3';
  if (m === 'tesla' && d === 'modely') return 'tesla_model_y';
  return '';
}

// ── GAZUNNI STATUS ────────────────────────────
function setGZ(state, msg) {
  const icon = document.getElementById('gzIcon');
  const status = document.getElementById('gzStatus');
  icon.className = 'gz-icon ' + (state === 'loading' ? 'loading' : state === 'err' ? 'err' : 'done');
  status.className = 'gz-status ' + (state === 'loading' ? 'live' : state === 'err' ? 'err' : 'ok');
  status.textContent = msg;
}

// ── API ───────────────────────────────────────
const API_TIMEOUT_MS = 15000;
async function apiFetch(path, opts={}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const r = await fetch(path, { ...opts, signal: controller.signal });
    clearTimeout(tid);
    if (!r.ok) throw new Error((await r.json().catch(()=>({error:r.statusText}))).error || r.statusText);
    return await r.json();
  } catch(e) {
    clearTimeout(tid);
    throw new Error(e.name === 'AbortError' ? 'Request timed out' : e.message);
  }
}

// ── LOAD ──────────────────────────────────────
let loadedSections = 0;
let totalSections = 3;

// ── PERSISTENCE ───────────────────────────────
function savePrefs() {
  try {
    localStorage.setItem('gz_vehicle', document.getElementById('selModel').value);
    localStorage.setItem('gz_year',    document.getElementById('selYear').value);
  } catch(e) {}
}
function restorePrefs() {
  try {
    const v = localStorage.getItem('gz_vehicle');
    const y = localStorage.getItem('gz_year');
    if (v) { document.getElementById('selModel').value = v; updateYearOptions(); }
    if (y) { document.getElementById('selYear').value = y; }
  } catch(e) {}
}

// ── SEVERITY BANNER ────────────────────────────
function updateSeverityBanner(recalls) {
  const banner = document.getElementById('sevBanner');
  if (!recalls || recalls.length === 0) { banner.style.display = 'none'; return; }
  let crit = 0, mod = 0, low = 0;
  for (const r of recalls) {
    if (r.severity === 'CRITICAL') crit++;
    else if (r.severity === 'LOW') low++;
    else mod++;
  }
  const critEl  = document.getElementById('bannerCrit');
  const modEl   = document.getElementById('bannerMod');
  const lowEl   = document.getElementById('bannerLow');
  document.getElementById('bannerCritCount').textContent = crit;
  document.getElementById('bannerModCount').textContent  = mod;
  document.getElementById('bannerLowCount').textContent  = low;
  critEl.style.display = crit > 0 ? 'flex' : 'none';
  modEl.style.display  = mod  > 0 ? 'flex' : 'none';
  lowEl.style.display  = low  > 0 ? 'flex' : 'none';
  // Vehicle label
  const vLabel = document.getElementById('selModel').options[document.getElementById('selModel').selectedIndex]?.text || '';
  const yr = document.getElementById('selYear').value;
  document.getElementById('bannerVehicle').textContent = vLabel + ' · ' + yr;
  banner.style.display = 'flex';
  // Click to filter by severity
  critEl.onclick = () => filterBySeverity('CRITICAL');
  modEl.onclick  = () => filterBySeverity('MODERATE');
  lowEl.onclick  = () => filterBySeverity(null);
}

function filterBySeverity(sev) {
  const cards = document.querySelectorAll('#cards-recall .card');
  let shown = 0;
  for (const card of cards) {
    const bar = card.querySelector('.sev-bar');
    if (!sev || (sev === 'CRITICAL' && bar?.classList.contains('sv-critical')) ||
                (sev === 'MODERATE' && bar?.classList.contains('sv-moderate')) ||
                (sev === 'LOW'      && bar?.classList.contains('sv-low'))) {
      card.classList.remove('hidden'); shown++;
    } else {
      card.classList.add('hidden');
    }
  }
  const meta = document.getElementById('searchMeta');
  if (sev && meta) meta.textContent = `Showing ${shown} ${sev.toLowerCase()} recalls — click again to clear`;
  if (!sev) clearSearch();
}

// ── SEARCH / FILTER ────────────────────────────
let searchTimeout = null;
function initSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(runSearch, 180);
    clear.style.display = input.value ? 'block' : 'none';
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });
  clear.addEventListener('click', clearSearch);
  // Cmd/Ctrl+K to focus search
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); input.focus(); input.select(); }
  });
}

function runSearch() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  const meta = document.getElementById('searchMeta');
  if (!q) { clearSearch(); return; }
  const allCards = document.querySelectorAll('.card');
  let shown = 0;
  for (const card of allCards) {
    const text = card.textContent.toLowerCase();
    const match = q.split(' ').every(word => text.includes(word));
    card.classList.toggle('hidden', !match);
    if (match) shown++;
  }
  // Auto-expand sections that have matches
  document.querySelectorAll('.sec-body').forEach(body => {
    const hasVisible = [...body.querySelectorAll('.card')].some(c => !c.classList.contains('hidden'));
    if (hasVisible) body.classList.add('open');
  });
  if (meta) meta.textContent = shown === 0 ? 'No results' : `${shown} result${shown !== 1 ? 's' : ''}`;
}

function clearSearch() {
  const input = document.getElementById('searchInput');
  const clear = document.getElementById('searchClear');
  const meta  = document.getElementById('searchMeta');
  if (input) input.value = '';
  if (clear) clear.style.display = 'none';
  if (meta)  meta.textContent = '';
  document.querySelectorAll('.card.hidden').forEach(c => c.classList.remove('hidden'));
}

async function loadAll() {
  // Close all open panels and collapse sections on vehicle/year change
  document.querySelectorAll('.tool-panel.open').forEach(p => p.classList.remove('open'));
  document.querySelectorAll('.sec-body.open').forEach(s => s.classList.remove('open'));
  document.querySelectorAll('button.chv').forEach(b => { b.textContent = 'Show'; });
  loadedSections = 0;
  const vkey = getVehicle(), year = getYear();
  setGZ('loading', 'Loading data…');
  // All sections start collapsed
  ['recall','tsb','comm'].forEach(s => {
    document.getElementById('cards-'+s).innerHTML = '<div class="loading"><div class="spin"></div><span>Loading…</span></div>';
    document.getElementById('cnt-'+s).textContent = '—';
  });

  // Load all in parallel, independently
  loadSection('community', vkey, year);
  loadSection('recalls', vkey, year);
  loadSection('tsbs', vkey, year);
}

async function loadSection(type, vkey, year) {
  const key = type==='community'?'comm':type==='recalls'?'recall':'tsb';
  try {
    const rows = await apiFetch(`/api/${type}?vehicle=${vkey}&year=${year}`);
    renderSection('cards-'+key, 'cnt-'+key, rows, key);
    if (key === 'recall') updateSeverityBanner(rows);
    loadedSections++;
    if (loadedSections >= totalSections) {
      const rc = parseInt(document.getElementById('sn-recall').textContent)||0;
      const tc = parseInt(document.getElementById('sn-tsb').textContent)||0;
      const cc = parseInt(document.getElementById('sn-comm').textContent)||0;
      const total = rc+tc+cc;
      if (total > 0) {
        setGZ('done', `Loaded — ${rc} recalls · ${tc} TSBs · ${cc} community issues`);
      } else {
        setGZ('done', 'Connected — no data found. Run an AI Sweep to fetch NHTSA data.');
      }
    }
  } catch(e) {
    loadedSections++;
    document.getElementById('cnt-'+key).textContent = '0';
    document.getElementById('sn-'+key).textContent = '0';
    document.getElementById('cards-'+key).innerHTML = `<div class="empty"><div class="ei">⚠️</div><div class="et">${esc(e.message)}<br><button class="sweep-btn" style="margin-top:10px;font-size:10px" data-retry="1">↻ Retry</button></div></div>`;
    if (loadedSections >= totalSections) setGZ('err', 'Some sections failed to load');
  }
}

// ── SECTIONS TOGGLE ───────────────────────────
function toggleSec(n) {
  const body = document.getElementById('body-'+n);
  const btn = document.getElementById('chv-'+n);
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  if (btn) btn.textContent = isOpen ? 'Show' : 'Hide';
}
function openSec(n) {
  const body = document.getElementById('body-'+n);
  const btn = document.getElementById('chv-'+n);
  body.classList.add('open');
  if (btn) btn.textContent = 'Hide';
}
function toggleCard(id) {
  const el = document.getElementById(id);
  const btn = document.querySelector('[data-btn="'+id+'"]');
  if (el) {
    const isOpen = el.classList.toggle('open');
    if (btn) btn.textContent = isOpen ? 'Close' : 'More Info';
  }
}

// ── TOOL PANELS ───────────────────────────────
function togglePanel(id) {
  const panel = document.getElementById(id);
  const wasOpen = panel.classList.contains('open');
  panel.classList.toggle('open');
  // Clear admin mode when closing admin panel
  if (id === 'adminPanel' && wasOpen) {
    window.__adminMode = false;
    const _vk = document.getElementById('selModel').value;
    const _yr = document.getElementById('selYear').value;
    loadSection('recalls', _vk, _yr);
    loadSection('tsbs', _vk, _yr);
    loadSection('community', _vk, _yr);
  }
  // Auto-load dashboard when opening admin panel
  if (id === 'adminPanel' && !wasOpen) {
    loadAdminDashboard();
  }
}

// ── RENDER ────────────────────────────────────
function renderSection(cId, countId, items, type) {
  const snId = 'sn-'+(type==='comm'?'comm':type==='recall'?'recall':'tsb');
  const count = items ? items.length : 0;
  document.getElementById(countId).textContent = count;
  document.getElementById(snId).textContent = count;
  if (!count) {
    const msgs = {recall:'No recalls found. Run AI Sweep to fetch NHTSA data.',tsb:'No TSBs found. Run AI Sweep to fetch NHTSA data.',comm:'No community issues yet.'};
    document.getElementById(cId).innerHTML = `<div class="empty"><div class="et">${msgs[type]||'No data.'}</div></div>`;
    return;
  }
  document.getElementById(cId).innerHTML = items.map((item,i)=>buildCard(item,type,i)).join('');
}

function buildCard(rec, type, idx) {
  if(!rec) return '';
  const id = 'card-'+type+'-'+idx;
  const sc = rec.severity==='CRITICAL'?'sv-critical':rec.severity==='LOW'?'sv-low':'sv-moderate';
  const safeArr = v => { if (!v) return []; if (Array.isArray(v)) return v; try { return JSON.parse(v); } catch { return []; } };
  const pills = safeArr(rec.source_pills||rec.sourcePills).map(p=>{
    const c=/nhtsa/i.test(p)?'p-nhtsa':/transport canada/i.test(p)?'p-tc':/reddit/i.test(p)?'p-reddit':/forum/i.test(p)?'p-forum':/dealer/i.test(p)?'p-dealer':/facebook/i.test(p)?'p-facebook':/tsb/i.test(p)?'p-tsb':'p-submitted';
    const icon=/transport canada/i.test(p)?'🍁 ':'';
    return `<span class="pill ${c}">${icon}${esc(p)}</span>`;
  }).join('');
  const symptoms = safeArr(rec.symptoms).map(s=>`<li>${esc(s)}</li>`).join('');
  const links = safeArr(rec.links);
  const linkHtml = links.map(l=>`<a class="ext-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label||'Source')}</a>`).join('');
  const dateStr = rec.created_at ? esc(String(rec.created_at).substring(0,10)) : '';

  return `
<div class="card">
  <div class="card-hdr" data-card="${id}">
    <div class="sev-bar ${sc}"></div>
    <div class="card-meta">
      <div class="card-title">${esc(rec.title||'Unknown Issue')}</div>
      <div class="card-sub">
        ${rec.bulletin_ref ? '<span>'+esc(rec.bulletin_ref)+'</span>' : (rec.raw_nhtsa&&rec.raw_nhtsa.bulletin_ref ? '<span>'+esc(rec.raw_nhtsa.bulletin_ref)+'</span>' : '')}
        ${dateStr ? '<span>· '+dateStr+'</span>' : ''}
        ${rec.severity ? '<span>· '+esc(rec.severity)+'</span>' : ''}
      </div>
      <div class="card-pills">${pills}</div>
    </div>
    <button class="card-chv" data-btn="${id}">More Info</button>
  </div>
  <div class="card-body" id="${id}">
    <div class="cf"><div class="cf-label">Component</div><div class="cf-val">${esc(rec.component||'—')}</div></div>
    ${rec.summary ? '<div class="cf"><div class="cf-label">Summary</div><div class="cf-val">'+esc(rec.summary)+'</div></div>' : ''}
    ${rec.risk ? '<div class="cf"><div class="cf-label">Risk</div><div class="cf-val">'+esc(rec.risk)+'</div></div>' : ''}
    ${symptoms ? '<div class="cf"><div class="cf-label">Symptoms</div><div class="cf-val"><ul class="symp-list">'+symptoms+'</ul></div></div>' : ''}
    ${rec.remedy ? '<div class="cf"><div class="cf-label">Remedy</div><div class="cf-val">'+esc(rec.remedy)+'</div></div>' : ''}
    ${(rec.bulletin_ref||(rec.raw_nhtsa&&rec.raw_nhtsa.bulletin_ref)) ? '<div class="cf"><div class="cf-label">Bulletin</div><div class="cf-val">'+esc(rec.bulletin_ref||rec.raw_nhtsa.bulletin_ref)+'</div></div>' : ''}
    ${(rec.raw_nhtsa&&rec.raw_nhtsa.source_url) ? '<div class="link-row"><a class="ext-link" href="'+esc(rec.raw_nhtsa.source_url)+'" target="_blank" rel="noopener">📄 View '+(type==='recall'?'Recall':'TSB')+' Document</a></div>' : ''}
    ${(type==='recall'&&rec.raw_nhtsa&&rec.raw_nhtsa.NHTSACampaignNumber) ? '<div class="link-row"><a class="ext-link" href="https://www.nhtsa.gov/recalls?nhtsaId='+esc(rec.raw_nhtsa.NHTSACampaignNumber)+'" target="_blank" rel="noopener">🔗 View on NHTSA.gov <span style="font-size:10px;opacity:0.6">(click Documents tab for PDF)</span></a></div>' : ''}
    ${(type==='recall'&&rec.raw_nhtsa&&rec.raw_nhtsa.tc_campaign_id) ? '<div class="link-row"><a class="ext-link" href="https://tc.canada.ca/en/road-transportation/motor-vehicle-safety/defect-investigations-recalls?rec='+esc(rec.raw_nhtsa.tc_campaign_id)+'" target="_blank" rel="noopener">🍁 View on Transport Canada</a></div>' : ''}
    ${rec.affected_units ? '<div class="cf"><div class="cf-label">Units Affected</div><div class="cf-val">'+esc(String(rec.affected_units))+'</div></div>' : ''}
    ${linkHtml ? '<div class="link-row">'+linkHtml+'</div>' : ''}
    ${type==='comm' ? `<div class="conf-bar"><div><div class="conf-num">${esc(String(rec.confirmations||1))}</div><div class="conf-label">Confirmations</div></div><button class="confirm-btn" data-confirm="${esc(rec.id)}">＋ Confirm</button></div>` : ''}
    ${(type==='comm' && window.__adminMode) ? '<div class="apply-panel" id="comm-apply-'+esc(rec.id)+'" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><div class="tsb-vehicles"><div class="tsb-veh-group"><div class="tsb-veh-label">Equinox EV</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Blazer EV</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Mach-E</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Prologue</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Tesla Model 3</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2017"> 2017</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2018"> 2018</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2019"> 2019</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2020"> 2020</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2021"> 2021</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2022"> 2022</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Tesla Model Y</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2020"> 2020</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2021"> 2021</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2022"> 2022</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="comm-apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2026"> 2026</label></div></div></div><button class="submit-btn" style="margin-top:8px;font-size:10px" data-comm-apply-confirm="'+esc(rec.id)+'">＋ Apply to Selected</button><div class="apply-result" id="comm-apply-result-'+esc(rec.id)+'" style="font-size:11px;margin-top:6px"></div></div>' : ''}
    <div class="card-actions">
      <button class="act-btn act-copy" data-copy="${id}">⎘ Copy</button>
      <button class="act-btn act-print" data-print="${id}">⎙ Print</button>
      ${type==='tsb' ? '<button class="act-btn act-apply" data-apply="'+esc(rec.id)+'">⊕ Apply to Vehicles</button>' : ''}
      ${(type==='comm' && window.__adminMode) ? '<button class="act-btn act-apply" data-comm-apply="'+esc(rec.id)+'">⊕ Apply to Vehicles</button>' : ''}
      ${window.__adminMode ? '<button class="act-btn act-delete" data-delete="'+esc(rec.id)+'" data-type="'+type+'" style="color:var(--recall);border-color:var(--recall)">⊗ Delete</button>' : ''}
    </div>
    ${type==='tsb' ? '<div class="apply-panel" id="apply-'+esc(rec.id)+'" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><div class="tsb-vehicles"><div class="tsb-veh-group"><div class="tsb-veh-label">Equinox EV</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="equinox_ev|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Blazer EV</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="blazer_ev|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Mach-E</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="mach_e|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Prologue</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="honda_prologue|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Tesla Model 3</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2017"> 2017</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2018"> 2018</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2019"> 2019</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2020"> 2020</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2021"> 2021</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2022"> 2022</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_3|2026"> 2026</label></div></div><div class="tsb-veh-group"><div class="tsb-veh-label">Tesla Model Y</div><div class="tsb-veh-years"><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2020"> 2020</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2021"> 2021</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2022"> 2022</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2023"> 2023</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2024"> 2024</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2025"> 2025</label><label class="tsb-cb"><input type="checkbox" class="apply-cb" data-src="'+esc(rec.id)+'" value="tesla_model_y|2026"> 2026</label></div></div></div><button class="submit-btn" style="margin-top:8px;font-size:10px" data-apply-confirm="'+esc(rec.id)+'">＋ Apply to Selected</button><div class="apply-result" id="apply-result-'+esc(rec.id)+'" style="font-size:11px;margin-top:6px"></div></div>' : ''}
  </div>
</div>`;
}

// ── AI SWEEP ──────────────────────────────────
async function runSweep() {
  const vkey = getVehicle(), year = getYear();
  const btn = document.getElementById('sweepBtn');
  btn.disabled = true;
  btn.textContent = '⚡ Sweeping…';
  setGZ('loading', 'Running AI sweep against NHTSA…');
  try {
    const res = await apiFetch('/api/sweep', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({vehicle:vkey, year:parseInt(year)}) });
    setGZ('done', `Sweep complete — ${res.recalls||0} recalls, ${res.tsbs||0} TSBs found`);
    loadAll();
  } catch(e) {
    setGZ('err', 'Sweep error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Run AI Sweep';
  }
}

// ── AUTO SWEEP ────────────────────────────────
async function autoSweepIfEmpty(vkey, year) {
  try {
    const [rc, tc] = await Promise.all([
      apiFetch(`/api/recalls?vehicle=${vkey}&year=${year}`),
      apiFetch(`/api/tsbs?vehicle=${vkey}&year=${year}`)
    ]);
    if ((!rc || rc.length===0) && (!tc || tc.length===0)) {
      setGZ('loading', 'Fetching NHTSA data for first time…');
      await apiFetch('/api/sweep', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({vehicle:vkey, year:parseInt(year)}) });
    }
  } catch(e) { /* silent fail */ }
}

// ── SUBMIT ISSUE ─────────────────────────────
async function submitIssue() {
  const vkey=getVehicle(), year=getYear();
  const title=document.getElementById('subTitle').value.trim();
  const detail=document.getElementById('subDetail').value.trim();
  const bulletin=document.getElementById('subBulletin').value.trim();
  const srcType=document.getElementById('subSrcType').value;
  const srcUrl=document.getElementById('subSrcUrl').value.trim();
  const result=document.getElementById('subResult');
  if(!title||!detail){result.textContent='Title and detail required.';return;}
  const btn=document.getElementById('submitIssueBtn');
  btn.disabled=true; btn.textContent='Submitting…';
  result.textContent='';
  try {
    const res = await apiFetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicle:vkey,year:parseInt(year),title,detail,bulletin,sourceUrl:srcUrl,srcType})});
    if(res.action==='confirmed'){
      result.style.color='var(--tsb)';
      result.textContent=`✓ Matched existing issue — added your confirmation (confidence: ${Math.round((res.confidence||0)*100)}%)`;
    } else {
      result.style.color='var(--green)';
      result.textContent='✓ New issue submitted for review.';
    }
    loadAll();
  } catch(e){
    result.style.color='var(--recall)';
    result.textContent='Error: '+e.message;
  } finally { btn.disabled=false; btn.textContent='Submit Issue'; }
}

// ── CONFIRM ISSUE ─────────────────────────────
async function confirmIssue(id, btn) {
  try {
    btn.disabled=true; btn.textContent='…';
    await apiFetch('/api/confirm', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const numEl = btn.closest('.conf-bar').querySelector('.conf-num');
    if(numEl) numEl.textContent = parseInt(numEl.textContent||'1')+1;
    btn.textContent='✓ Confirmed';
  } catch(e){ btn.disabled=false; btn.textContent='＋ Confirm'; }
}

// ── RESEARCH SWEEP ───────────────────────────
async function runResearchSweep() {
  const vkey=getVehicle(), year=getYear();
  const text=document.getElementById('resText').value.trim();
  const srcType=document.getElementById('resSrcType').value;
  const srcUrl=document.getElementById('resSrcUrl').value.trim();
  const results=document.getElementById('resResults');
  if(!text && !srcUrl){results.innerHTML='<div style="color:var(--recall);font-size:11px">Please paste text or enter a source URL.</div>';return;}
  if(!text && srcUrl){ results.innerHTML='<div class="loading"><div class="spin"></div><span>Fetching content from URL…</span></div>'; }
  const btn=document.getElementById('researchSweepBtn');
  btn.disabled=true; btn.textContent='🧠 Extracting…';
  results.innerHTML='<div class="loading"><div class="spin"></div><span>AI is reading the text…</span></div>';
  setGZ('loading', 'Extracting issues from text…');
  try {
    const res = await apiFetch('/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vehicle:vkey,year:parseInt(year),text,srcType,srcUrl})});
    if(!res.issues||!res.issues.length){results.innerHTML='<div style="color:var(--muted);font-size:11px;padding:10px 0">No distinct issues found in this text.</div>';return;}
    results.innerHTML=res.issues.map((issue,i)=>`
      <div class="rq-item">
        <div class="rq-title">${esc(issue.title||'Unknown')}</div>
        <div class="rq-meta">${esc(issue.component||'')} · ${esc(issue.severity||'')} · Confidence: ${esc(issue.confidence||'')}</div>
        <div style="font-size:10px;color:var(--text);margin-bottom:8px">${esc(issue.summary||'')}</div>
        ${issue.likelyMatchId?`<div style="font-size:10px;color:var(--tsb);margin-bottom:8px">⚠ Possible match: ${esc(issue.likelyMatchId)}</div>`:''}
        <div class="rq-actions">
          <button class="approve-btn" data-approve-idx="${i}" data-queue-id="${esc(issue.queueId)}" data-vkey="${vkey}" data-year="${year}">✓ Approve</button>
          <button class="reject-btn" data-reject="1">✗ Reject</button>
        </div>
      </div>`).join('');
  } catch(e){
    results.innerHTML=`<div style="color:var(--recall);font-size:11px">Error: ${esc(e.message)}</div>`;
  } finally { btn.disabled=false; btn.textContent='🧠 Extract Issues'; setGZ('done', 'Extraction complete'); }
}

async function approveIssue(idx, queueId, vkey, year) {
  try {
    await apiFetch('/api/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queueId,vehicle:vkey,year:parseInt(year)})});
    document.querySelectorAll('.rq-item')[idx].innerHTML='<div style="color:var(--green);font-size:11px">✓ Approved and added to community issues.</div>';
    loadAll();
  } catch(e){ alert('Approve failed: '+e.message); }
}

function clearResearch() {
  document.getElementById('resText').value='';
  document.getElementById('resResults').innerHTML='';
  const panel = document.getElementById('researchPanel');
  if (panel) panel.classList.remove('open');
}

// ── APPLY TSB TO MORE VEHICLES ───────────────
async function applyTsb(srcId) {
  const checked = Array.from(document.querySelectorAll(`.apply-cb[data-src="${srcId}"]:checked`))
    .map(cb => { const [v,y] = cb.value.split('|'); return {vehicle:v, year:parseInt(y)}; });
  const result = document.getElementById('apply-result-'+srcId);
  if (!checked.length) { result.style.color='var(--recall)'; result.textContent='Select at least one.'; return; }

  const btn = document.querySelector(`[data-apply-confirm="${srcId}"]`);
  btn.disabled = true; btn.textContent = 'Applying…';
  setGZ('loading', 'Applying TSB to vehicles…');

  try {
    const res = await apiFetch('/api/tsb-clone', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ src_id: srcId, targets: checked })
    });
    result.style.color = 'var(--green)';
    result.textContent = `✓ Applied to ${res.count} vehicle/year combination${res.count>1?'s':''}.`;
    setGZ('done', 'TSB applied');
    document.querySelectorAll(`.apply-cb[data-src="${srcId}"]`).forEach(cb => cb.checked = false);
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = 'Error: ' + e.message;
    setGZ('err', 'Apply failed');
  } finally {
    btn.disabled = false; btn.textContent = '＋ Apply to Selected';
  }
}

async function applyCommunity(srcId) {
  const checked = Array.from(document.querySelectorAll(`.comm-apply-cb[data-src="${srcId}"]:checked`))
    .map(cb => { const [v,y] = cb.value.split('|'); return {vehicle:v, year:parseInt(y)}; });
  const result = document.getElementById('comm-apply-result-'+srcId);
  if (!checked.length) { result.style.color='var(--recall)'; result.textContent='Select at least one.'; return; }
  const btn = document.querySelector(`[data-comm-apply-confirm="${srcId}"]`);
  btn.disabled = true; btn.textContent = 'Applying…';
  try {
    const res = await apiFetch('/api/community-clone', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ src_id: srcId, targets: checked })
    });
    result.style.color = 'var(--green)';
    result.textContent = `✓ Applied to ${res.count} vehicle/year combination${res.count>1?'s':''}.`;
    document.querySelectorAll(`.comm-apply-cb[data-src="${srcId}"]`).forEach(cb => cb.checked = false);
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '＋ Apply to Selected';
  }
}

// ── ADD RECALL DIRECTLY ──────────────────────
function updateRecallSourceUI() {
  const source = document.getElementById('rcSource').value;
  const tcGroup = document.getElementById('rcTcCampaignGroup');
  const nhtsaGroup = document.getElementById('rcCampaignGroup');
  const nhtsaLabel = document.getElementById('rcCampaignLabel');
  if (source === 'tc') {
    nhtsaGroup.style.display = 'none';
    tcGroup.style.display = '';
    document.getElementById('rcTcCampaign').placeholder = 'e.g. 2025-048';
  } else if (source === 'both') {
    nhtsaGroup.style.display = '';
    tcGroup.style.display = '';
    nhtsaLabel.textContent = 'NHTSA Campaign #';
  } else {
    nhtsaGroup.style.display = '';
    tcGroup.style.display = 'none';
    nhtsaLabel.textContent = 'NHTSA Campaign #';
  }
}

async function fetchAndFillRecall() {
  const url       = document.getElementById('rcUrl').value.trim();
  const fileInput = document.getElementById('rcFile');
  const file      = fileInput?.files?.[0];
  const status    = document.getElementById('rcFetchStatus');
  if (!url && !file) { status.textContent = 'Enter a URL or upload a PDF.'; return; }
  const btn = document.getElementById('rcFetchBtn');
  btn.disabled = true; btn.textContent = 'Fetching…';
  status.style.color = 'var(--muted)';
  status.textContent = 'Fetching and reading document…';
  setGZ('loading', 'Reading recall document…');
  try {
    let body;
    if (file) {
      status.textContent = 'Reading PDF locally…';
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      body = JSON.stringify({ pdfBase64: base64, filename: file.name });
    } else {
      body = JSON.stringify({ url });
    }
    const res = await apiFetch('/api/recall-fetch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body
    });
    if (res.campaign)  document.getElementById('rcCampaign').value  = res.campaign;
    if (res.title)     document.getElementById('rcTitle').value     = res.title;
    if (res.summary)   document.getElementById('rcSummary').value   = res.summary;
    if (res.risk)      document.getElementById('rcRisk').value      = res.risk;
    if (res.remedy)    document.getElementById('rcRemedy').value    = res.remedy;
    if (res.units)     document.getElementById('rcUnits').value     = res.units;

    // Auto-check affected vehicle/year boxes from PDF
    document.querySelectorAll('input[name="rc-vehicle"]').forEach(cb => cb.checked = false);
    let autoChecked = 0;
    if (res.affected_vehicles && res.affected_vehicles.length) {
      res.affected_vehicles.forEach(({vehicle, years}) => {
        (years||[]).forEach(yr => {
          const cb = document.querySelector(`input[name="rc-vehicle"][value="${vehicle}|${yr}"]`);
          if (cb) { cb.checked = true; autoChecked++; }
        });
      });
    }
    const vehicleNote = autoChecked > 0
      ? ` Auto-selected ${autoChecked} vehicle/year combination${autoChecked>1?'s':''} — verify before submitting.`
      : ' No matching vehicles auto-detected — please select manually.';
    status.style.color = 'var(--green)';
    status.textContent = '✓ Fields populated from document —' + vehicleNote;
    setGZ('done', 'Recall data extracted');
  } catch(e) {
    status.style.color = 'var(--recall)';
    status.textContent = 'Fetch failed: ' + e.message;
    setGZ('err', 'Fetch failed');
  } finally {
    btn.disabled = false; btn.textContent = '⊕ Fetch & Fill';
  }
}

async function addRecall() {
  const source   = document.getElementById('rcSource').value;
  const campaign = document.getElementById('rcCampaign').value.trim();
  const tcCampaign = document.getElementById('rcTcCampaign')?.value.trim() || '';
  const title    = document.getElementById('rcTitle').value.trim();
  const summary  = document.getElementById('rcSummary').value.trim();
  const risk     = document.getElementById('rcRisk').value.trim();
  const remedy   = document.getElementById('rcRemedy').value.trim();
  const units    = document.getElementById('rcUnits').value.trim();
  const severity = document.getElementById('rcSeverity').value;
  const url      = document.getElementById('rcUrl').value.trim();
  const result   = document.getElementById('rcResult');

  if (!title || !summary) { result.style.color='var(--recall)'; result.textContent='Title and summary are required.'; return; }

  const checked = Array.from(document.querySelectorAll('input[name="rc-vehicle"]:checked')).map(cb => {
    const [vehicle, year] = cb.value.split('|');
    return { vehicle, year: parseInt(year) };
  });
  if (!checked.length) { result.style.color='var(--recall)'; result.textContent='Select at least one vehicle and year.'; return; }

  const btn = document.getElementById('addRecallBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  setGZ('loading', `Adding recall for ${checked.length} vehicle/year combo${checked.length>1?'s':''}…`);
  result.textContent = '';

  try {
    await Promise.all(checked.map(({vehicle, year}) =>
      apiFetch('/api/recall-add', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ vehicle, year, campaign_id: campaign, tc_campaign_id: tcCampaign, title, summary, risk, remedy, affected_units: units, severity, source_url: url, source })
      })
    ));
    result.style.color = 'var(--green)';
    result.textContent = `✓ Recall added for ${checked.length} vehicle/year combination${checked.length>1?'s':''}.`;
    setGZ('done', 'Recall added');
    ['rcCampaign','rcTcCampaign','rcTitle','rcSummary','rcRisk','rcRemedy','rcUnits','rcUrl'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    document.getElementById('rcSource').value = 'nhtsa';
    updateRecallSourceUI();
    document.querySelectorAll('input[name="rc-vehicle"]').forEach(cb => cb.checked = false);
    loadAll();
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = 'Error: ' + e.message;
    setGZ('err', 'Failed to add recall');
  } finally {
    btn.disabled = false; btn.textContent = '＋ Add Recall';
  }
}

// ── ADD TSB DIRECTLY ────────────────────────
async function fetchAndFillTsb() {
  const url      = document.getElementById('tsbUrl').value.trim();
  const fileInput = document.getElementById('tsbFile');
  const file     = fileInput?.files?.[0];
  if (!url && !file) return;
  const btn    = document.getElementById('tsbFetchBtn');
  const status = document.getElementById('tsbFetchStatus');
  btn.disabled = true; btn.textContent = 'Fetching…';
  status.textContent = 'Extracting data from document…';
  try {
    let body;
    if (file) {
      // Client-side PDF read — bypasses server-side 403 blocks
      status.textContent = 'Reading PDF locally…';
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      body = JSON.stringify({ pdfBase64: base64, filename: file.name });
    } else {
      body = JSON.stringify({ url });
    }
    const res = await apiFetch('/api/tsb-fetch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body
    });
    if (res.error) throw new Error(res.error);

    if (res.title)     document.getElementById('tsbTitle').value     = res.title;
    if (res.bulletin)  document.getElementById('tsbBulletin').value  = res.bulletin;
    if (res.component) document.getElementById('tsbComponent').value = res.component;
    if (res.summary)   document.getElementById('tsbSummary').value   = res.summary;
    if (res.remedy)    document.getElementById('tsbRemedy').value    = res.remedy;
    if (res.severity)  document.getElementById('tsbSeverity').value  = res.severity;

    // Auto-check affected vehicles/years
    document.querySelectorAll('input[name="tsb-vehicle"]').forEach(cb => cb.checked = false);
    let autoChecked = 0;
    if (res.affected_vehicles && res.affected_vehicles.length > 0) {
      for (const av of res.affected_vehicles) {
        for (const yr of (av.years || [])) {
          const cb = document.querySelector(`input[name="tsb-vehicle"][value="${av.vehicle}|${yr}"]`);
          if (cb) { cb.checked = true; autoChecked++; }
        }
      }
    }

    const msg = autoChecked > 0
      ? `✓ Fields populated — Auto-selected ${autoChecked} vehicle/year combination${autoChecked!==1?'s':''} — verify before submitting.`
      : `✓ Fields populated from document — No matching vehicles auto-detected, please select manually.`;
    status.style.color = 'var(--green)';
    status.textContent = msg;
  } catch(e) {
    status.style.color = 'var(--recall)';
    status.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false; btn.textContent = '⊕ Fetch & Fill';
}

async function addTsb() {
  const title     = document.getElementById('tsbTitle').value.trim();
  const bulletin  = document.getElementById('tsbBulletin').value.trim();
  const component = document.getElementById('tsbComponent').value.trim();
  const severity  = document.getElementById('tsbSeverity').value;
  const summary   = document.getElementById('tsbSummary').value.trim();
  const remedy    = document.getElementById('tsbRemedy').value.trim();
  const units     = document.getElementById('tsbUnits').value.trim();
  const url       = document.getElementById('tsbUrl').value.trim();
  const result    = document.getElementById('tsbResult');

  if (!title || !summary) { result.style.color='var(--recall)'; result.textContent='Title and summary are required.'; return; }

  // Collect checked vehicles
  const checked = Array.from(document.querySelectorAll('input[name="tsb-vehicle"]:checked')).map(cb => {
    const [vehicle, year] = cb.value.split('|');
    return { vehicle, year: parseInt(year) };
  });
  if (!checked.length) { result.style.color='var(--recall)'; result.textContent='Select at least one vehicle and year.'; return; }

  const btn = document.getElementById('addTsbBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  setGZ('loading', `Adding TSB for ${checked.length} vehicle/year combo${checked.length>1?'s':''}…`);
  result.textContent = '';

  try {
    // Insert one row per vehicle/year combo
    await Promise.all(checked.map(({vehicle, year}) =>
      apiFetch('/api/tsb-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle, year, title, bulletin_ref: bulletin, component, severity, summary, remedy, affected_units: units, source_url: url })
      })
    ));
    result.style.color = 'var(--green)';
    result.textContent = `✓ TSB added for ${checked.length} vehicle/year combination${checked.length>1?'s':''}.`;
    setGZ('done', 'TSB added');
    ['tsbTitle','tsbBulletin','tsbComponent','tsbSummary','tsbRemedy','tsbUnits','tsbUrl'].forEach(id => { document.getElementById(id).value = ''; });
    document.querySelectorAll('input[name="tsb-vehicle"]').forEach(cb => { cb.checked = false; });
    loadAll();
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = 'Error: ' + e.message;
    setGZ('err', 'Failed to add TSB');
  } finally {
    btn.disabled = false; btn.textContent = '＋ Add TSB';
  }
}

// ── COPY & PRINT ─────────────────────────────
function getCardText(cardBodyId) {
  const body = document.getElementById(cardBodyId);
  if (!body) return '';
  const title = body.closest('.card').querySelector('.card-title');
  const fields = body.querySelectorAll('.cf');
  let lines = [];
  if (title) lines.push(title.textContent.trim());
  lines.push('----------------------------------------');
  fields.forEach(f => {
    const label = f.querySelector('.cf-label');
    const val = f.querySelector('.cf-val');
    if (label && val) lines.push(label.textContent.trim()+': '+val.textContent.trim());
  });
  lines.push('----------------------------------------');
  lines.push('Source: '+window.location.href);
  lines.push('2026 Gazunni / EV Service Intelligence');
  return lines.join(String.fromCharCode(10));
}

function copyIssue(cardBodyId) {
  const text = getCardText(cardBodyId);
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('[data-copy="'+cardBodyId+'"]');
    if (btn) { btn.textContent = '✓ Copied!'; btn.classList.add('copied'); setTimeout(()=>{ btn.textContent='⎘ Copy'; btn.classList.remove('copied'); }, 2000); }
  }).catch(() => {
    const btn = document.querySelector('[data-copy="'+cardBodyId+'"]');
    if (btn) btn.textContent = 'Copy failed';
  });
}

function printIssue(cardBodyId) {
  const card = document.getElementById(cardBodyId).closest('.card');
  const sec = card.closest('.sec');
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('print-target'));
  sec.classList.add('print-target');
  document.getElementById(cardBodyId).classList.add('open');
  window.print();
  sec.classList.remove('print-target');
}

// ── ADMIN ────────────────────────────────────
let gzHoldTimer = null;

async function startGzHold() {
  const icon = document.getElementById('gzIcon');
  icon.classList.add('holding');
  gzHoldTimer = setTimeout(async () => {
    icon.classList.remove('holding');
    const pw = prompt('Admin passphrase:');
    if (pw === null || pw.trim() === '') return;
    // Verify passphrase server-side
    try {
      setGZ('loading', 'Verifying…');
      await apiFetch('/api/admin/stats', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key: pw.trim() }) });
      window.__adminKey = pw.trim();
      setGZ('done', 'Admin access granted');
        window.__adminMode = true;
        // Refresh cards in place to show delete buttons without closing panel
        const vk = document.getElementById('selModel').value;
        const yr = document.getElementById('selYear').value;
        loadSection('recalls', vk, yr);
        loadSection('tsbs', vk, yr);
        loadSection('community', vk, yr);
      // Close any open panels first, then open admin
      document.querySelectorAll('.tool-panel.open').forEach(p => p.classList.remove('open'));
      document.getElementById('adminPanel').classList.add('open');
      loadAdminDashboard();
    } catch(e) {
      setGZ('err', 'Invalid passphrase');
      setTimeout(() => setGZ('done', ''), 2000);
    }
  }, 3000);
}

function cancelGzHold() {
  if (gzHoldTimer) { clearTimeout(gzHoldTimer); gzHoldTimer = null; }
  document.getElementById('gzIcon').classList.remove('holding');
}

async function communityDedupe() {
  const btn    = document.getElementById('adminCommDedupeBtn');
  const result = document.getElementById('adminCommDedupeResult');
  btn.disabled = true; btn.textContent = 'Running…';
  result.textContent = 'Scanning community issues for duplicates…';
  try {
    const data = await apiFetch('/api/community-dedupe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: window.__adminKey || '' })
    });
    if (data.mergedCount === 0) {
      result.textContent = '✓ No duplicates found';
    } else {
      result.textContent = `✓ Merged ${data.mergedCount} duplicate${data.mergedCount > 1 ? 's' : ''}:\n` +
        data.merged.map(m => {
          const pills = m.addedPills?.length ? ` — added: ${m.addedPills.join(', ')}` : '';
          return `  • "${m.title}" (${m.similarity}% match${pills})`;
        }).join('\n');
      loadAdminDashboard(); // refresh counts
    }
  } catch(e) {
    result.textContent = '⚠ ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '⊘ Dedupe Community';
  }
}

async function loadAdminDashboard() {
  const status = document.getElementById('adminDashStatus');
  if (status) status.textContent = 'Loading…';
  try {
    const data = await apiFetch('/api/admin/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: window.__adminKey || '' })
    });
    const d = data.dashboard;
    if (!d) { if (status) status.textContent = 'No dashboard data returned'; return; }

    document.getElementById('dNum-recalls').textContent    = d.recalls;
    document.getElementById('dNum-tsbs').textContent       = d.tsbs;
    document.getElementById('dNum-community').textContent  = d.community;
    document.getElementById('dNum-suppressed').textContent = d.suppressed;

    const qEl = document.getElementById('dNum-queue');
    qEl.textContent = d.pendingQueue;
    document.getElementById('dStat-queue').className      = 'dash-stat' + (d.pendingQueue > 0 ? ' alert' : '');
    document.getElementById('dStat-suppressed').className = 'dash-stat' + (d.suppressed > 0 ? ' warn' : '');

    const sweptEl = document.getElementById('dNum-swept');
    if (d.lastSwept) {
      const ago = Math.round((Date.now() - new Date(d.lastSwept)) / 60000);
      sweptEl.textContent = ago < 60 ? ago + 'm ago' : ago < 1440 ? Math.round(ago/60) + 'h ago' : Math.round(ago/1440) + 'd ago';
      sweptEl.title = new Date(d.lastSwept).toLocaleString();
    } else {
      sweptEl.textContent = 'Never';
    }

    const vDiv = document.getElementById('adminDashVehicles');
    if (vDiv && d.byVehicle && d.byVehicle.length) {
      const labels = { equinox_ev:'Equinox EV', blazer_ev:'Blazer EV', mach_e:'Mach-E', honda_prologue:'Prologue', tesla_model_3:'Model 3', tesla_model_y:'Model Y' };
      vDiv.innerHTML = d.byVehicle.map(v =>
        '<span style="background:var(--card-bg);border:1px solid var(--border);border-radius:4px;padding:2px 8px">' +
        (labels[v.vehicle]||v.vehicle) + ': <strong>' + v.recalls + '</strong></span>'
      ).join('');
    }

    if (status) status.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch(e) {
    if (status) status.textContent = 'Error: ' + e.message;
  }
}

async function adminAction(endpoint, resultId, btnId) {
  const result = document.getElementById(resultId);
  const btn = document.getElementById(btnId);
  btn.disabled = true;
  result.style.color = 'var(--muted)';
  result.textContent = 'Running…';
  try {
    const res = await apiFetch('/api/admin/' + endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({key: window.__adminKey || 'gazunni-admin'}) });
    result.style.color = 'var(--green)';
    result.textContent = res.message || '✓ Done';
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = 'Error: ' + e.message;
  } finally { btn.disabled = false; }
}

// ── YEAR OPTIONS BY VEHICLE ──────────────────
const vehicleYears = {
  equinox_ev:     [2026, 2025, 2024],
  blazer_ev:      [2026, 2025, 2024],
  mach_e:         [2026, 2025, 2024, 2023, 2022, 2021],
  honda_prologue: [2026, 2025, 2024],
  tesla_model_3:  [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017],
  tesla_model_y:  [2026, 2025, 2024, 2023, 2022, 2021, 2020],
};

function updateYearOptions() {
  const vkey = getVehicle();
  const sel = document.getElementById('selYear');
  const current = sel.value;
  const years = vehicleYears[vkey] || [2026, 2025, 2024, 2023];
  sel.innerHTML = years.map(y => `<option value="${y}"${String(y)===current?'selected':''}>${y}</option>`).join('');
  // If current year not valid for this vehicle, default to first
  if (!years.includes(parseInt(current))) sel.value = years[0];
}

// ── PLANT CODE LOOKUP (VIN position 11) ─────
// Plant is decoded from VIN character 11, not the NHTSA-returned string
const PLANT_CODES = {
  // GM Mexico
  'S':'San Luis Potosi Assembly, San Luis Potosi, Mexico',
  'N':'Ramos Arizpe Assembly, Coahuila, Mexico',
  'R':'Ramos Arizpe Assembly, Coahuila, Mexico',
  // GM USA
  'A':'Orion Assembly, Lake Orion, Michigan USA',
  'B':'Bowling Green Assembly, Kentucky USA',
  'D':'Doraville Assembly, Georgia USA',
  'F':'Flint Assembly, Michigan USA',
  'J':'Janesville Assembly, Wisconsin USA',
  'K':'Shreveport Assembly, Louisiana USA',
  'L':'Lansing Grand River, Michigan USA',
  'M':'Lansing Delta Township, Michigan USA',
  'T':'Pontiac Assembly, Michigan USA',
  'U':'Lordstown Assembly, Ohio USA',
  'W':'Wentzville Assembly, Missouri USA',
  'Z':'Moraine Assembly, Ohio USA',
  // GM Canada
  'C':'CAMI Assembly, Ingersoll, Ontario Canada',
  'E':'Oshawa Assembly, Ontario Canada',
  'X':'Oshawa Assembly, Ontario Canada',
  // Ford USA
  'G':'Chicago Assembly, Illinois USA',
  'H':'Lorain Assembly, Ohio USA',
  'P':'Twin Cities Assembly, Minnesota USA',
  'V':'Wayne Assembly, Michigan USA',
  'Y':'Wixom Assembly, Michigan USA',
  // Ford Mexico
  'Q':'Cuautitlan Assembly, Mexico City, Mexico',
  // Ford Canada
  'O':'Oakville Assembly, Ontario Canada',
};

// VIN country codes (position 1)
const VIN_COUNTRY = {
  '1':'USA','4':'USA','5':'USA',
  '2':'Canada','3':'Mexico',
  'J':'Japan','K':'South Korea','W':'Germany',
  'S':'United Kingdom','V':'France','Z':'Italy',
  'Y':'Sweden/Finland','L':'China',
};

function resolvePlant(vin) {
  if (!vin || vin.length !== 17) return '—';
  const plantChar = vin[10].toUpperCase();
  const countryChar = vin[0].toUpperCase();
  const country = VIN_COUNTRY[countryChar] || 'Unknown Country';
  const plant = PLANT_CODES[plantChar];
  return plant ? plant : `Plant Code: ${plantChar} · Assembled in ${country}`;
}

// ── VIN IMPORT ───────────────────────────────
async function vinImportMissing() {
  const data = window.__vinMissing;
  if (!data || !data.recalls.length) return;
  const btn = document.getElementById('vinImportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
  try {
    const res = await apiFetch('/api/vin-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle: data.vehicle,
        year: data.year,
        decodedVehicle: data.decodedVehicle,
        decodedYear: data.decodedYear,
        vin: data.vin,
        recalls: data.recalls,
      })
    });
    if (btn) {
      btn.textContent = `✓ Imported ${res.inserted}` + (res.skipped ? ` · Skipped ${res.skipped}` : '');
      btn.style.borderColor='var(--green)';
      btn.style.color='var(--green)';
    }
    window.__vinMissing = null;
    loadAll();
    setTimeout(() => vinLookup(), 400);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Import failed — retry'; }
    alert('VIN import failed: ' + e.message);
  }
}

// ── FORUM THREAD EXTRACTOR ("Generified" © 2026) ────────────────────────
let __forumData = null;

async function forumFetch() {
  const url = document.getElementById('forumUrl').value.trim();
  if (!url) { document.getElementById('forumStatus').textContent = '⚠ Please enter a forum URL'; return; }
  const btn     = document.getElementById('forumFetchBtn');
  const status  = document.getElementById('forumStatus');
  const preview = document.getElementById('forumPreview');
  btn.disabled = true; btn.textContent = 'Analysing…';
  status.textContent = 'Claude is reading and generifying the thread — this may take 15-30 seconds…';
  preview.style.display = 'none';
  __forumData = null;
  setGZ('loading', 'Generifying thread…');
  try {
    const data = await apiFetch('/api/forum-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    __forumData = { ...data, source_url: url };
    document.getElementById('fp-title').textContent     = data.title || 'Untitled Issue';
    document.getElementById('fp-component').textContent = data.component || '';
    document.getElementById('fp-summary').textContent   = data.summary || '';
    const sevEl = document.getElementById('fp-severity');
    sevEl.textContent = data.severity || 'MODERATE';
    sevEl.style.background = data.severity==='CRITICAL' ? 'var(--recall)' : data.severity==='LOW' ? '#22c55e' : '#f59e0b';
    sevEl.style.color = '#fff';
    document.getElementById('fp-confidence').textContent = (data.confidence||'MEDIUM') + ' CONFIDENCE';
    document.getElementById('fp-frequency').textContent  = data.frequency || '';
    document.getElementById('fp-confidence-reason').textContent = data.confidence_reason || '';
    const sympWrap = document.getElementById('fp-symptoms-wrap');
    if (data.symptoms && data.symptoms.length) {
      document.getElementById('fp-symptoms').innerHTML = data.symptoms.map(s => '<div>• ' + esc(s) + '</div>').join('');
      sympWrap.style.display = 'block';
    } else { sympWrap.style.display = 'none'; }
    const remWrap = document.getElementById('fp-remedy-wrap');
    if (data.remedy) {
      document.getElementById('fp-remedy').textContent = data.remedy;
      remWrap.style.display = 'block';
    } else { remWrap.style.display = 'none'; }
    document.getElementById('forumResult').textContent = '';

    // Pre-populate vehicle/year selectors from Claude's extraction
    const av = data.affected_vehicles?.[0];
    if (av?.vehicle) {
      const vSel = document.getElementById('fp-vehicle');
      if ([...vSel.options].some(o => o.value === av.vehicle)) vSel.value = av.vehicle;
    }
    if (av?.years?.[0]) {
      const ySel = document.getElementById('fp-year');
      if ([...ySel.options].some(o => o.value === String(av.years[0]))) ySel.value = String(av.years[0]);
    }

    preview.style.display = 'block';
    status.textContent = data.confidence === 'LOW'
      ? '⚠ Low confidence — review carefully before approving'
      : '✓ Thread generified — review and add to queue if appropriate';
    setGZ('done', '');
  } catch(e) {
    status.textContent = '⚠ ' + e.message;
    setGZ('err', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🧵 Generify Thread';
  }
}

async function forumSubmit() {
  if (!__forumData) return;
  const btn    = document.getElementById('forumSubmitBtn');
  const result = document.getElementById('forumResult');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    // Read from the vehicle/year selectors in the preview panel
    const vehicle = document.getElementById('fp-vehicle').value;
    const yr      = parseInt(document.getElementById('fp-year').value);
    await apiFetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle:    vehicle,
        year:       yr,
        title:      __forumData.title      || '',
        detail:     __forumData.summary    || '',
        bulletin:   __forumData.component  || '',
        sourceUrl:  __forumData.source_url || '',
        srcType:    'forum',
      })
    });
    result.style.color = '#22c55e';
    result.textContent = '✓ Added to review queue — approve from the Research Sweep panel';
    __forumData = null;
  } catch(e) {
    result.style.color = 'var(--recall)';
    result.textContent = '⚠ ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '⊕ Add to Review Queue';
  }
}

// ── VIN LOOKUP ───────────────────────────────
function resetVinModalState() {
  const input = document.getElementById('vinInput');
  const results = document.getElementById('vinResults');
  const btn = document.getElementById('vinSearchBtn');
  const hint = document.getElementById('vinScrollHint');
  if (results) results.innerHTML = '';
  if (input) input.value = '';
  if (btn) {
    btn.disabled = false;
    btn.textContent = '🔎 Get Vehicle Report';
  }
  if (hint) hint.style.display = 'none';
}
function openVinModal() {
  resetVinModalState();
  document.getElementById('vinOverlay').classList.add('open');
  document.getElementById('vinInput').focus();
}
function closeVinModal() {
  document.getElementById('vinOverlay').classList.remove('open');
  resetVinModalState();
}

function updateScrollHint() {
  const modal = document.getElementById('vinModal');
  const hint  = document.getElementById('vinScrollHint');
  if (!modal || !hint) return;
  const canScroll = modal.scrollHeight > modal.clientHeight + 20;
  const atBottom  = modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 30;
  hint.style.display = (canScroll && !atBottom) ? 'block' : 'none';
}

async function vinLookup() {
  const vin = document.getElementById('vinInput').value.trim().toUpperCase();
  const results = document.getElementById('vinResults');
  if (vin.length !== 17) { results.innerHTML = '<div class="vin-empty">Please enter a full 17-character VIN.</div>'; return; }

  const btn = document.getElementById('vinSearchBtn');
  btn.disabled = true; btn.textContent = 'Looking up…';
  results.innerHTML = '<div class="vin-loading"><div class="spin"></div><span>Checking vehicle information…</span></div>';

  try {
    // Step 1: Decode VIN via server proxy
    const decodeData = await apiFetch(`/api/vin-decode?vin=${vin}`);
    const fields = decodeData.Results || decodeData.results || [];
    const get = (id) => (fields.find(f => f.VariableId === id) || {}).Value || '—';

    const year  = get(29);   // Model Year
    const make  = get(26);   // Make
    const model = get(28);   // Model
    const trim  = get(38);   // Trim
    const body  = get(5);    // Body Class
    const plant = get(18);   // Plant City
    const country = get(17); // Plant Country
    const engine = get(71);  // Displacement (L)
    const drive  = get(15);  // Drive Type
    const doors  = get(14);  // Number of Doors
    const series = get(34);  // Series

    // Auto-set vehicle dropdowns if recognisable
    const decodedVehicleKey = detectVehicleKey(make, model);
    if (decodedVehicleKey) {
      document.getElementById('selModel').value = decodedVehicleKey;
      updateYearOptions();
      if (year) document.getElementById('selYear').value = year;
      loadAll();
    }

    let html = `
      <div class="vin-section">
        <div class="vin-section-title">Vehicle Identity</div>
        <div class="vin-grid">
          <div class="vin-field-row"><div class="vin-field-label">Year</div><div class="vin-field-val">${esc(year)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Make</div><div class="vin-field-val">${esc(make)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Model</div><div class="vin-field-val">${esc(model)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Trim</div><div class="vin-field-val">${esc(trim)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Series</div><div class="vin-field-val">${esc(series)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Body</div><div class="vin-field-val">${esc(body)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Drive</div><div class="vin-field-val">${esc(drive)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Country of Assembly</div><div class="vin-field-val">${esc(VIN_COUNTRY[vin[0].toUpperCase()]||'Unknown')}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Doors</div><div class="vin-field-val">${esc(doors)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Engine (L)</div><div class="vin-field-val">${esc(engine)}</div></div>
          <div class="vin-field-row"><div class="vin-field-label">Assembly Plant</div><div class="vin-field-val">${esc(resolvePlant(vin))}</div></div>
        </div>
      </div>`;

    // Step 2: VIN-specific recalls from NHTSA
    results.innerHTML = html + '<div class="vin-loading"><div class="spin"></div><span>Checking recalls for this VIN…</span></div>';

    try {
      const recallData = await apiFetch(`/api/vin-recalls?vin=${vin}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&year=${encodeURIComponent(year)}`);
      const recalls = recallData.results || [];

      if (!recalls.length) {
        html += `<div class="vin-section"><div class="vin-section-title">Recall Status</div><div class="vin-empty" style="color:var(--green)">✓ No recalls have been issued for this vehicle.</div></div>`;
      } else {
        // Use server-tagged isOutstanding flag (cross-referenced against VIN-specific unrepaired list)
        const outstanding = recalls.filter(r => r.isOutstanding);
        const completed   = recalls.filter(r => !r.isOutstanding);

        // Cross-check against our database using the VIN-decoded vehicle/year,
        // not whatever happened to be selected before the lookup.
        const selectedVehicle = getVehicle();
        const selectedYear = parseInt(getYear(), 10);
        const dbVehicle = decodedVehicleKey || selectedVehicle;
        const dbYear = parseInt(year || selectedYear, 10);
        const vehicleMismatch = !!decodedVehicleKey && (selectedVehicle !== decodedVehicleKey || selectedYear !== dbYear);

        let crossCheck = null;
        try {
          crossCheck = await apiFetch(`/api/recalls?vehicle=${encodeURIComponent(dbVehicle)}&year=${dbYear}&includeSuppressed=1`);
        } catch(e) { /* silent */ }
        // Build a set of all known campaign IDs — check both the record id AND
        // the raw_nhtsa campaign number to handle different ID formats
        const ourIds = new Set();
        for (const r of (crossCheck||[])) {
          if (r.id) ourIds.add(r.id.toUpperCase().replace(/[^A-Z0-9]/g,''));
          const camp = r.raw_nhtsa?.NHTSACampaignNumber || r.raw_nhtsa?.campaign_id;
          if (camp) ourIds.add(camp.toUpperCase().replace(/[^A-Z0-9]/g,''));
        }

        // Find missing recalls - not in our DB bucket for the decoded vehicle/year
        const missing = recalls.filter(r => {
          const cid = (r.NHTSACampaignNumber||r.recallId||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
          return cid && !ourIds.has(cid);
        });

        const canImport = !!decodedVehicleKey && Number.isInteger(dbYear) && !vehicleMismatch;
        window.__vinMissing = {
          recalls: missing,
          vehicle: selectedVehicle,
          year: selectedYear,
          decodedVehicle: decodedVehicleKey,
          decodedYear: dbYear,
          vin,
        };

        const inDb = recalls.length - missing.length;
        const importControl = !missing.length
          ? '<div class="vin-cc-complete">✓ Database up to date</div>'
          : canImport
            ? `<button class="submit-btn" id="vinImportBtn" style="font-size:10px;padding:4px 12px">⊕ Import ${missing.length} Missing</button>`
            : `<div class="vin-empty" style="margin:0;font-size:10px;padding:8px 10px;min-width:240px">Import disabled until the selected vehicle/year matches the VIN decode.</div>`;

        html += `<div class="vin-section">
          <div class="vin-section-title">Database Cross-Check</div>
          ${vehicleMismatch ? `<div class="vin-empty" style="margin-bottom:10px;border-color:#f59e0b;color:#fbbf24">VIN decoded as ${esc(vehicleLabel(decodedVehicleKey))} · ${esc(dbYear)} but the dashboard is set to ${esc(vehicleLabel(selectedVehicle))} · ${esc(selectedYear)}. Import is blocked to prevent cross-vehicle contamination.</div>` : ''}
          ${!decodedVehicleKey ? `<div class="vin-empty" style="margin-bottom:10px;border-color:#f59e0b;color:#fbbf24">This VIN decoded to a vehicle that is not mapped in the dashboard yet, so import is disabled.</div>` : ''}
          <div class="vin-crosscheck">
            <div class="vin-cc-stat"><span class="vin-cc-num">${recalls.length}</span><span class="vin-cc-label">NHTSA Recalls</span></div>
            <div class="vin-cc-stat"><span class="vin-cc-num" style="color:var(--green)">${inDb}</span><span class="vin-cc-label">In ${esc(vehicleLabel(dbVehicle))} ${esc(dbYear)} DB</span></div>
            <div class="vin-cc-stat"><span class="vin-cc-num" style="color:${missing.length?'var(--recall)':'var(--green)'}">${missing.length}</span><span class="vin-cc-label">Missing</span></div>
            ${importControl}
          </div>
        </div>`;
        html += `<div class="vin-section"><div class="vin-section-title">Outstanding Recalls (${outstanding.length})</div>`;
        if (outstanding.length) {
          html += outstanding.map(r => {
            const cid = (r.NHTSACampaignNumber||r.recallId||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
            const inOurDb = ourIds.has(cid);
            return `<div class="vin-recall outstanding">
              <div style="display:flex;align-items:flex-start;gap:10px">
                <div style="font-size:20px;line-height:1;margin-top:2px">🔴</div>
                <div style="flex:1">
                  <div class="vin-recall-title">${esc(r.Component||r.component||'Unknown Component')}</div>
                  <div class="vin-recall-meta">Campaign: ${esc(r.NHTSACampaignNumber||r.recallId||'—')} · Reported: ${esc(r.ReportReceivedDate||r.reportDate||'—')}</div>
                  <div class="vin-recall-meta" style="margin-top:2px">${esc(r.Summary||r.summary||'')}</div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
                    <div class="vin-recall-status">⚠ NOT REMEDIED — Dealer Visit Required</div>
                    <div style="font-size:9px;color:${inOurDb?'var(--green)':'var(--recall)'}">${inOurDb?'✓ In DB':'⊕ Not in DB'}</div>
                  </div>
                </div>
              </div>
            </div>`;
          }).join('');
        } else {
          html += '<div class="vin-empty">None outstanding.</div>';
        }
        html += '</div>';

        html += `<div class="vin-section"><div class="vin-section-title">Completed Recalls (${completed.length})</div>`;
        if (completed.length) {
          html += completed.map(r => {
            const cid = (r.NHTSACampaignNumber||r.recallId||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
            const inOurDb = ourIds.has(cid);
            return `<div class="vin-recall completed">
              <div style="display:flex;align-items:flex-start;gap:10px">
                <div style="font-size:20px;line-height:1;margin-top:2px">✅</div>
                <div style="flex:1">
                  <div class="vin-recall-title">${esc(r.Component||r.component||'Unknown Component')}</div>
                  <div class="vin-recall-meta">Campaign: ${esc(r.NHTSACampaignNumber||r.recallId||'—')} · Status: Remedied at Dealer</div>
                  <div class="vin-recall-meta" style="margin-top:2px">${esc(r.Summary||r.summary||'')}</div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
                    <div class="vin-recall-status">✓ REMEDY COMPLETED</div>
                    <div style="font-size:9px;color:${inOurDb?'var(--green)':'var(--muted)'}">${inOurDb?'✓ In DB':'Not in DB'}</div>
                  </div>
                </div>
              </div>
            </div>`;
          }).join('');
        } else {
          html += '<div class="vin-empty">No completed recalls on record.</div>';
        }
        html += '</div>';
      }
    } catch(e) {
      html += `<div class="vin-section"><div class="vin-section-title">Recall Status</div><div class="vin-empty">Could not fetch recall data: ${esc(e.message)}</div></div>`;
    }

    results.innerHTML = html;
    setTimeout(updateScrollHint, 50);
  } catch(e) {
    results.innerHTML = `<div class="vin-empty">Vehicle lookup failed: ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '🔎 Get Vehicle Report';
  }
}

// ── ADMIN NHTSA IMPORT ───────────────────────
async function adminNhtsaImport() {
  const btn = document.getElementById('adminNhtsaImportBtn');
  const result = document.getElementById('adminNhtsaImportResult');
  btn.disabled = true; btn.textContent = 'Importing…';
  result.textContent = 'Fetching from NHTSA for all vehicles and years…';
  setGZ('loading', 'Running NHTSA import…');

  // Year-by-year vehicles (NHTSA data is clean per year for these)
  const combos = [
    {vehicle:'equinox_ev',     years:[2024,2025,2026]},
    {vehicle:'blazer_ev',      years:[2024,2025,2026]},
    {vehicle:'mach_e',         years:[2021,2022,2023,2024,2025,2026]},
    {vehicle:'honda_prologue', years:[2024,2025,2026]},
  ];
  // Bulk (all-years) vehicles — Tesla has many multi-year campaigns
  const bulkVehicles = ['tesla_model_3', 'tesla_model_y'];

  let totalStored = 0, totalUpdated = 0, totalFound = 0;
  const lines = [];

  // Year-by-year imports
  for (const {vehicle, years} of combos) {
    for (const year of years) {
      try {
        const res = await apiFetch('/api/nhtsa-import', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({vehicle, year})
        });
        totalFound   += res.found   || 0;
        totalStored  += res.stored  || 0;
        totalUpdated += res.updated || 0;
        if ((res.found||0) > 0) lines.push(`${vehicle} ${year}: ${res.found} found · ${res.stored} new · ${res.updated} updated`);
      } catch(e) {
        const msg = e.message.includes('400') ? 'no data for this year' : e.message;
        if (!e.message.includes('400') && !e.message.includes('502')) {
          lines.push(`${vehicle} ${year}: ⚠ ${msg}`);
        }
      }
    }
  }

  // Bulk all-years imports for Tesla
  for (const vehicle of bulkVehicles) {
    try {
      result.textContent = `Fetching ALL years for ${vehicle} from NHTSA…`;
      const res = await apiFetch('/api/nhtsa-import', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({vehicle})  // no year = all years
      });
      totalFound   += res.found   || 0;
      totalStored  += res.stored  || 0;
      totalUpdated += res.updated || 0;
      lines.push(`${vehicle} ALL YEARS: ${res.found} found · ${res.stored} new · ${res.updated} updated`);
    } catch(e) {
      lines.push(`${vehicle}: ⚠ ${e.message}`);
    }
  }

  result.style.color = 'var(--green)';
  result.innerHTML = `✓ Done — ${totalFound} recalls found · ${totalStored} new · ${totalUpdated} updated<br><small style="color:var(--muted)">${lines.join('<br>')}</small>`;
  btn.disabled = false; btn.textContent = '⊕ Import All Recalls';
  setGZ('done', `NHTSA import complete — ${totalStored} new recalls`);
  // Refresh counts only — don't call loadAll() which would close the admin panel
  const vk = document.getElementById('selModel').value;
  const yr = document.getElementById('selYear').value;
  loadSection('recalls', vk, yr);
  loadSection('tsbs', vk, yr);
  loadSection('community', vk, yr);
}

// ── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('pageshow', () => { resetVinModalState(); closeVinModal(); });
  // Close VIN modal on overlay click
  document.getElementById('vinOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('vinOverlay')) closeVinModal();
  });
  document.getElementById('vinModal').addEventListener('scroll', updateScrollHint);

  // VIN field - trigger on Enter key
  document.getElementById('vinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') vinLookup();
  });

  // Set correct years for default vehicle on load
  updateYearOptions();

  // G logo hold-to-admin
  const gzEl = document.getElementById('gzIcon');
  gzEl.addEventListener('mousedown', startGzHold);
  gzEl.addEventListener('touchstart', startGzHold, {passive:true});
  // Click red GZ to reset it
  gzEl.addEventListener('click', () => {
    if (gzEl.classList.contains('err')) setGZ('done', '');
  });
  gzEl.addEventListener('mouseup', cancelGzHold);
  gzEl.addEventListener('mouseleave', cancelGzHold);
  gzEl.addEventListener('touchend', cancelGzHold);

  document.getElementById('selModel').addEventListener('change', () => { updateYearOptions(); savePrefs(); loadAll(); });
  document.getElementById('selYear').addEventListener('change', () => { savePrefs(); loadAll(); });
  document.getElementById('sweepBtn').addEventListener('click', runSweep);

  // Single unified click handler for all buttons
  document.addEventListener('click', e => {
    const t = e.target;
    const id = t.id;

    // Static button IDs
    if (id === 'submitIssueBtn')   { e.stopPropagation(); submitIssue(); return; }
    if (id === 'researchSweepBtn') { e.stopPropagation(); runResearchSweep(); return; }
    if (id === 'clearResearchBtn') { e.stopPropagation(); clearResearch(); return; }
    if (id === 'rcFetchBtn')       { e.stopPropagation(); fetchAndFillRecall(); return; }
    if (id === 'addRecallBtn')     { e.stopPropagation(); addRecall(); return; }
    if (id === 'tsbFetchBtn')       { e.stopPropagation(); fetchAndFillTsb(); return; }
    if (id === 'addTsbBtn')        { e.stopPropagation(); addTsb(); return; }
    if (id === 'vinImportBtn')     { e.stopPropagation(); vinImportMissing(); return; }
    if (id === 'forumFetchBtn')   { e.stopPropagation(); forumFetch(); return; }
    if (id === 'forumSubmitBtn')  { e.stopPropagation(); forumSubmit(); return; }
    if (id === 'forumClearBtn')   {
      e.stopPropagation();
      document.getElementById('forumPreview').style.display='none';
      document.getElementById('forumUrl').value='';
      document.getElementById('forumStatus').textContent='';
      document.getElementById('forumResult').textContent='';
      __forumData=null; return;
    }
    if (id === 'vinLookupBtn')     { e.stopPropagation(); openVinModal(); return; }
    if (id === 'vinCloseBtn')      { e.stopPropagation(); closeVinModal(); return; }
    if (id === 'vinSearchBtn')     { e.stopPropagation(); vinLookup(); return; }
    if (id === 'adminNhtsaImportBtn') { e.stopPropagation(); adminNhtsaImport(); return; }
    if (id === 'adminAuditBtn') {
      e.stopPropagation();
      const result = document.getElementById('adminDedupeResult');
      result.textContent = 'Auditing…';
      const aKey = window.__adminKey || 'gazunni-admin';
      apiFetch('/api/admin/recall-audit?key='+encodeURIComponent(aKey), {method:'GET'})
        .then(data => {
          if (data.duplicates.length === 0) {
            result.style.color = 'var(--green)';
            result.textContent = `✓ No campaign-number duplicates found (${data.total} total recalls)`;
          } else {
            result.style.color = 'var(--warn)';
            const lines = data.duplicates.map(d =>
              `Campaign ${d.campaign}: ${d.rows.length} copies — IDs: ${d.rows.map(r=>r.id).join(', ')}`
            );
            result.innerHTML = `⚠ ${data.duplicates.length} duplicate group(s) found:<br><small>${lines.join('<br>')}</small>`;
          }
        })
        .catch(e => { result.style.color='var(--recall)'; result.textContent = 'Error: '+e.message; });
      return;
    }
    if (id === 'adminDedupeBtn')      { e.stopPropagation(); adminAction('dedupe', 'adminDedupeResult', 'adminDedupeBtn'); return; }
    if (id === 'adminCommDedupeBtn')   { e.stopPropagation(); communityDedupe(); return; }
    if (id === 'adminStatsBtn')    { e.stopPropagation(); loadAdminDashboard(); return; }
    if (id === 'adminMigrateBtn'){ e.stopPropagation(); adminAction('migrate', 'adminMigrateResult', 'adminMigrateBtn'); return; }
    if (id === 'adminClearSweepBtn'){ e.stopPropagation(); adminAction('clear-sweep', 'adminClearSweepResult', 'adminClearSweepBtn'); return; }
    if (id === 'adminClearQueueBtn'){ e.stopPropagation(); adminAction('clear-queue', 'adminClearQueueResult', 'adminClearQueueBtn'); return; }

    // Apply TSB panel toggle and confirm
    const applyBtn    = t.closest('[data-apply]');
    const commApplyBtn     = t.closest('[data-comm-apply]');
    const commApplyConfirm = t.closest('[data-comm-apply-confirm]');
    if (commApplyBtn && !commApplyConfirm) {
      e.stopPropagation();
      const pid = commApplyBtn.dataset.commApply;
      const panel = document.getElementById('comm-apply-'+pid);
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      return;
    }
    if (commApplyConfirm) { e.stopPropagation(); applyCommunity(commApplyConfirm.dataset.commApplyConfirm); return; }

    const applyConfirm = t.closest('[data-apply-confirm]');
    if (applyBtn && !applyConfirm) {
      e.stopPropagation();
      const panel = document.getElementById('apply-'+applyBtn.dataset.apply);
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      return;
    }
    if (applyConfirm) { e.stopPropagation(); applyTsb(applyConfirm.dataset.applyConfirm); return; }

    // Data attribute buttons
    const copyBtn    = t.closest('[data-copy]');
    const printBtn   = t.closest('[data-print]');
    const expandBtn  = t.closest('[data-btn]');
    const confirmBtn = t.closest('[data-confirm]');
    const approveBtn = t.closest('[data-approve-idx]');
    const rejectBtn  = t.closest('[data-reject]');
    const retryBtn   = t.closest('[data-retry]');
    const panelBtn   = t.closest('[data-panel]');
    const secBtn     = t.closest('[data-sec]');
    const hdr        = t.closest('[data-card]');

    if (copyBtn)    { e.stopPropagation(); copyIssue(copyBtn.dataset.copy); return; }
    if (printBtn)   { e.stopPropagation(); printIssue(printBtn.dataset.print); return; }
    if (expandBtn)  { e.stopPropagation(); toggleCard(expandBtn.dataset.btn); return; }
    if (confirmBtn) { e.stopPropagation(); confirmIssue(confirmBtn.dataset.confirm, confirmBtn); return; }
    if (approveBtn) { e.stopPropagation(); approveIssue(approveBtn.dataset.approveIdx, approveBtn.dataset.queueId, approveBtn.dataset.vkey, approveBtn.dataset.year); return; }
    if (rejectBtn)  { e.stopPropagation(); rejectBtn.closest('.rq-item').remove(); return; }
    if (retryBtn)   { e.stopPropagation(); loadAll(); return; }
    const deleteBtn = t.closest('[data-delete]');
    if (deleteBtn) {
      e.stopPropagation();
      const recId = deleteBtn.dataset.delete;
      const recType = deleteBtn.dataset.type;
      if (!confirm(`Delete this ${recType} record?\n\nThis is immediate and permanent.`)) return;
      const endpoint = recType === 'recall' ? 'recalls' : recType === 'tsb' ? 'tsbs' : 'community';
      const key = window.__adminKey || 'gazunni-admin';
      fetch(`/api/${endpoint}/${encodeURIComponent(recId)}?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
        .then(r => r.json())
        .then(d => {
          if (d.ok) {
            deleteBtn.closest('.card').remove();
          } else {
            alert('Delete failed: ' + (d.error || 'Unknown error'));
          }
        })
        .catch(e => alert('Delete failed: ' + e.message));
      return;
    }
    if (panelBtn)   { e.stopPropagation(); togglePanel(panelBtn.dataset.panel); return; }
    if (secBtn)     { e.stopPropagation(); toggleSec(secBtn.dataset.sec); return; }
    if (hdr)        { toggleCard(hdr.dataset.card); }
  });
});

window.addEventListener('load', async () => {
  const vkey = getVehicle(), year = getYear();
  try {
    await Promise.race([
      autoSweepIfEmpty(vkey, year),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
  } catch(e) { /* silent fail, proceed to load */ }
  restorePrefs();
  initSearch();
  loadAll();
});