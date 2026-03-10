/**
 * Corrosion Mapping System — REST API
 * Stack: Node.js + Express + JSON file database
 * Deploy: Railway (https://railway.app)
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.use(express.json());

// Simple request logger
// ── Serve frontend ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

// ── DB helpers ────────────────────────────────────────────
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1;
}

function calcStatus(measured, corrRate, minAllow) {
  if (!measured || !corrRate || corrRate <= 0) return 'unknown';
  const rl = (measured - minAllow) / corrRate;
  if (rl < 2)  return 'critical';
  if (rl < 5)  return 'warning';
  if (rl < 10) return 'monitor';
  return 'good';
}

function calcRL(measured, corrRate, minAllow) {
  if (!measured || !corrRate || corrRate <= 0) return null;
  return parseFloat(((measured - minAllow) / corrRate).toFixed(2));
}

// ═══════════════════════════════════════════════════════════
//  HEALTH
// ═══════════════════════════════════════════════════════════
app.get('/', (_req, res) => {
  const db = readDB();
  res.json({
    service:  'Corrosion Mapping API',
    version:  '1.0.0',
    status:   'running',
    counts: {
      equipment: db.equipment.length,
      lines:     db.lines.length,
      history:   db.inspection_history.length
    }
  });
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ═══════════════════════════════════════════════════════════
//  EQUIPMENT
// ═══════════════════════════════════════════════════════════

// GET /api/equipment — list all (with optional ?status=critical|warning|monitor|good|unknown)
app.get('/api/equipment', (req, res) => {
  let db  = readDB();
  let list = db.equipment;
  if (req.query.status) {
    list = list.filter(e => e.status === req.query.status);
  }
  if (req.query.type) {
    list = list.filter(e => e.type === req.query.type);
  }
  res.json({ count: list.length, data: list });
});

// GET /api/equipment/:tag — single item
app.get('/api/equipment/:tag', (req, res) => {
  const db  = readDB();
  const item = db.equipment.find(e => e.tag === req.params.tag);
  if (!item) return res.status(404).json({ error: 'Tag not found' });
  res.json(item);
});

// PUT /api/equipment/:tag — update inspection data
app.put('/api/equipment/:tag', (req, res) => {
  const db   = readDB();
  const idx  = db.equipment.findIndex(e => e.tag === req.params.tag);
  if (idx === -1) return res.status(404).json({ error: 'Tag not found' });

  const old  = db.equipment[idx];
  const { measured_thickness, corrosion_rate, last_inspection_date,
          next_inspection_date, notes } = req.body;

  const m  = measured_thickness  !== undefined ? measured_thickness  : old.measured_thickness;
  const r  = corrosion_rate      !== undefined ? corrosion_rate      : old.corrosion_rate;

  const updated = {
    ...old,
    measured_thickness:  m,
    corrosion_rate:      r,
    remaining_life_yr:   calcRL(m, r, old.min_allowable),
    status:              calcStatus(m, r, old.min_allowable),
    last_inspection_date: last_inspection_date ?? old.last_inspection_date,
    next_inspection_date: next_inspection_date ?? old.next_inspection_date,
    notes:               notes !== undefined ? notes : old.notes,
    updated_at:          new Date().toISOString()
  };

  // Push to history
  db.inspection_history.push({
    id:         nextId(db.inspection_history),
    ref_type:   'equipment',
    ref_tag:    old.tag,
    measured_thickness:  m,
    corrosion_rate:      r,
    remaining_life_yr:   calcRL(m, r, old.min_allowable),
    status:              calcStatus(m, r, old.min_allowable),
    inspected_at:        last_inspection_date || new Date().toISOString(),
    notes:               notes || '',
    created_at:          new Date().toISOString()
  });

  db.equipment[idx] = updated;
  writeDB(db);
  res.json(updated);
});

// POST /api/equipment/bulk — update multiple tags at once
// Body: [ { tag, measured_thickness, corrosion_rate, ... }, ... ]
app.post('/api/equipment/bulk', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be array' });
  const db = readDB();
  const results = [];

  req.body.forEach(item => {
    const idx = db.equipment.findIndex(e => e.tag === item.tag);
    if (idx === -1) return;
    const old = db.equipment[idx];
    const m = item.measured_thickness ?? old.measured_thickness;
    const r = item.corrosion_rate     ?? old.corrosion_rate;
    const updated = {
      ...old,
      measured_thickness:  m,
      corrosion_rate:      r,
      remaining_life_yr:   calcRL(m, r, old.min_allowable),
      status:              calcStatus(m, r, old.min_allowable),
      last_inspection_date: item.last_inspection_date ?? old.last_inspection_date,
      next_inspection_date: item.next_inspection_date ?? old.next_inspection_date,
      notes:               item.notes !== undefined ? item.notes : old.notes,
      updated_at:          new Date().toISOString()
    };
    db.equipment[idx] = updated;
    db.inspection_history.push({
      id: nextId(db.inspection_history),
      ref_type: 'equipment', ref_tag: old.tag,
      measured_thickness: m, corrosion_rate: r,
      remaining_life_yr: calcRL(m, r, old.min_allowable),
      status: calcStatus(m, r, old.min_allowable),
      inspected_at: item.last_inspection_date || new Date().toISOString(),
      notes: item.notes || '', created_at: new Date().toISOString()
    });
    results.push(updated);
  });

  writeDB(db);
  res.json({ updated: results.length, data: results });
});

// ═══════════════════════════════════════════════════════════
//  LINES
// ═══════════════════════════════════════════════════════════

app.get('/api/lines', (req, res) => {
  let db   = readDB();
  let list = db.lines;
  if (req.query.status) list = list.filter(l => l.status === req.query.status);
  res.json({ count: list.length, data: list });
});

app.get('/api/lines/:id', (req, res) => {
  const db   = readDB();
  const item = db.lines.find(l => l.line_id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Line not found' });
  res.json(item);
});

app.put('/api/lines/:id', (req, res) => {
  const db  = readDB();
  const idx = db.lines.findIndex(l => l.line_id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Line not found' });

  const old = db.lines[idx];
  const { measured_thickness, corrosion_rate, last_inspection_date,
          next_inspection_date, notes } = req.body;
  const m = measured_thickness !== undefined ? measured_thickness : old.measured_thickness;
  const r = corrosion_rate     !== undefined ? corrosion_rate     : old.corrosion_rate;

  const updated = {
    ...old,
    measured_thickness: m, corrosion_rate: r,
    remaining_life_yr: calcRL(m, r, old.min_allowable),
    status:            calcStatus(m, r, old.min_allowable),
    last_inspection_date: last_inspection_date ?? old.last_inspection_date,
    next_inspection_date: next_inspection_date ?? old.next_inspection_date,
    notes: notes !== undefined ? notes : old.notes,
    updated_at: new Date().toISOString()
  };

  db.inspection_history.push({
    id: nextId(db.inspection_history),
    ref_type: 'line', ref_tag: old.line_id,
    measured_thickness: m, corrosion_rate: r,
    remaining_life_yr: calcRL(m, r, old.min_allowable),
    status: calcStatus(m, r, old.min_allowable),
    inspected_at: last_inspection_date || new Date().toISOString(),
    notes: notes || '', created_at: new Date().toISOString()
  });

  db.lines[idx] = updated;
  writeDB(db);
  res.json(updated);
});

app.post('/api/lines/bulk', (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Body must be array' });
  const db = readDB();
  const results = [];

  req.body.forEach(item => {
    const idx = db.lines.findIndex(l => l.line_id === item.line_id);
    if (idx === -1) return;
    const old = db.lines[idx];
    const m = item.measured_thickness ?? old.measured_thickness;
    const r = item.corrosion_rate     ?? old.corrosion_rate;
    const updated = {
      ...old,
      measured_thickness: m, corrosion_rate: r,
      remaining_life_yr: calcRL(m, r, old.min_allowable),
      status: calcStatus(m, r, old.min_allowable),
      last_inspection_date: item.last_inspection_date ?? old.last_inspection_date,
      notes: item.notes !== undefined ? item.notes : old.notes,
      updated_at: new Date().toISOString()
    };
    db.lines[idx] = updated;
    results.push(updated);
  });

  writeDB(db);
  res.json({ updated: results.length, data: results });
});

// ═══════════════════════════════════════════════════════════
//  INSPECTION HISTORY
// ═══════════════════════════════════════════════════════════

app.get('/api/history', (req, res) => {
  const db   = readDB();
  let list   = db.inspection_history;
  if (req.query.tag)  list = list.filter(h => h.ref_tag  === req.query.tag);
  if (req.query.type) list = list.filter(h => h.ref_type === req.query.type);
  // Sort newest first
  list = [...list].sort((a, b) => new Date(b.inspected_at) - new Date(a.inspected_at));
  res.json({ count: list.length, data: list });
});

// ═══════════════════════════════════════════════════════════
//  SUMMARY / DASHBOARD
// ═══════════════════════════════════════════════════════════

app.get('/api/summary', (_req, res) => {
  const db = readDB();
  const all = [...db.equipment, ...db.lines];

  const summary = {
    total:   all.length,
    good:     all.filter(x => x.status === 'good').length,
    monitor:  all.filter(x => x.status === 'monitor').length,
    warning:  all.filter(x => x.status === 'warning').length,
    critical: all.filter(x => x.status === 'critical').length,
    unknown:  all.filter(x => x.status === 'unknown').length,
    equipment_count: db.equipment.length,
    lines_count:     db.lines.length,
    history_count:   db.inspection_history.length,
    critical_items: all
      .filter(x => x.status === 'critical')
      .map(x => ({ tag: x.tag || x.line_id, name: x.name || x.description, remaining_life_yr: x.remaining_life_yr }))
      .sort((a, b) => (a.remaining_life_yr || 99) - (b.remaining_life_yr || 99)),
    last_updated: new Date().toISOString()
  };

  res.json(summary);
});

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════

app.get('/api/settings', (_req, res) => {
  const db = readDB();
  const obj = {};
  db.settings.forEach(s => { obj[s.key] = s.value; });
  res.json(obj);
});

app.put('/api/settings/:key', (req, res) => {
  const db  = readDB();
  const idx = db.settings.findIndex(s => s.key === req.params.key);
  if (idx === -1) {
    db.settings.push({ id: nextId(db.settings), key: req.params.key, value: req.body.value });
  } else {
    db.settings[idx].value = req.body.value;
  }
  writeDB(db);
  res.json({ key: req.params.key, value: req.body.value });
});

// ═══════════════════════════════════════════════════════════
//  PFD LAYOUT (for frontend)
// ═══════════════════════════════════════════════════════════

app.get('/api/pfd', (_req, res) => {
  const db = readDB();
  const layout = db.equipment.map(e => ({
    tag:    e.tag,
    type:   e.type,
    x: e.pfd_x, y: e.pfd_y, w: e.pfd_w, h: e.pfd_h,
    status: e.status,
    remaining_life_yr: e.remaining_life_yr
  }));
  res.json({ canvas: { width: 2800, height: 1400 }, equipment: layout });
});

// ═══════════════════════════════════════════════════════════
//  404 fallback
// ═══════════════════════════════════════════════════════════
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Start ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🔧 Corrosion Mapping API`);
  console.log(`   Port   : ${PORT}`);
  console.log(`   DB     : ${DB_PATH}`);
  console.log(`   Routes : GET/PUT /api/equipment/:tag`);
  console.log(`            GET/PUT /api/lines/:id`);
  console.log(`            GET     /api/summary`);
  console.log(`            GET     /api/history`);
  console.log(`            GET     /api/pfd\n`);
});
