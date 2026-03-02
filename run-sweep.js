// run-sweep.js — Handles the main sweep logic

import { fetchRecalls, aiSummarizeRecalls, seedKnownIssues, renderSection, getVehicle, getYear, dbGet, dbSet, dbList, openSection, setLoading } from './get-data.js';

export async function runSweep() {
  const vkey = getVehicle(), year = getYear();
  const btn = document.getElementById('sweepBtn');
  const dot = document.getElementById('sweepDot');
  const status = document.getElementById('sweepStatus');

  btn.disabled = true;
  dot.classList.add('active');
  status.textContent = `Fetching NHTSA recalls for ${vkey} ${year}...`;

  setLoading('recallCards');
  const rawRecalls = await fetchRecalls(vkey, year);

  let recallData = [];
  if(rawRecalls.length){
    status.textContent = `AI summarizing ${rawRecalls.length} recall records...`;
    recallData = await aiSummarizeRecalls(rawRecalls, vkey, year);
    if(!recallData.length) recallData = rawRecalls.map(r => ({
      id: r.NHTSACampaignNumber || ('r-'+Math.random()),
      date: r.ReportReceivedDate || '',
      component: r.Component || 'Unknown',
      severity: 'MODERATE',
      title: (r.Summary||'Recall').substring(0,60),
      risk: r.Consequence || '',
      remedy: r.Remedy || '',
      affectedUnits: r.PotentialNumberOfUnitsAffected || null
    }));
  }

  const now = Date.now();
  for(const rec of recallData) await dbSet(`recall:${vkey}:${year}:${rec.id}`, { ...rec, source: 'nhtsa', sourcePills: ['NHTSA Official'], ts: now });

  status.textContent = 'Loading curated issue database...';
  await seedKnownIssues(vkey, year);

  const loadSection = async (prefix, containerId, countId, type) => {
    const keys = await dbList(prefix);
    const data = (await Promise.all(keys.map(k => dbGet(k)))).filter(Boolean);
    renderSection(containerId, countId, data, type);
    return data.length;
  };

  const [rc, tb, pp, cm] = await Promise.all([
    loadSection(`recall:${vkey}:${year}:`, 'recallCards', 'cntRecall', 'recall'),
    loadSection(`tsb:${vkey}:${year}:`, 'tsbCards', 'cntTsb', 'tsb'),
    loadSection(`pip:${vkey}:${year}:`, 'pipCards', 'cntPip', 'pip'),
    loadSection(`community:${vkey}:${year}:`, 'communityCards', 'cntCommunity', 'community'),
  ]);

  document.getElementById('statRecall').textContent = rc;
  document.getElementById('statTsb').textContent = tb || '—';
  document.getElementById('statPip').textContent = pp || '—';
  document.getElementById('statCommunity').textContent = cm;

  await dbSet(`sweep:${vkey}:${year}`, { ts: now });
  document.getElementById('lastSweepLabel').textContent = 'Last sweep: ' + new Date().toLocaleString();

  status.textContent = `Sweep complete — ${rc} recalls · ${cm} community issues`;
  dot.classList.remove('active');
  btn.disabled = false;

  if(rc) openSection('recall');
  if(cm) openSection('community');
}
