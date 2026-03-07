//nhtsa.js
// ── VEHICLE DEFINITIONS ───────────────────────────────────────────────────
export const VEHICLES = {
  equinox_ev:     { make: 'Chevrolet', model: 'Equinox EV',     nhtsa_make: 'CHEVROLET', nhtsa_model: 'EQUINOX EV' },
  blazer_ev:      { make: 'Chevrolet', model: 'Blazer EV',      nhtsa_make: 'CHEVROLET', nhtsa_model: 'BLAZER EV'  },
  bolt_ev:        { make: 'Chevrolet', model: 'Bolt EV',        nhtsa_make: 'CHEVROLET', nhtsa_model: 'BOLT EV'    },
  bolt_euv:       { make: 'Chevrolet', model: 'Bolt EUV',       nhtsa_make: 'CHEVROLET', nhtsa_model: 'BOLT EUV'   },
  mach_e:         { make: 'Ford',      model: 'Mustang Mach-E', nhtsa_make: 'FORD',      nhtsa_model: 'MUSTANG MACH-E' },
  honda_prologue: { make: 'Honda',     model: 'Prologue',       nhtsa_make: 'HONDA',     nhtsa_model: 'PROLOGUE' },
  tesla_model_3:  { make: 'Tesla',     model: 'Model 3',        nhtsa_make: 'TESLA',     nhtsa_model: 'MODEL 3' },
  tesla_model_y:  { make: 'Tesla',     model: 'Model Y',        nhtsa_make: 'TESLA',     nhtsa_model: 'MODEL Y' },
};

// ── MODEL NAME VARIANTS ───────────────────────────────────────────────────
// NHTSA sometimes stores model names differently — try alternates on 400/empty
function modelVariants(nhtsa_model) {
  const variants = [nhtsa_model];
  if (nhtsa_model.includes('MUSTANG MACH-E')) variants.push('MUSTANG MACH E', 'MACH-E');
  if (nhtsa_model.includes('PROLOGUE'))        variants.push('Prologue');
  return variants;
}

// ── FETCH RECALLS FROM NHTSA ─────────────────────────────────────────────
// Fetches ALL recalls for a make/model across all years, then filters to
// those that affect the requested year. This catches multi-year campaigns
// that NHTSA only lists under one model year.
export async function fetchNHTSARecalls(vehicle, year) {
  const v = VEHICLES[vehicle];
  if (!v) throw new Error('Unknown vehicle: ' + vehicle);
  const yr = parseInt(year);

  // Strategy 1: fetch without modelYear to get full recall list
  for (const model of modelVariants(v.nhtsa_model)) {
    try {
      // No modelYear param — returns all recalls ever issued for this make/model
      const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(model)}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      const all = data.results || data.Results || [];
      if (!all.length) continue;

      // Filter to recalls that cover the requested year
      // NHTSA ModelYear field may be a single year or a range like "2020-2023"
      const filtered = all.filter(rc => {
        const my = String(rc.ModelYear || rc.modelYear || '');
        if (!my) return true; // no year field — include it
        // Handle range "2020-2023" or comma list "2020,2021,2022"
        if (my.includes('-')) {
          const [start, end] = my.split('-').map(Number);
          return yr >= start && yr <= end;
        }
        if (my.includes(',')) {
          return my.split(',').map(Number).includes(yr);
        }
        return parseInt(my) === yr;
      });

      // If no filtered results but we got data, fall back to year-specific query
      if (filtered.length > 0) return filtered;
    } catch { continue; }
  }

  // Strategy 2: fallback to year-specific query
  for (const model of modelVariants(v.nhtsa_model)) {
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(model)}&modelYear=${yr}`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      const results = data.results || data.Results || [];
      if (results.length > 0) return results;
    } catch { continue; }
  }
  return [];
}

// ── FETCH ALL RECALLS (all years) ────────────────────────────────────────
// NHTSA requires modelYear — no-year query returns 400.
// So we loop all years and dedupe by campaign number.
export async function fetchAllNHTSARecalls(vehicle) {
  const v = VEHICLES[vehicle];
  if (!v) throw new Error('Unknown vehicle: ' + vehicle);

  // Year ranges per vehicle
  const yearRanges = {
    tesla_model_3:  [2017,2018,2019,2020,2021,2022,2023,2024,2025,2026],
    tesla_model_y:  [2020,2021,2022,2023,2024,2025,2026],
    equinox_ev:     [2024,2025,2026],
    blazer_ev:      [2024,2025,2026],
    mach_e:         [2021,2022,2023,2024,2025,2026],
    honda_prologue: [2024,2025,2026],
  };
  const years = yearRanges[vehicle] || [2024,2025,2026];

  const allResults = [];
  for (const yr of years) {
    for (const model of modelVariants(v.nhtsa_model)) {
      try {
        const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(model)}&modelYear=${yr}`;
        const r = await fetch(url);
        if (!r.ok) continue;
        const data = await r.json();
        const found = data.results || data.Results || [];
        if (found.length > 0) { allResults.push(...found); break; }
      } catch { continue; }
    }
  }

  // Dedupe by campaign number — keep first occurrence
  const seen = new Set();
  return allResults.filter(rc => {
    const k = rc.NHTSACampaignNumber || rc.recallId;
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── FETCH TSBs FROM NHTSA ────────────────────────────────────────────────
export async function fetchNHTSATSBs(vehicle, year) {
  const v = VEHICLES[vehicle];
  if (!v) throw new Error('Unknown vehicle: ' + vehicle);
  const yr = parseInt(year);

  for (const model of modelVariants(v.nhtsa_model)) {
    const url = `https://api.nhtsa.gov/tsbs/tsbsByVehicle?make=${encodeURIComponent(v.nhtsa_make)}&model=${encodeURIComponent(model)}&modelYear=${yr}`;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      const results = data.results || data.Results || [];
      if (results.length > 0) return results;
    } catch { continue; }
  }
  return [];
}

// ── CANONICAL RECALL ID ───────────────────────────────────────────────────
// Converts any campaign number form to uppercase alphanumeric: "25V012000"
export function canonicalRecallId(campaignRaw, fallback) {
  if (!campaignRaw) return fallback;
  const clean = campaignRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean || fallback;
}

// ── AUTO-DETECT SEVERITY FROM CONSEQUENCE TEXT ───────────────────────────
export function detectSeverity(consequence = '') {
  return /crash|injur|fatal|death/i.test(consequence) ? 'CRITICAL' : 'MODERATE';
}

// ── DECODE VIN ────────────────────────────────────────────────────────────
export async function decodeVIN(vin) {
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`);
  if (!r.ok) throw new Error(`VIN decode failed: ${r.status}`);
  return r.json();
}

// ── FETCH VIN-SPECIFIC RECALLS ────────────────────────────────────────────
export async function fetchVINRecalls(vin, make, model, year) {
  // Step 1: VIN-specific unrepaired recalls
  const vinRes  = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicleId?vinId=${encodeURIComponent(vin)}`);
  const vinData = await vinRes.json();
  const unrepairedIds = new Set((vinData.results || []).map(r => r.NHTSACampaignNumber || ''));

  // Step 2: All recalls for this make/model/year (try variants)
  let allRecalls = [];
  if (make && model && year) {
    const variants = [model];
    if (!model.toUpperCase().includes('EV'))             variants.push(model + ' EV');
    if (model.toUpperCase() === 'EQUINOX')               variants.push('EQUINOX EV', 'Equinox EV');
    if (model.toUpperCase() === 'BLAZER')                variants.push('BLAZER EV', 'Blazer EV');
    if (/mustang|mach/i.test(model))                     variants.push('Mustang Mach-E', 'MUSTANG MACH-E');

    for (const m of variants) {
      const res  = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(m)}&modelYear=${encodeURIComponent(year)}`);
      const data = await res.json();
      if ((data.results || []).length) { allRecalls = data.results; break; }
    }
  }

  // Fallback to VIN-direct results
  if (!allRecalls.length && vinData.results?.length) allRecalls = vinData.results;

  const tagged = allRecalls.map(r => ({
    ...r,
    isOutstanding:  unrepairedIds.has(r.NHTSACampaignNumber),
    completionDate: unrepairedIds.has(r.NHTSACampaignNumber) ? null : 'Remedied',
  }));

  return {
    results:        tagged.length ? tagged : (vinData.results || []).map(r => ({ ...r, isOutstanding: true })),
    unrepairedCount: unrepairedIds.size,
    totalCount:     (tagged.length || vinData.results?.length || 0),
  };
}
