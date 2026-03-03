// netlify/functions/community.js
// GET /api/community?vehicle=equinox_ev&year=2025

import { query, ok, err, preflight } from './_db.js';

// Known community issues to seed when the database is empty
const SEED_DATA = {
  equinox_ev: {
    2025: [
      { id:'seed-eq25-001', component:'HVAC / Cabin', severity:'MODERATE', title:'Passenger Floor Water Ingress', summary:'Multiple owners report water pooling under the front passenger floor mat, often after rain or car washes. Root cause appears to be a poorly sealed A/C drain or cowl seam.', symptoms:['Wet carpet under passenger seat','Musty smell after rain','Water sloshing sound when turning'], remedy:'Dealer inspection of cowl drain and A/C condensation line. Some owners report re-sealing fixes the issue.', bulletin_ref:'PIP5662 (related)', source_pills:['Forum','Reddit','Facebook Groups'], confirmations: 14 },
      { id:'seed-eq25-002', component:'Infotainment / Software', severity:'MODERATE', title:'Infotainment Screen Freezing and Rebooting', summary:'Touchscreen occasionally freezes mid-use, requiring a hard reboot. Some owners report it happens more frequently after OTA updates.', symptoms:['Screen goes black or freezes','Backup camera unavailable temporarily','CarPlay/Android Auto disconnects'], remedy:'Performing a system reset (hold power button). OTA update expected to address root cause.', bulletin_ref:'Not yet filed', source_pills:['Reddit','Facebook Groups'], confirmations: 9 },
      { id:'seed-eq25-003', component:'Charging System', severity:'LOW', title:'Intermittent L2 Charging Failures', summary:'Some owners report Level 2 home charging sessions stopping prematurely or failing to start. Appears related to specific EVSE brands.', symptoms:['Charge session stops unexpectedly','Vehicle does not begin charging when plugged in','Charge port light flashing amber'], remedy:'Try different EVSE. Some owners resolved by updating charge scheduling settings.', bulletin_ref:'Not yet filed', source_pills:['Forum','Reddit'], confirmations: 6 },
    ],
    2024: [
      { id:'seed-eq24-001', component:'Battery / Drivetrain', severity:'MODERATE', title:'Reduced Range in Cold Weather Beyond Expected', summary:'Owners in cold climates report range loss of 40-50%, beyond the typical 20-30% EV winter range reduction. Battery preconditioning not activating reliably.', symptoms:['Dramatic range drop below freezing','Battery preconditioning inconsistent','Slower DC fast charging in cold'], remedy:'Software update expected. Some owners report manually preconditioning before departure helps.', bulletin_ref:'Not yet filed', source_pills:['Reddit','Forum'], confirmations: 8 },
    ],
  },
  blazer_ev: {
    2024: [
      { id:'seed-bz24-001', component:'Software / OTA', severity:'MODERATE', title:'OTA Update Failures Requiring Dealer Visit', summary:'Over-the-air updates occasionally fail mid-install, leaving the vehicle in a state requiring dealer intervention to complete the update.', symptoms:['Update stuck at percentage','Vehicle warns of incomplete update','Features unavailable after failed update'], remedy:'Dealer reflash of infotainment module. GM working on more resilient OTA process.', bulletin_ref:'Not yet filed', source_pills:['Forum','Reddit'], confirmations: 5 },
    ],
    2025: [],
  },
  mach_e: {
    2024: [
      { id:'seed-me24-001', component:'Powertrain / HVB', severity:'CRITICAL', title:'High-Voltage Battery Contactor Failure', summary:'Some vehicles may experience a high-voltage battery contactor that fails, potentially causing loss of drive power. Ford issued a safety recall for affected units.', symptoms:['Loss of propulsion','Warning lights on dashboard','Vehicle will not start'], remedy:'Dealer replacement of HVB contactors under recall.', bulletin_ref:'24S52', source_pills:['NHTSA Official','Dealer Confirmed'], confirmations: 22 },
    ],
    2025: [
      { id:'seed-me25-001', component:'Charging / DCFC', severity:'LOW', title:'DC Fast Charge Speed Slower Than Advertised', summary:'Some owners report peak DC fast charging rates lower than the advertised 150kW, especially at non-Tesla Supercharger stations via NACS adapter.', symptoms:['Charge rate caps at 60-80kW','Slow ramp-up to peak rate','Adapter compatibility issues'], remedy:'Ford investigating. Some improvement seen after software updates.', bulletin_ref:'Not yet filed', source_pills:['Reddit','Forum'], confirmations: 7 },
    ],
  },
};

async function seedIfEmpty(vehicle, year) {
  const yr = parseInt(year);

  // Check if we already have community data
  const existing = await query(
    `SELECT COUNT(*) as cnt FROM community WHERE vehicle_key = $1 AND year = $2`,
    [vehicle, yr]
  );
  if (parseInt(existing[0]?.cnt) > 0) return;

  // Seed with known issues
  const seeds = SEED_DATA[vehicle]?.[yr] || [];
  for (const s of seeds) {
    try {
      await query(
        `INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, confirmations, is_seeded, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,'active')
         ON CONFLICT (id) DO NOTHING`,
        [s.id, vehicle, yr, s.component, s.severity, s.title, s.summary, s.symptoms || [], s.remedy || '', s.bulletin_ref || '', s.source_pills || [], s.confirmations || 1]
      );
    } catch (e) {
      console.error('Seed insert error:', e.message);
    }
  }
}

export async function handler(event) {
if (event.httpMethod === 'OPTIONS') return preflight();

const { vehicle, year } = event.queryStringParameters || {};
if (!vehicle || !year) return err('vehicle and year required', 400);

try {
// Seed data if the community table is empty for this vehicle/year
await seedIfEmpty(vehicle, year);

const rows = await query(
`SELECT * FROM community WHERE vehicle_key = $1 AND year = $2 AND status = 'active' ORDER BY is_seeded DESC, confirmations DESC, created_at DESC`,
[vehicle, parseInt(year)]
);
return ok(rows);
} catch (e) {
console.error('community error:', e);
return err('Database error: ' + e.message);
}
}
