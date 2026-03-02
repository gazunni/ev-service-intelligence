import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function handler(event) {
  const { vkey, year, title, detail } = JSON.parse(event.body);

  const id = `usr-${Date.now()}`;

  await pool.query(
    `INSERT INTO issues (id,vkey,year,type,title,summary,severity,source)
     VALUES ($1,$2,$3,'community',$4,$5,'LOW','user')`,
    [id, vkey, year, title, detail]
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
}
