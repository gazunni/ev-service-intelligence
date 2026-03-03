-- EV Service Intelligence - Seed Data
-- Run this after schema.sql to populate the curated baseline issues
-- Safe to re-run - uses INSERT ... ON CONFLICT DO NOTHING

-- --- CHEVROLET EQUINOX EV ---

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-water-ingress', 'equinox_ev', 2024,
'Body -- Floor Seams / A/C Drain', 'MODERATE',
'Passenger Floor Water Ingress / Mold Risk',
'Water accumulates under the passenger-side carpet causing mold and potential electrical damage. Three confirmed root causes: (1) disconnected A/C condensate drain line, (2) plugged sunroof drains on sunroof trims, (3) unsealed floor seams allowing water infiltration from below.',
ARRAY['Wet or damp carpet on passenger side','Musty smell inside cabin','Mold visible under carpet','Water pooling under passenger seat after rain'],
'Dealer reseals floor seams, reconnects A/C drain line, clears sunroof drains. Carpet/pad replaced if saturated. Covered under bumper-to-bumper warranty.',
'Not filed with NHTSA. Surfaced via Equinox EV Facebook owner groups.',
ARRAY['Facebook Group','Forum','Dealer Confirmed'],
'[]'::JSONB, 47, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-water-ingress-2025', 'equinox_ev', 2025,
'Body -- Floor Seams / A/C Drain', 'MODERATE',
'Passenger Floor Water Ingress / Mold Risk',
'Water accumulates under the passenger-side carpet causing mold and potential electrical damage. Three confirmed root causes: (1) disconnected A/C condensate drain line, (2) plugged sunroof drains on sunroof trims, (3) unsealed floor seams allowing water infiltration from below.',
ARRAY['Wet or damp carpet on passenger side','Musty smell inside cabin','Mold visible under carpet','Water pooling under passenger seat after rain'],
'Dealer reseals floor seams, reconnects A/C drain line, clears sunroof drains. Carpet/pad replaced if saturated. Covered under bumper-to-bumper warranty.',
'Not filed with NHTSA. Surfaced via Equinox EV Facebook owner groups.',
ARRAY['Facebook Group','Forum','Dealer Confirmed'],
'[]'::JSONB, 47, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-telematics-failure', 'equinox_ev', 2024,
'Electronics -- Telematics Control Module (TCM)', 'MODERATE',
'Telematics Module Failure -- OnStar / GPS / Connectivity Loss',
'Widespread failure of the Telematics Control Module (TCM) across 2024-2025 Equinox EV. Owners lose OnStar, GPS navigation, Google Built-In, myChevrolet app, remote charging control, and Super Cruise. Some cases software-fixable via PIT6411B; others require full hardware replacement which is frequently on back-order.',
ARRAY['OnStar button shows red light','GPS shows no location or wrong location','myChevrolet app cannot connect to vehicle','Navigation not working','Service Emergency Calling warning','Charge scheduling via app not working','Super Cruise disabled'],
'Dealer checks bulletin PIT6411B first -- Radio Standalone Update (SPS2) fixes some cases. If module replacement needed, part may be on back-order. Escalate to GM Customer Care 1-800-222-1020 if no timeline provided.',
'GM PIT Bulletin PIT6411B (Sept 30 2025) -- Loss of OnStar Connectivity.',
ARRAY['Forum','OnStar Community','GM Authority','Dealer Confirmed'],
'[{"label":"GM Authority coverage","type":"forum","url":"https://gmauthority.com/blog/2026/01/gm-working-hard-to-resolve-telematics-module-issues/"},{"label":"Equinox EV Forum thread","type":"forum","url":"https://www.equinoxevforum.com/threads/telematic-i-e-onstar-module.5537/"}]'::JSONB,
284, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-telematics-failure-2025', 'equinox_ev', 2025,
'Electronics -- Telematics Control Module (TCM)', 'MODERATE',
'Telematics Module Failure -- OnStar / GPS / Connectivity Loss',
'Widespread failure of the Telematics Control Module (TCM) across 2024-2025 Equinox EV. Owners lose OnStar, GPS navigation, Google Built-In, myChevrolet app, remote charging control, and Super Cruise. Some cases software-fixable via PIT6411B; others require full hardware replacement which is frequently on back-order.',
ARRAY['OnStar button shows red light','GPS shows no location or wrong location','myChevrolet app cannot connect to vehicle','Navigation not working','Service Emergency Calling warning','Charge scheduling via app not working','Super Cruise disabled'],
'Dealer checks bulletin PIT6411B first -- Radio Standalone Update (SPS2) fixes some cases. If module replacement needed, part may be on back-order. Escalate to GM Customer Care 1-800-222-1020 if no timeline provided.',
'GM PIT Bulletin PIT6411B (Sept 30 2025) -- Loss of OnStar Connectivity.',
ARRAY['Forum','OnStar Community','GM Authority','Dealer Confirmed'],
'[{"label":"GM Authority coverage","type":"forum","url":"https://gmauthority.com/blog/2026/01/gm-working-hard-to-resolve-telematics-module-issues/"},{"label":"Equinox EV Forum thread","type":"forum","url":"https://www.equinoxevforum.com/threads/telematic-i-e-onstar-module.5537/"}]'::JSONB,
284, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-sharkfin-loose', 'equinox_ev', 2024,
'Body -- Roof Shark Fin Antenna Cover', 'LOW',
'Shark Fin Antenna Cover Loose / Detaching',
'The plastic shark fin antenna cover is inadequately secured at the factory. Owners report the cover is loose or detaches entirely after car washes or highway driving. A gap under the front of the fin allows water ingress which can damage the antenna PCB and contribute to telematics failures.',
ARRAY['Shark fin can be rocked or lifted by hand','Visible gap under front of antenna cover','Cover came off in car wash or at highway speed','Loose cover rattling at speed'],
'Report to dealer for warranty replacement of antenna assembly. Avoid automated car washes with high-pressure sprays until repaired.',
'No formal GM bulletin filed. Widely reported on Equinox EV Forum. May be related to telematics failures if water ingress occurs.',
ARRAY['Forum','Dealer Confirmed'],
'[{"label":"Equinox EV Forum -- Check your sharkfin","type":"forum","url":"https://www.equinoxevforum.com/threads/check-your-sharkfin.3270/"}]'::JSONB,
67, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-sharkfin-loose-2025', 'equinox_ev', 2025,
'Body -- Roof Shark Fin Antenna Cover', 'LOW',
'Shark Fin Antenna Cover Loose / Detaching',
'The plastic shark fin antenna cover is inadequately secured at the factory. Owners report the cover is loose or detaches entirely after car washes or highway driving. A gap under the front of the fin allows water ingress which can damage the antenna PCB and contribute to telematics failures.',
ARRAY['Shark fin can be rocked or lifted by hand','Visible gap under front of antenna cover','Cover came off in car wash or at highway speed','Loose cover rattling at speed'],
'Report to dealer for warranty replacement of antenna assembly. Avoid automated car washes with high-pressure sprays until repaired.',
'No formal GM bulletin filed. Widely reported on Equinox EV Forum. May be related to telematics failures if water ingress occurs.',
ARRAY['Forum','Dealer Confirmed'],
'[{"label":"Equinox EV Forum -- Check your sharkfin","type":"forum","url":"https://www.equinoxevforum.com/threads/check-your-sharkfin.3270/"}]'::JSONB,
67, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-vihp-regen', 'equinox_ev', 2024,
'Powertrain -- Regenerative Braking (VIHP)', 'LOW',
'VIHP Regen / Inconsistent Brake Feel',
'Inconsistent one-pedal driving behavior and varying brake pedal feel, especially in cold weather. Suspected VIHP calibration variance. GM OTA updates have partially addressed this.',
ARRAY['Inconsistent regen braking strength','Brake pedal feel changes between drives','One-pedal driving less predictable in cold'],
'Check for OTA updates via myChevrolet app. Dealer can verify latest powertrain calibration.',
'No NHTSA filing. OTA updates partially address issue.',
ARRAY['Reddit','Forum'],
'[]'::JSONB, 23, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-dash-glare', 'equinox_ev', 2024,
'Interior -- Dashboard / Windshield', 'MODERATE',
'Dashboard Glare on Windshield -- Safety Visibility Issue',
'The ribbed plastic dashboard reflects sunlight onto the windshield, obstructing driver visibility at certain sun angles. GM acknowledged the issue and issued bulletin 25-NA-069 with an official dash mat fix for 2024-2025 models. The 2026 Equinox EV received a revised dashboard design.',
ARRAY['Glare from dashboard reflecting on windshield in sunlight','Difficulty seeing pedestrians or traffic in bright sun','Worst when driving toward the sun or at low sun angles'],
'Ask dealer to install official dash mat under bulletin 25-NA-069. Free within warranty. Part 86279931 (without HUD) or 86279932 (with HUD). Installation under 30 minutes.',
'GM Bulletin 25-NA-069. Parts: 86279931 (no HUD), 86279932 (HUD). Multiple NHTSA safety complaints filed.',
ARRAY['TSB Filed','NHTSA Complaints','Forum','Dealer Confirmed'],
'[{"label":"GM Authority coverage","type":"forum","url":"https://gmauthority.com/blog/2025/08/gm-releases-fix-for-chevy-equinox-ev-dashboard-glare/"}]'::JSONB,
312, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'equinox-dash-glare-2025', 'equinox_ev', 2025,
'Interior -- Dashboard / Windshield', 'MODERATE',
'Dashboard Glare on Windshield -- Safety Visibility Issue',
'The ribbed plastic dashboard reflects sunlight onto the windshield, obstructing driver visibility at certain sun angles. GM acknowledged the issue and issued bulletin 25-NA-069 with an official dash mat fix for 2024-2025 models. The 2026 Equinox EV received a revised dashboard design.',
ARRAY['Glare from dashboard reflecting on windshield in sunlight','Difficulty seeing pedestrians or traffic in bright sun','Worst when driving toward the sun or at low sun angles'],
'Ask dealer to install official dash mat under bulletin 25-NA-069. Free within warranty. Part 86279931 (without HUD) or 86279932 (with HUD). Installation under 30 minutes.',
'GM Bulletin 25-NA-069. Parts: 86279931 (no HUD), 86279932 (HUD). Multiple NHTSA safety complaints filed.',
ARRAY['TSB Filed','NHTSA Complaints','Forum','Dealer Confirmed'],
'[{"label":"GM Authority coverage","type":"forum","url":"https://gmauthority.com/blog/2025/08/gm-releases-fix-for-chevy-equinox-ev-dashboard-glare/"}]'::JSONB,
312, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

-- --- CHEVROLET BLAZER EV ---

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'blazer-launch-software', 'blazer_ev', 2024,
'Software -- Infotainment, ADAS, Charging Systems', 'MODERATE',
'Launch Software Bugs -- Infotainment / ADAS / Charging',
'2024 Blazer EV launched with significant software issues: infotainment freezing, ADAS unavailability, charging failures. Multiple OTA and in-dealer updates issued through 2024. Most resolved by mid-2024 revision.',
ARRAY['Infotainment freezing or rebooting','ADAS features disabled','Charging stops unexpectedly','Random system warnings at startup'],
'Ensure latest software via myChevrolet app. Persistent issues: dealer in-shop update.',
'Multiple GM TSBs issued. Check NHTSA manufacturer communications for 2024 Blazer EV.',
ARRAY['Forum','Reddit','Dealer Confirmed'],
'[]'::JSONB, 89, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

-- --- FORD MUSTANG MACH-E ---

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'mache-12v-drain', 'mach_e', 2024,
'Electrical -- 12V Auxiliary Battery', 'MODERATE',
'12V Auxiliary Battery Drain After Parking',
'Mach-E 12V auxiliary battery depletes after sitting several days, especially in cold. HV battery does not adequately maintain 12V charge when not driven. Results in inability to unlock or start.',
ARRAY['Dead 12V battery after a few days','Doors won''t unlock with key fob','Vehicle won''t power on','Requires jump start'],
'Ford issued software updates for 12V charging management. Some vehicles need 12V battery replacement. Ask dealer about SSM service messages.',
'Multiple TSBs filed. Ref Ford SSM 49968.',
ARRAY['Reddit','Forum'],
'[{"label":"r/MachE thread","type":"reddit","url":"https://reddit.com/r/MacHE"}]'::JSONB,
112, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO community (id, vehicle_key, year, component, severity, title, summary, symptoms, remedy, bulletin_ref, source_pills, links, confirmations, is_seeded, status)
VALUES (
'mache-12v-drain-2023', 'mach_e', 2023,
'Electrical -- 12V Auxiliary Battery', 'MODERATE',
'12V Auxiliary Battery Drain After Parking',
'Mach-E 12V auxiliary battery depletes after sitting several days, especially in cold. HV battery does not adequately maintain 12V charge when not driven. Results in inability to unlock or start.',
ARRAY['Dead 12V battery after a few days','Doors won''t unlock with key fob','Vehicle won''t power on','Requires jump start'],
'Ford issued software updates for 12V charging management. Some vehicles need 12V battery replacement. Ask dealer about SSM service messages.',
'Multiple TSBs filed. Ref Ford SSM 49968.',
ARRAY['Reddit','Forum'],
'[{"label":"r/MachE thread","type":"reddit","url":"https://reddit.com/r/MacHE"}]'::JSONB,
112, TRUE, 'active'
) ON CONFLICT (id) DO NOTHING;
