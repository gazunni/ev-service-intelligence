import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function handler(event) {
  const { vkey, year } = event.queryStringParameters;

  const result = await pool.query(
    `SELECT * FROM issues
     WHERE vkey=$1 AND year=$2
     ORDER BY created_at DESC`,
    [vkey, year]
  );

  return {
    statusCode: 200,
    body: JSON.stringify(result.rows)
  };
}
