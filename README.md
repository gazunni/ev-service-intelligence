# EV Service Intelligence

A service advisor tool for tracking safety recalls, technical service bulletins (TSBs), and community-reported issues across electric vehicles.

## Supported Vehicles

| Vehicle | Model Years |
|---|---|
| Chevrolet Equinox EV | 2024 – 2026 |
| Chevrolet Blazer EV | 2024 – 2026 |
| Ford Mustang Mach-E | 2021 – 2026 |
| Honda Prologue | 2024 – 2026 |

## Features

- **Recalls** — Official NHTSA and Transport Canada safety recalls with severity ratings, remedy details, and direct links to source documents
- **TSBs** — Technical Service Bulletins with component, summary, remedy, and PDF links
- **Community Issues** — AI-curated owner-reported issues sourced from forums, Reddit, and dealer submissions, clustered to prevent duplication
- **VIN Lookup** — Decode a VIN to auto-select the correct vehicle and year
- **NHTSA Direct Import** — Fetch all recalls for all supported vehicles directly from the NHTSA API with no AI processing
- **AI Sweep** — Research sweep that pulls NHTSA data and surfaces community-reported issues using Claude AI
- **Search** — Real-time keyword filter across all recalls, TSBs, and community issues
- **Severity Banner** — At-a-glance Critical / Moderate / Low recall count for the selected vehicle and year
- **Admin Tools** — Deduplication, import, delete, and apply-to-vehicles controls behind an admin key

## Tech Stack

- **Backend** — Node.js / Express
- **Database** — PostgreSQL (Railway managed)
- **AI** — Anthropic Claude (Haiku for extraction, Sonnet for research sweeps)
- **Hosting** — Railway
- **Frontend** — Vanilla JS / HTML / CSS, single-file, no build step

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (set by Railway) |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI sweep and PDF extraction |
| `ADMIN_KEY` | Secret key for admin panel access |
| `TC_API_KEY` | Transport Canada VRDB API key (optional) |

## Running Locally

```bash
npm install
DATABASE_URL=your_db_url ANTHROPIC_API_KEY=your_key ADMIN_KEY=your_key node server.js
```

Then open `http://localhost:3000`.

## Data Sources

- [NHTSA Recalls API](https://api.nhtsa.gov/recalls/recallsByVehicle)
- [NHTSA TSB API](https://api.nhtsa.gov/tsbs/tsbsByVehicle)
- [Transport Canada VRDB API](https://tc.api.canada.ca/en/detail?api=VRDB)
- Community forums and owner reports (AI-curated)

## Disclaimer

Not affiliated with GM, Ford, Honda, or any manufacturer. Data may be incomplete or outdated. Always consult a qualified mechanic or dealer.
