import pg from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const isLocal = /localhost|127\.0\.0\.1/i.test(process.env.DATABASE_URL);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  allowExitOnIdle: true,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err);
});

export async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function closePool() {
  await pool.end();
}

export default pool;
