// functions/get-data.js
import { Client } from 'neon-js';

const neon = new Client({ connectionString: process.env.NEON_URI });

export async function handler(event, context){
  const { vehicle, year } = event.queryStringParameters || {};
  if(!vehicle || !year) return { statusCode:400, body:'Missing vehicle or year' };

  const res = await neon.query('SELECT data FROM records WHERE data->>\'year\'=$1', [year]);
  const records = res.map(r => r.data);

  const recalls = records.filter(r => r.severity && r.id.startsWith('r-'));
  const community = records.filter(r => r.source && r.source==='community');
  const tsb = records.filter(r => r.source && r.source==='tsb');
  const pip = records.filter(r => r.source && r.source==='pip');

  return {
    statusCode:200,
    body: JSON.stringify({ recalls, community, tsb, pip })
  };
}
