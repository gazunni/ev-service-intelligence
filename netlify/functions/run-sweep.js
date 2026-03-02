import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export async function handler(event) {
  const { vkey, make, model, year } = JSON.parse(event.body);

  const nhtsaURL =
    `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${make}&model=${model}&modelYear=${year}`;

  const nhtsaRes = await fetch(nhtsaURL);
  const nhtsaData = await nhtsaRes.json();

  const recalls = nhtsaData.results || [];

  for (const r of recalls) {
    await pool.query(
      `INSERT INTO issues (id, vkey, year, type, title, component, severity, summary, risk, remedy, source, raw_json)
       VALUES ($1,$2,$3,'recall',$4,$5,'MODERATE',$6,$7,$8,'nhtsa',$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.NHTSACampaignNumber,
        vkey,
        year,
        r.Summary?.substring(0, 100),
        r.Component,
        r.Summary,
        r.Consequence,
        r.Remedy,
        r
      ]
    );
  }

  await pool.query(
    `INSERT INTO sweeps (vkey, year, last_sweep)
     VALUES ($1,$2,NOW())
     ON CONFLICT (vkey,year)
     DO UPDATE SET last_sweep = NOW()`,
    [vkey, year]
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ count: recalls.length })
  };
}
