// ── VEHICLE DEFINITIONS ───────────────────────────────────────────────────
export const VEHICLES = {
  equinox_ev:     { make: 'Chevrolet', model: 'Equinox EV',     nhtsa_make: 'CHEVROLET', nhtsa_model: 'EQUINOX EV' },
  blazer_ev:      { make: 'Chevrolet', model: 'Blazer EV',      nhtsa_make: 'CHEVROLET', nhtsa_model: 'BLAZER EV'  },
  mach_e:         { make: 'Ford',      model: 'Mustang Mach-E', nhtsa_make: 'FORD',      nhtsa_model: 'MUSTANG MACH-E' },
  honda_prologue: { make: 'Honda',     model: 'Prologue',       nhtsa_make: 'HONDA',     nhtsa_model: 'PROLOGUE' },
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
export async function fetchNHTSARecalls(vehicle, year) {
  const v = VEHICLES[vehicle];
  if (!v) throw new Error('Unknown vehicle: ' + vehicle);
  const yr = parseInt(year);

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
