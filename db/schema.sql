– EV Service Intelligence — Neon Database Schema
– Run this once against your Neon database to create all tables

– Official recalls from NHTSA
CREATE TABLE IF NOT EXISTS recalls (
id              TEXT PRIMARY KEY,
vehicle_key     TEXT NOT NULL,
year            INT  NOT NULL,
component       TEXT,
severity        TEXT DEFAULT ‘MODERATE’,
title           TEXT,
risk            TEXT,
remedy          TEXT,
affected_units  INT,
source_pills    TEXT[] DEFAULT ARRAY[‘NHTSA Official’],
raw_nhtsa       JSONB,
created_at      TIMESTAMPTZ DEFAULT NOW(),
updated_at      TIMESTAMPTZ DEFAULT NOW()
);

– TSBs from NHTSA manufacturer communications
CREATE TABLE IF NOT EXISTS tsbs (
id              TEXT PRIMARY KEY,
vehicle_key     TEXT NOT NULL,
year            INT  NOT NULL,
component       TEXT,
severity        TEXT DEFAULT ‘MODERATE’,
title           TEXT,
summary         TEXT,
remedy          TEXT,
source_pills    TEXT[] DEFAULT ARRAY[‘NHTSA Filed’],
raw_nhtsa       JSONB,
created_at      TIMESTAMPTZ DEFAULT NOW(),
updated_at      TIMESTAMPTZ DEFAULT NOW()
);

– Community issues: seeded + user submitted + AI sweep
CREATE TABLE IF NOT EXISTS community (
id              TEXT PRIMARY KEY,
vehicle_key     TEXT NOT NULL,
year            INT  NOT NULL,
component       TEXT,
severity        TEXT DEFAULT ‘LOW’,
title           TEXT NOT NULL,
summary         TEXT,
symptoms        TEXT[] DEFAULT ARRAY[]::TEXT[],
remedy          TEXT,
bulletin_ref    TEXT,
source_pills    TEXT[] DEFAULT ARRAY[]::TEXT[],
links           JSONB DEFAULT ‘[]’::JSONB,
confirmations   INT DEFAULT 1,
is_seeded       BOOLEAN DEFAULT FALSE,
ai_sweep        BOOLEAN DEFAULT FALSE,
status          TEXT DEFAULT ‘active’,
created_at      TIMESTAMPTZ DEFAULT NOW(),
updated_at      TIMESTAMPTZ DEFAULT NOW()
);

– Review queue: AI sweep results waiting for human approval
CREATE TABLE IF NOT EXISTS review_queue (
id              SERIAL PRIMARY KEY,
vehicle_key     TEXT NOT NULL,
year            INT  NOT NULL,
extracted       JSONB NOT NULL,
source_type     TEXT,
source_url      TEXT,
confidence      TEXT DEFAULT ‘MEDIUM’,
likely_match_id TEXT,
status          TEXT DEFAULT ‘pending’,
reviewed_at     TIMESTAMPTZ,
created_at      TIMESTAMPTZ DEFAULT NOW()
);

– Sweep log: track when NHTSA was last fetched per vehicle/year
CREATE TABLE IF NOT EXISTS sweep_log (
id              SERIAL PRIMARY KEY,
vehicle_key     TEXT NOT NULL,
year            INT  NOT NULL,
recalls_found   INT DEFAULT 0,
tsbs_found      INT DEFAULT 0,
swept_at        TIMESTAMPTZ DEFAULT NOW(),
UNIQUE(vehicle_key, year)
);

– Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_recalls_vehicle_year    ON recalls(vehicle_key, year);
CREATE INDEX IF NOT EXISTS idx_tsbs_vehicle_year       ON tsbs(vehicle_key, year);
CREATE INDEX IF NOT EXISTS idx_community_vehicle_year  ON community(vehicle_key, year, status);
CREATE INDEX IF NOT EXISTS idx_review_queue_status     ON review_queue(status, vehicle_key, year);
