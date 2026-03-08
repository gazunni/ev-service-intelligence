//reports.js
import { Router } from 'express';
import { query } from '../services/database.js';
import { decodeVIN, fetchVINRecalls, VEHICLES } from '../services/nhtsa.js';

const router = Router();

function normalizeVin(vin) {
  return String(vin || '').trim().toUpperCase();
}

function isValidVin(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text ? esc(text) : fallback;
}

function summarizeText(value, limit = 220) {
  const text = String(value || '').trim();
  if (!text) return 'No details currently available.';
  return esc(text.length > limit ? text.slice(0, limit - 1).trimEnd() + '…' : text);
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return esc(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function decodeField(fields, id) {
  return (fields.find(f => f.VariableId === id) || {}).Value || '';
}

function mapDecodedVehicleKey(make, model, vin='') {
  const mk = String(make || '').toLowerCase().trim();
  const md = String(model || '').toLowerCase().trim();
  const v = String(vin || '').toUpperCase().trim();
  if (mk.includes('chevrolet') || mk.includes('chevy')) {
    if (md.includes('equinox')) return 'equinox_ev';
    if (md.includes('blazer')) return 'blazer_ev';
    if (md.includes('bolt euv')) return 'bolt_euv';
    if (md.includes('bolt')) {
      if (v.startsWith('1G1FZ6EV') || v.startsWith('1G1FY6EV')) return 'bolt_ev_gen2';
      return 'bolt_ev';
    }
  }
  if (mk.includes('ford')) {
    if (md.includes('mach') || md.includes('mustang')) return 'mach_e';
  }
  if (mk.includes('honda')) {
    if (md.includes('prologue')) return 'honda_prologue';
  }
  if (mk.includes('tesla')) {
    if (md.includes('model 3') || md === '3') return 'tesla_model_3';
    if (md.includes('model y') || md === 'y') return 'tesla_model_y';
  }
  return '';
}

function reportTheme(vehicle) {
  const themes = {
    equinox_ev: { hero: 'linear-gradient(135deg,#0f172a 0%,#1d4ed8 55%,#38bdf8 100%)', accent: '#2563eb', badge: 'Chevrolet Equinox EV' },
    blazer_ev: { hero: 'linear-gradient(135deg,#111827 0%,#1d4ed8 45%,#60a5fa 100%)', accent: '#2563eb', badge: 'Chevrolet Blazer EV' },
    bolt_ev: { hero: 'linear-gradient(135deg,#111827 0%,#1d4ed8 45%,#60a5fa 100%)', accent: '#2563eb', badge: 'Chevrolet Bolt EV' },
    bolt_euv: { hero: 'linear-gradient(135deg,#111827 0%,#1d4ed8 45%,#60a5fa 100%)', accent: '#2563eb', badge: 'Chevrolet Bolt EUV' },
    bolt_ev_gen2: { hero: 'linear-gradient(135deg,#111827 0%,#1d4ed8 45%,#60a5fa 100%)', accent: '#2563eb', badge: 'Chevrolet Bolt EV (2027+)' },
    mach_e: { hero: 'linear-gradient(135deg,#111827 0%,#0f766e 45%,#38bdf8 100%)', accent: '#0f766e', badge: 'Ford Mustang Mach-E' },
    honda_prologue: { hero: 'linear-gradient(135deg,#111827 0%,#334155 50%,#38bdf8 100%)', accent: '#334155', badge: 'Honda Prologue' },
    tesla_model_3: { hero: 'linear-gradient(135deg,#111827 0%,#7c2d12 50%,#f97316 100%)', accent: '#c2410c', badge: 'Tesla Model 3' },
    tesla_model_y: { hero: 'linear-gradient(135deg,#111827 0%,#7f1d1d 50%,#ef4444 100%)', accent: '#b91c1c', badge: 'Tesla Model Y' },
  };
  return themes[vehicle] || { hero: 'linear-gradient(135deg,#0f172a 0%,#1d4ed8 55%,#38bdf8 100%)', accent: '#2563eb', badge: 'EV Service Intelligence' };
}

function logoMarkup() {
  return `<div class="report-logo" aria-label="Generify logo">
    <img src="/branding/generify-wolf.png" alt="Generify wolf logo" class="report-logo-img" />
  </div>`;
}


function vehicleImagePath(vehicleKey, year) {
  const y = String(year || '').trim();
  const byYear = {
    equinox_ev: { '2025': '/images/vehicles/equinox-ev.jpg', '2026': '/images/vehicles/equinox-ev.jpg' },
  };
  if (byYear[vehicleKey]?.[y]) return byYear[vehicleKey][y];
  return '/images/vehicles/default-ev.jpg';
}

function cardStat(label, value, cls = '') {
  return `<div class="stat-card ${cls}"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function renderRecallCard(r, statusLabel, statusClass) {
  const campaign = r.NHTSACampaignNumber || r.recallId || r.id || '—';
  const title = r.Component || r.component || r.title || 'Unknown Component';
  const risk = r.Summary || r.summary || r.risk || 'No consequence summary currently stored.';
  const remedy = r.Remedy || r.remedy || r.remedy_text || 'Manufacturer remedy information was not provided.';
  return `<article class="recall-card ${statusClass}">
    <div class="recall-head">
      <div>
        <h4>${esc(title)}</h4>
        <div class="meta">Campaign ${esc(campaign)} · ${safeText(r.ReportReceivedDate || r.reportDate, 'Date unavailable')}</div>
      </div>
      <div class="pill ${statusClass}">${esc(statusLabel)}</div>
    </div>
    <div class="recall-copy"><strong>Risk:</strong> ${summarizeText(risk, 360)}</div>
    <div class="recall-copy"><strong>Remedy:</strong> ${summarizeText(remedy, 320)}</div>
  </article>`;
}

function renderListCard(title, summary, sub = '') {
  return `<article class="list-card"><h4>${esc(title)}</h4><div class="list-summary">${summarizeText(summary, 260)}</div>${sub ? `<div class="list-meta">${sub}</div>` : ''}</article>`;
}

function vehicleImageBlock(vehicleKey, year) {
  const name = VEHICLES[vehicleKey]?.model || 'Vehicle';
  const src = vehicleImagePath(vehicleKey, year);
  return `<div class="vehicle-art">
    <img class="vehicle-art-img" src="${src}" alt="${esc(name)} representative vehicle image" />
    <div class="vehicle-art-shade"></div>
    <img class="vehicle-art-watermark" src="/branding/generify-wolf.png" alt="" aria-hidden="true" />
    <div class="vehicle-art-glow"></div>
    <div class="vehicle-art-badge">Representative vehicle image</div>
    <div class="vehicle-art-name">${esc(name)} · ${esc(year)}</div>
  </div>`;
}

router.get('/vin', async (req, res) => {
  const vin = normalizeVin(req.query?.vin);
  const requestedVehicle = String(req.query?.vehicle || '').trim();
  const requestedYear = parseInt(req.query?.year, 10);
  const mode = String(req.query?.mode || 'view').trim();

  if (!isValidVin(vin)) {
    return res.status(400).send('Valid 17-character VIN required');
  }

  try {
    const decodeData = await decodeVIN(vin);
    const fields = decodeData.Results || decodeData.results || [];
    const decodedYear = parseInt(decodeField(fields, 29), 10) || requestedYear || '';
    const make = decodeField(fields, 26);
    const model = decodeField(fields, 28);
    const trim = decodeField(fields, 38);
    const body = decodeField(fields, 5);
    const drive = decodeField(fields, 15);
    const series = decodeField(fields, 34);
    const plantCity = decodeField(fields, 18);
    const plantCountry = decodeField(fields, 17);
    const mappedVehicle = mapDecodedVehicleKey(make, model, vin) || requestedVehicle;
    const reportYear = decodedYear || requestedYear;

    const [dbRecalls, dbTsbs, dbCommunity, vinRecallData] = await Promise.all([
      mappedVehicle && reportYear ? query(`SELECT * FROM recalls WHERE vehicle_key=$1 AND year=$2 AND COALESCE(status,'active') != 'suppressed' ORDER BY created_at DESC`, [mappedVehicle, reportYear]) : Promise.resolve([]),
      mappedVehicle && reportYear ? query(`SELECT * FROM tsbs WHERE vehicle_key=$1 AND year=$2 AND COALESCE(status,'active') != 'suppressed' ORDER BY created_at DESC`, [mappedVehicle, reportYear]) : Promise.resolve([]),
      mappedVehicle && reportYear ? query(`SELECT * FROM community WHERE vehicle_key=$1 AND year=$2 AND COALESCE(status,'active') != 'suppressed' ORDER BY confirmations DESC, created_at DESC`, [mappedVehicle, reportYear]) : Promise.resolve([]),
      fetchVINRecalls(vin, make, model, String(reportYear || '')),
    ]);

    const recalls = vinRecallData.results || [];
    const openRecalls = recalls.filter(r => r.isOutstanding);
    const completedRecalls = recalls.filter(r => !r.isOutstanding);
    const totalRecalls = recalls.length || dbRecalls.length;
    const theme = reportTheme(mappedVehicle);
    const matchConfirmed = mappedVehicle && requestedVehicle && mappedVehicle === requestedVehicle && String(reportYear) === String(requestedYear);
    const summarySentence = totalRecalls
      ? `This ${safeText(reportYear)} ${safeText(make)} ${safeText(model)} VIN has ${totalRecalls} recall${totalRecalls === 1 ? '' : 's'} on record. ${openRecalls.length} remain open and ${completedRecalls.length} are marked completed. ${dbTsbs.length} technical service bulletin${dbTsbs.length === 1 ? '' : 's'} and ${dbCommunity.length} community insight item${dbCommunity.length === 1 ? '' : 's'} are currently linked in EV Service Intelligence.`
      : `No recalls are currently returned for this VIN. ${dbTsbs.length} technical service bulletin${dbTsbs.length === 1 ? '' : 's'} and ${dbCommunity.length} community insight item${dbCommunity.length === 1 ? '' : 's'} are currently linked in EV Service Intelligence.`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>EV Service Intelligence VIN Report</title>
<style>
:root{--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--bg:#f8fafc;--card:#ffffff;--accent:${theme.accent};--good:#166534;--warn:#b45309;--bad:#b91c1c}
*{box-sizing:border-box} body{margin:0;background:#e2e8f0;color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif} .report-wrap{max-width:980px;margin:24px auto;padding:24px}.report-sheet{background:var(--bg);border:1px solid #cbd5e1;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.12)}
.hero{background:${theme.hero};color:white;padding:24px 28px 30px;position:relative}.hero-top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.brand-lockup{display:flex;gap:14px;align-items:center}.report-logo{width:86px;height:86px;border-radius:50%;position:relative;background:#020617;display:grid;place-items:center;box-shadow:0 0 0 2px rgba(191,219,254,.22),0 0 28px rgba(56,189,248,.28);overflow:hidden}.report-logo-img{width:100%;height:100%;display:block;object-fit:cover;border-radius:50%}.brand-title{font-size:14px;letter-spacing:.18em;text-transform:uppercase;opacity:.92;font-weight:700}.brand-sub{font-size:30px;line-height:1.05;font-weight:800;margin-top:6px}.brand-power{margin-top:6px;color:#dbeafe;font-size:13px}.hero-meta{text-align:right;font-size:13px;color:#dbeafe}.hero-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;align-items:stretch;margin-top:20px}.vehicle-art{min-height:220px;border-radius:22px;background:linear-gradient(135deg, rgba(255,255,255,.08), rgba(15,23,42,.22));border:1px solid rgba(255,255,255,.18);display:flex;flex-direction:column;justify-content:flex-end;padding:18px;position:relative;overflow:hidden}.vehicle-art:before{content:'';position:absolute;inset:18px;border-radius:18px;border:1px solid rgba(191,219,254,.22);z-index:2}.vehicle-art:after{content:'';position:absolute;width:220px;height:220px;border-radius:50%;right:-40px;top:-60px;background:radial-gradient(circle, rgba(255,255,255,.18), rgba(255,255,255,0));z-index:1}.vehicle-art-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.vehicle-art-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,15,26,.06),rgba(7,15,26,.16) 24%,rgba(7,15,26,.52) 58%,rgba(7,15,26,.78) 100%);z-index:1}.vehicle-art-glow{position:absolute;inset:auto -10% -18% auto;width:62%;height:70%;background:radial-gradient(circle, rgba(83,197,255,.32), rgba(83,197,255,0) 64%);filter:blur(16px);z-index:1;pointer-events:none}.vehicle-art-watermark{position:absolute;left:24px;top:22px;width:120px;height:120px;opacity:.12;z-index:1;filter:drop-shadow(0 0 10px rgba(83,197,255,.18));pointer-events:none}.vehicle-art-badge{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#e8f5ff;position:relative;z-index:3;text-shadow:0 1px 2px rgba(0,0,0,.45)}.vehicle-art-name{font-size:26px;font-weight:800;position:relative;z-index:3;margin-top:10px;text-shadow:0 2px 12px rgba(0,0,0,.6)}.identity-card{background:rgba(248,250,252,.98);color:var(--ink);border-radius:22px;padding:20px;border:1px solid rgba(255,255,255,.4)}.identity-card h3{margin:0 0 10px;font-size:24px}.identity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px}.identity-item{border-top:1px solid #dbeafe;padding-top:8px}.identity-label{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.12em}.identity-val{font-size:14px;font-weight:700;margin-top:2px}.context-note{margin-top:12px;padding:12px 14px;border-radius:12px;background:${matchConfirmed ? 'rgba(22,101,52,.10)' : 'rgba(180,83,9,.10)'};color:${matchConfirmed ? '#166534' : '#9a3412'};font-size:12px;font-weight:600;line-height:1.45;border:1px solid ${matchConfirmed ? 'rgba(34,197,94,.24)' : 'rgba(251,146,60,.28)'};box-shadow:inset 0 1px 0 rgba(255,255,255,.42)}
.content{padding:24px 28px 32px}.summary-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:0 0 18px}.stat-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:14px 12px}.stat-card.open{border-color:#fecaca;background:#fff1f2}.stat-card.complete{border-color:#bbf7d0;background:#f0fdf4}.stat-card.community{border-color:#bfdbfe;background:#eff6ff}.stat-value{font-size:28px;font-weight:800}.stat-label{font-size:11px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin-top:4px}.section{margin-top:20px}.section h2{margin:0 0 10px;font-size:18px;letter-spacing:.02em}.section-intro{color:var(--muted);line-height:1.55;margin-bottom:12px}.recall-grid,.list-grid{display:grid;gap:12px}.recall-card,.list-card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px}.recall-card.open{border-left:6px solid #dc2626}.recall-card.completed{border-left:6px solid #16a34a}.recall-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.recall-head h4,.list-card h4{margin:0;font-size:16px}.meta,.list-meta{font-size:12px;color:var(--muted);margin-top:4px}.pill{padding:7px 10px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pill.open{background:#fee2e2;color:#991b1b}.pill.completed{background:#dcfce7;color:#166534}.recall-copy,.list-summary{margin-top:10px;line-height:1.58;color:#1e293b}.empty{background:var(--card);border:1px dashed #94a3b8;border-radius:18px;padding:18px;color:#475569}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.action-btn{border:none;border-radius:999px;padding:12px 16px;font-size:13px;font-weight:800;cursor:pointer}.action-primary{background:var(--accent);color:white}.action-secondary{background:white;color:var(--ink);border:1px solid var(--line)}.footer{margin-top:24px;padding-top:18px;border-top:1px solid var(--line);color:#475569;font-size:12px;line-height:1.55}.footer strong{color:#0f172a}.badge-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.source-badge{background:#e0f2fe;color:#0c4a6e;border:1px solid #bae6fd;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:700}.page-tools{display:flex;justify-content:flex-end;gap:10px;padding:16px 28px 0}.page-tools button{border:none;background:#0f172a;color:white;border-radius:999px;padding:10px 14px;cursor:pointer;font-weight:700}.page-tools button.secondary{background:#e2e8f0;color:#0f172a}@media (max-width:900px){.report-wrap{padding:10px}.hero-grid,.summary-grid,.identity-grid{grid-template-columns:1fr}.hero-top{flex-direction:column;align-items:flex-start}.hero-meta{text-align:left}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{background:white}.report-wrap{max-width:none;margin:0;padding:0}.report-sheet{border:none;border-radius:0;box-shadow:none}.page-tools{display:none}.hero{print-color-adjust:exact;-webkit-print-color-adjust:exact}.report-logo,.vehicle-art,.stat-card,.recall-card,.list-card{print-color-adjust:exact;-webkit-print-color-adjust:exact}.section,.recall-card,.list-card,.stat-card{break-inside:avoid}.footer{font-size:10px}}
</style>
</head>
<body>
<div class="report-wrap">
  <div class="page-tools">
    <button type="button" id="reportPrintTopBtn" style="padding:10px 18px;border-radius:8px;border:none;background:#2b7cff;color:white;cursor:pointer;">🖨 Print / Save PDF</button>
    <button type="button" class="secondary" id="reportBackTopBtn" style="padding:10px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:#1e2a38;color:white;cursor:pointer;">⬅ Back to Dashboard</button>
  </div>
  <div class="report-sheet">
    <section class="hero">
      <div class="hero-top">
        <div class="brand-lockup">
          ${logoMarkup()}
          <div>
            <div class="brand-title">EV Service Intelligence</div>
            <div class="brand-sub">VIN Health Report</div>
            <div class="brand-power">Powered by Generify™</div>
          </div>
        </div>
        <div class="hero-meta">
          <div><strong>Generated:</strong> ${formatDate(new Date().toISOString())}</div>
          <div><strong>VIN:</strong> ${esc(vin)}</div>
          <div><strong>Data Snapshot:</strong> ${formatDate(new Date().toISOString())}</div>
        </div>
      </div>
      <div class="hero-grid">
        ${vehicleImageBlock(mappedVehicle, reportYear)}
        <div class="identity-card">
          <h3>${safeText(reportYear)} ${safeText(make)} ${safeText(model)}</h3>
          <div class="identity-grid">
            <div class="identity-item"><div class="identity-label">Trim</div><div class="identity-val">${safeText(trim)}</div></div>
            <div class="identity-item"><div class="identity-label">Series</div><div class="identity-val">${safeText(series)}</div></div>
            <div class="identity-item"><div class="identity-label">Body</div><div class="identity-val">${safeText(body)}</div></div>
            <div class="identity-item"><div class="identity-label">Drive</div><div class="identity-val">${safeText(drive)}</div></div>
            <div class="identity-item"><div class="identity-label">Assembly Plant</div><div class="identity-val">${safeText(plantCity || plantCountry)}</div></div>
            <div class="identity-item"><div class="identity-label">Dashboard Vehicle</div><div class="identity-val">${safeText(VEHICLES[mappedVehicle]?.model || requestedVehicle || 'Not mapped')}</div></div>
          </div>
          <div class="context-note">${matchConfirmed ? 'VIN context verified against the selected vehicle and year.' : 'VIN was decoded and mapped for reporting. Review the dashboard selection if this vehicle was loaded under a different context.'}</div>
        </div>
      </div>
    </section>
    <section class="content">
      <div class="summary-grid">
        ${cardStat('Total Recalls', totalRecalls)}
        ${cardStat('Open Recalls', openRecalls.length, 'open')}
        ${cardStat('Completed', completedRecalls.length, 'complete')}
        ${cardStat('TSBs', dbTsbs.length)}
        ${cardStat('Community', dbCommunity.length, 'community')}
      </div>
      <section class="section">
        <h2>Executive Summary</h2>
        <div class="section-intro">${summarySentence}</div>
        <div class="badge-row">
          <div class="source-badge">Official recall data</div>
          <div class="source-badge">Vehicle-specific VIN status</div>
          ${dbCommunity.length ? '<div class="source-badge">Generify™ community insight</div>' : ''}
        </div>
      </section>
      <section class="section">
        <h2>Open Recalls</h2>
        ${openRecalls.length ? `<div class="recall-grid">${openRecalls.map(r => renderRecallCard(r, 'Open', 'open')).join('')}</div>` : '<div class="empty">No open recalls are currently returned for this VIN.</div>'}
      </section>
      <section class="section">
        <h2>Completed Recalls</h2>
        ${completedRecalls.length ? `<div class="recall-grid">${completedRecalls.map(r => renderRecallCard(r, 'Completed', 'completed')).join('')}</div>` : '<div class="empty">No completed recall remedies are currently shown for this VIN.</div>'}
      </section>
      <section class="section">
        <h2>Technical Service Bulletins</h2>
        ${dbTsbs.length ? `<div class="list-grid">${dbTsbs.map(t => renderListCard(t.title || t.component || 'Technical Service Bulletin', t.summary || t.remedy || 'No summary currently stored.', `${esc(t.component || 'General')} · ${esc(t.severity || 'MODERATE')}`)).join('')}</div>` : '<div class="empty">No technical service bulletins are currently stored for this vehicle and year in EV Service Intelligence.</div>'}
      </section>
      ${dbCommunity.length ? `<section class="section">
        <h2>Generify™ Community Intelligence</h2>
        <div class="section-intro">Community observations are processed through the Generify™ engine, which abstracts recurring themes without reproducing original posts.</div>
        <div class="list-grid">${dbCommunity.map(c => renderListCard(c.title || 'Community Issue', c.summary || 'No community summary currently stored.', `${esc(c.component || 'General')} · ${esc(c.confirmations || 1)} confirmation${Number(c.confirmations || 1) === 1 ? '' : 's'}`)).join('')}</div>
      </section>` : ''}
      <section class="section">
        <h2>Recommended Next Steps</h2>
        <div class="list-grid">
          ${renderListCard('Verify open recalls with a dealer', 'Confirm that every open campaign listed in this report has been addressed for this exact VIN before sale, service, or delivery.')}
          ${renderListCard('Retain this report', 'Keep a printed or saved PDF copy for maintenance planning, dealer conversations, and future resale documentation.')}
          ${renderListCard('Re-run after service visits', 'Generate a fresh VIN report after recall work is completed so the status can be rechecked against NHTSA data.')}
        </div>
      </section>
      <div class="actions">
        <button class="action-btn action-secondary" id="reportBackBottomBtn">⬅ Back to Dashboard</button>
        <button class="action-btn action-primary" id="reportPrintBottomBtn">🖨 Print / Save PDF</button>
      </div>
      <footer class="footer">
        <strong>Disclaimer.</strong> This report combines public recall information, EV Service Intelligence database content, and Generify™-processed community insight. While reasonable efforts are made to improve accuracy, details may contain errors, omissions, or outdated information. Always verify recall completion status and service requirements with the vehicle manufacturer or an authorized dealer before making repair, purchase, or safety decisions.
      </footer>
    </section>
  </div>
</div>
<script>
  if (${mode === 'print' ? 'true' : 'false'}) {
    window.addEventListener('load', () => setTimeout(() => window.print(), 250));
  }
</script>

<script>
function triggerReportPrint(ev){
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  try { window.focus(); } catch (_) {}
  const run = () => {
    try { window.print(); } catch (_) {}
  };
  if (document.readyState === 'complete') {
    setTimeout(run, 60);
  } else {
    window.addEventListener('load', () => setTimeout(run, 60), { once:true });
  }
  return false;
}
function goBackFromReport(ev){
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  try {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  } catch (_) {
    window.location.href = '/';
  }
  return false;
}
document.addEventListener('DOMContentLoaded', function(){
  var printTop = document.getElementById('reportPrintTopBtn');
  var printBottom = document.getElementById('reportPrintBottomBtn');
  var backTop = document.getElementById('reportBackTopBtn');
  var backBottom = document.getElementById('reportBackBottomBtn');
  var refreshBtn = document.getElementById('reportRefreshBtn');

  if (printTop) {
    printTop.addEventListener('click', function(ev){ triggerReportPrint(ev); });
  }
  if (printBottom) {
    printBottom.addEventListener('click', function(ev){ triggerReportPrint(ev); });
  }
  if (backTop) {
    backTop.addEventListener('click', function(ev){ goBackFromReport(ev); });
  }
  if (backBottom) {
    backBottom.addEventListener('click', function(ev){ goBackFromReport(ev); });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(ev){
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      try { window.location.reload(); } catch (_) {}
    });
  }

  var autoMode = new URLSearchParams(window.location.search).get('mode');
  if (autoMode === 'print') {
    setTimeout(function(){ triggerReportPrint(); }, 120);
  }
});
</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('vin-report error:', error.message);
    res.status(500).send(`<!doctype html><title>VIN Report Error</title><body style="font-family:system-ui;padding:24px"><h1>VIN report unavailable</h1><p>${esc(error.message)}</p>
<script>
function triggerReportPrint(ev){
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  try { window.focus(); } catch (_) {}
  const run = () => {
    try { window.print(); } catch (_) {}
  };
  if (document.readyState === 'complete') {
    setTimeout(run, 60);
  } else {
    window.addEventListener('load', () => setTimeout(run, 60), { once:true });
  }
  return false;
}
function goBackFromReport(ev){
  if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
  try {
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/';
  } catch (_) {
    window.location.href = '/';
  }
  return false;
}
document.addEventListener('DOMContentLoaded', function(){
  var printTop = document.getElementById('reportPrintTopBtn');
  var printBottom = document.getElementById('reportPrintBottomBtn');
  var backTop = document.getElementById('reportBackTopBtn');
  var backBottom = document.getElementById('reportBackBottomBtn');
  var refreshBtn = document.getElementById('reportRefreshBtn');

  if (printTop) {
    printTop.addEventListener('click', function(ev){ triggerReportPrint(ev); });
  }
  if (printBottom) {
    printBottom.addEventListener('click', function(ev){ triggerReportPrint(ev); });
  }
  if (backTop) {
    backTop.addEventListener('click', function(ev){ goBackFromReport(ev); });
  }
  if (backBottom) {
    backBottom.addEventListener('click', function(ev){ goBackFromReport(ev); });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function(ev){
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      try { window.location.reload(); } catch (_) {}
    });
  }

  var autoMode = new URLSearchParams(window.location.search).get('mode');
  if (autoMode === 'print') {
    setTimeout(function(){ triggerReportPrint(); }, 120);
  }
});
</script>
</body>`);
  }
});

export default router;
