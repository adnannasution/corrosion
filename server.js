/**
 * Corrosion Mapping System — REST API v2.0
 * Database: PostgreSQL (Railway) — data permanen, tidak hilang saat restart
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req,_res,next)=>{ console.log(`${new Date().toISOString()} ${req.method} ${req.url}`); next(); });

function calcRL(m,r,minA){ if(!m||!r||r<=0) return null; return parseFloat(((m-minA)/r).toFixed(2)); }
function calcStatus(m,r,minA){ if(!m||!r||r<=0) return 'unknown'; const rl=(m-minA)/r; return rl<2?'critical':rl<5?'warning':rl<10?'monitor':'good'; }

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS equipment (
      id SERIAL PRIMARY KEY, tag VARCHAR(50) UNIQUE NOT NULL, name VARCHAR(200),
      type VARCHAR(50), pfd_x INT, pfd_y INT, pfd_w INT, pfd_h INT,
      nom_thickness FLOAT, min_allowable FLOAT, measured_thickness FLOAT,
      corrosion_rate FLOAT, remaining_life_yr FLOAT, status VARCHAR(20) DEFAULT 'unknown',
      last_inspection_date DATE, next_inspection_date DATE, notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

    await client.query(`CREATE TABLE IF NOT EXISTS lines (
      id SERIAL PRIMARY KEY, line_id VARCHAR(50) UNIQUE NOT NULL, description TEXT,
      size VARCHAR(20), spec VARCHAR(50), nom_thickness FLOAT, min_allowable FLOAT,
      measured_thickness FLOAT, corrosion_rate FLOAT, remaining_life_yr FLOAT,
      status VARCHAR(20) DEFAULT 'unknown', last_inspection_date DATE,
      next_inspection_date DATE, notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);

    await client.query(`CREATE TABLE IF NOT EXISTS inspection_history (
      id SERIAL PRIMARY KEY, ref_type VARCHAR(20), ref_tag VARCHAR(50),
      measured_thickness FLOAT, corrosion_rate FLOAT, remaining_life_yr FLOAT,
      status VARCHAR(20), inspected_at TIMESTAMPTZ, notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW())`);

    const { rows } = await client.query('SELECT COUNT(*) FROM equipment');
    if (parseInt(rows[0].count) === 0) {
      console.log('Seeding dari db.json...');
      const seed = JSON.parse(fs.readFileSync(DB_PATH,'utf8'));
      for (const eq of seed.equipment) {
        await client.query(`INSERT INTO equipment (tag,name,type,pfd_x,pfd_y,pfd_w,pfd_h,
          nom_thickness,min_allowable,measured_thickness,corrosion_rate,remaining_life_yr,status,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (tag) DO NOTHING`,
          [eq.tag,eq.name,eq.type,eq.pfd_x,eq.pfd_y,eq.pfd_w,eq.pfd_h,
           eq.nom_thickness,eq.min_allowable,eq.measured_thickness,
           eq.corrosion_rate,eq.remaining_life_yr,eq.status,eq.notes||'']);
      }
      for (const ln of seed.lines) {
        await client.query(`INSERT INTO lines (line_id,description,size,spec,
          nom_thickness,min_allowable,measured_thickness,corrosion_rate,remaining_life_yr,status,notes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (line_id) DO NOTHING`,
          [ln.line_id,ln.description,ln.size,ln.spec,
           ln.nom_thickness,ln.min_allowable,ln.measured_thickness,
           ln.corrosion_rate,ln.remaining_life_yr,ln.status,ln.notes||'']);
      }
      console.log(`Seed selesai: ${seed.equipment.length} equipment, ${seed.lines.length} lines`);
    } else {
      console.log(`DB sudah ada: ${rows[0].count} equipment`);
    }
  } finally { client.release(); }
}

// HEALTH
app.get('/health', (_req,res) => res.json({ status:'ok' }));
app.get('/api', async (_req,res) => {
  try {
    const [e,l,h] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM equipment'),
      pool.query('SELECT COUNT(*) FROM lines'),
      pool.query('SELECT COUNT(*) FROM inspection_history')
    ]);
    res.json({ service:'Corrosion Mapping API', version:'2.0.0', database:'PostgreSQL',
      counts:{ equipment:+e.rows[0].count, lines:+l.rows[0].count, history:+h.rows[0].count }});
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// EQUIPMENT
app.get('/api/equipment', async (req,res) => {
  try {
    let q='SELECT * FROM equipment', p=[], c=[];
    if(req.query.status){ c.push(`status=$${p.length+1}`); p.push(req.query.status); }
    if(req.query.type)  { c.push(`type=$${p.length+1}`);   p.push(req.query.type); }
    if(c.length) q+=' WHERE '+c.join(' AND ');
    q+=' ORDER BY id';
    const {rows}=await pool.query(q,p);
    res.json({ count:rows.length, data:rows });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/equipment/:tag', async (req,res) => {
  try {
    const {rows}=await pool.query('SELECT * FROM equipment WHERE tag=$1',[req.params.tag]);
    if(!rows.length) return res.status(404).json({ error:'Tag not found' });
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.put('/api/equipment/:tag', async (req,res) => {
  try {
    const {rows:cur}=await pool.query('SELECT * FROM equipment WHERE tag=$1',[req.params.tag]);
    if(!cur.length) return res.status(404).json({ error:'Tag not found' });
    const old=cur[0];
    const m=req.body.measured_thickness??old.measured_thickness;
    const r=req.body.corrosion_rate??old.corrosion_rate;
    const rl=calcRL(m,r,old.min_allowable), st=calcStatus(m,r,old.min_allowable);
    const {rows}=await pool.query(`UPDATE equipment SET measured_thickness=$1,corrosion_rate=$2,
      remaining_life_yr=$3,status=$4,last_inspection_date=$5,next_inspection_date=$6,
      notes=$7,updated_at=NOW() WHERE tag=$8 RETURNING *`,
      [m,r,rl,st,req.body.last_inspection_date||old.last_inspection_date,
       req.body.next_inspection_date||old.next_inspection_date,
       req.body.notes??old.notes,req.params.tag]);
    await pool.query(`INSERT INTO inspection_history (ref_type,ref_tag,measured_thickness,
      corrosion_rate,remaining_life_yr,status,inspected_at,notes)
      VALUES ('equipment',$1,$2,$3,$4,$5,$6,$7)`,
      [req.params.tag,m,r,rl,st,req.body.last_inspection_date||new Date().toISOString(),req.body.notes||'']);
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/equipment/bulk', async (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Body must be array' });
  const results=[];
  try {
    for(const item of req.body){
      const {rows:cur}=await pool.query('SELECT * FROM equipment WHERE tag=$1',[item.tag]);
      if(!cur.length) continue;
      const old=cur[0];
      const m=item.measured_thickness??old.measured_thickness;
      const r=item.corrosion_rate??old.corrosion_rate;
      const rl=calcRL(m,r,old.min_allowable), st=calcStatus(m,r,old.min_allowable);
      const {rows}=await pool.query(`UPDATE equipment SET measured_thickness=$1,corrosion_rate=$2,
        remaining_life_yr=$3,status=$4,notes=$5,updated_at=NOW() WHERE tag=$6 RETURNING *`,
        [m,r,rl,st,item.notes??old.notes,item.tag]);
      results.push(rows[0]);
    }
    res.json({ updated:results.length, data:results });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// LINES
app.get('/api/lines', async (req,res) => {
  try {
    let q='SELECT * FROM lines', p=[];
    if(req.query.status){ q+=' WHERE status=$1'; p.push(req.query.status); }
    q+=' ORDER BY id';
    const {rows}=await pool.query(q,p);
    res.json({ count:rows.length, data:rows });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.get('/api/lines/:id', async (req,res) => {
  try {
    const {rows}=await pool.query('SELECT * FROM lines WHERE line_id=$1',[req.params.id]);
    if(!rows.length) return res.status(404).json({ error:'Line not found' });
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.put('/api/lines/:id', async (req,res) => {
  try {
    const {rows:cur}=await pool.query('SELECT * FROM lines WHERE line_id=$1',[req.params.id]);
    if(!cur.length) return res.status(404).json({ error:'Line not found' });
    const old=cur[0];
    const m=req.body.measured_thickness??old.measured_thickness;
    const r=req.body.corrosion_rate??old.corrosion_rate;
    const rl=calcRL(m,r,old.min_allowable), st=calcStatus(m,r,old.min_allowable);
    const {rows}=await pool.query(`UPDATE lines SET measured_thickness=$1,corrosion_rate=$2,
      remaining_life_yr=$3,status=$4,notes=$5,updated_at=NOW() WHERE line_id=$6 RETURNING *`,
      [m,r,rl,st,req.body.notes??old.notes,req.params.id]);
    await pool.query(`INSERT INTO inspection_history (ref_type,ref_tag,measured_thickness,
      corrosion_rate,remaining_life_yr,status,inspected_at,notes)
      VALUES ('line',$1,$2,$3,$4,$5,$6,$7)`,
      [req.params.id,m,r,rl,st,req.body.last_inspection_date||new Date().toISOString(),req.body.notes||'']);
    res.json(rows[0]);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

app.post('/api/lines/bulk', async (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Body must be array' });
  const results=[];
  try {
    for(const item of req.body){
      const {rows:cur}=await pool.query('SELECT * FROM lines WHERE line_id=$1',[item.line_id]);
      if(!cur.length) continue;
      const old=cur[0];
      const m=item.measured_thickness??old.measured_thickness;
      const r=item.corrosion_rate??old.corrosion_rate;
      const rl=calcRL(m,r,old.min_allowable), st=calcStatus(m,r,old.min_allowable);
      const {rows}=await pool.query(`UPDATE lines SET measured_thickness=$1,corrosion_rate=$2,
        remaining_life_yr=$3,status=$4,updated_at=NOW() WHERE line_id=$5 RETURNING *`,
        [m,r,rl,st,item.line_id]);
      results.push(rows[0]);
    }
    res.json({ updated:results.length, data:results });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// HISTORY
app.get('/api/history', async (req,res) => {
  try {
    let q='SELECT * FROM inspection_history', p=[], c=[];
    if(req.query.tag) { c.push(`ref_tag=$${p.length+1}`);  p.push(req.query.tag); }
    if(req.query.type){ c.push(`ref_type=$${p.length+1}`); p.push(req.query.type); }
    if(c.length) q+=' WHERE '+c.join(' AND ');
    q+=' ORDER BY inspected_at DESC LIMIT 500';
    const {rows}=await pool.query(q,p);
    res.json({ count:rows.length, data:rows });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// SUMMARY
app.get('/api/summary', async (_req,res) => {
  try {
    const [eq,ln,hi,crit]=await Promise.all([
      pool.query('SELECT status,COUNT(*) FROM equipment GROUP BY status'),
      pool.query('SELECT status,COUNT(*) FROM lines GROUP BY status'),
      pool.query('SELECT COUNT(*) FROM inspection_history'),
      pool.query(`SELECT tag,name,remaining_life_yr FROM equipment
        WHERE status='critical' ORDER BY remaining_life_yr ASC NULLS LAST`)
    ]);
    const counts={good:0,monitor:0,warning:0,critical:0,unknown:0};
    [...eq.rows,...ln.rows].forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]+=+r.count; });
    res.json({ total:Object.values(counts).reduce((a,b)=>a+b,0), ...counts,
      equipment_count:eq.rows.reduce((a,r)=>a+ +r.count,0),
      lines_count:ln.rows.reduce((a,r)=>a+ +r.count,0),
      history_count:+hi.rows[0].count,
      critical_items:crit.rows, last_updated:new Date().toISOString() });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// PFD
app.get('/api/pfd', async (_req,res) => {
  try {
    const {rows}=await pool.query('SELECT tag,type,pfd_x,pfd_y,pfd_w,pfd_h,status,remaining_life_yr FROM equipment ORDER BY id');
    res.json({ canvas:{width:2800,height:1400}, equipment:rows });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// START
async function start() {
  try {
    await initDB();
    app.listen(PORT, ()=>{
      console.log(`\n🔧 Corrosion Mapping API v2.0`);
      console.log(`   Port: ${PORT} | DB: PostgreSQL\n`);
    });
  } catch(e){ console.error('Failed to start:', e.message); process.exit(1); }
}
start();
