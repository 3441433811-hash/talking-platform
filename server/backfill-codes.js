// 给没有 short_code 的房间补上短码
const { Pool } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('need DATABASE_URL'); process.exit(1) }

const pool = new Pool({ connectionString: DATABASE_URL, max: 1 })
const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const gen = () => { let c=''; for(let i=0;i<6;i++) c+=chars[Math.floor(Math.random()*chars.length)]; return c }

async function main() {
  const { rows } = await pool.query("SELECT id, name FROM rooms WHERE short_code IS NULL")
  console.log(`Found ${rows.length} rooms without short_code`)
  for (const r of rows) {
    const sc = gen()
    await pool.query('UPDATE rooms SET short_code=$1 WHERE id=$2', [sc, r.id])
    console.log(`  ${r.name} → ${sc}`)
  }
  console.log('Done.')
  await pool.end()
}
main()
