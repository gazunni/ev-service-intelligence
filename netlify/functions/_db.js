// netlify/functions/_db.js
// Shared database helpers for all Netlify functions
// Connects to Neon PostgreSQL via DATABASE_URL

import pg from 'pg';
const { Pool } = pg;

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

// Auto-create tables on first use
let initialized = false;

async function ensureTables() {
  if (initialized) return;

  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS recalls (
      id              TEXT PRIMARY KEY,
      vehicle_key     TEXT NOT NULL,
      year            INT  NOT NULL,
      component       TEXT,
      severity        TEXT DEFAULT 'MODERATE',
      title           TEXT,
      risk            TEXT,
      remedy          TEXT,
      affected_units  INT,
      source_pills    TEXT[] DEFAULT ARRAY['NHTSA Official'],
      raw_nhtsa       JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tsbs (
      id              TEXT PRIMARY KEY,
      vehicle_key     TEXT NOT NULL,
      year            INT  NOT NULL,
      component       TEXT,
      severity        TEXT DEFAULT 'MODERATE',
      title           TEXT,
      summary         TEXT,
      remedy          TEXT,
      source_pills    TEXT[] DEFAULT ARRAY['NHTSA Filed'],
      raw_nhtsa       JSONB,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS community (
      id              TEXT PRIMARY KEY,
      vehicle_key     TEXT NOT NULL,
      year            INT  NOT NULL,
      component       TEXT,
      severity        TEXT DEFAULT 'LOW',
      title           TEXT NOT NULL,
      summary         TEXT,
      symptoms        TEXT[] DEFAULT ARRAY[]::TEXT[],
      remedy          TEXT,
      bulletin_ref    TEXT,
      source_pills    TEXT[] DEFAULT ARRAY[]::TEXT[],
      links           JSONB DEFAULT '[]'::JSONB,
      confirmations   INT DEFAULT 1,
      is_seeded       BOOLEAN DEFAULT FALSE,
      ai_sweep        BOOLEAN DEFAULT FALSE,
      status          TEXT DEFAULT 'active',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS review_queue (
      id              SERIAL PRIMARY KEY,
      vehicle_key     TEXT NOT NULL,
      year            INT  NOT NULL,
      extracted       JSONB NOT NULL,
      source_type     TEXT,
      source_url      TEXT,
      confidence      TEXT DEFAULT 'MEDIUM',
      likely_match_id TEXT,
      status          TEXT DEFAULT 'pending',
      reviewed_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sweep_log (
      id              SERIAL PRIMARY KEY,
      vehicle_key     TEXT NOT NULL,
      year            INT  NOT NULL,
      recalls_found   INT DEFAULT 0,
      tsbs_found      INT DEFAULT 0,
      swept_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(vehicle_key, year)
    );

    CREATE INDEX IF NOT EXISTS idx_recalls_vehicle_year    ON recalls(vehicle_key, year);
    CREATE INDEX IF NOT EXISTS idx_tsbs_vehicle_year       ON tsbs(vehicle_key, year);
    CREATE INDEX IF NOT EXISTS idx_community_vehicle_year  ON community(vehicle_key, year, status);
    CREATE INDEX IF NOT EXISTS idx_review_queue_status     ON review_queue(status, vehicle_key, year);
  `);

  initialized = true;
}

export async function query(sql, params = []) {
  await ensureTables();
  const p = getPool();
  const result = await p.query(sql, params);
  return result.rows;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function ok(data) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(data),
  };
}

export function err(message, statusCode = 500) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ error: message }),
  };
}

export function preflight() {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: '',
  };
}
