const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const db = new DatabaseSync('bali.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    maps_url TEXT,
    lat REAL,
    lng REAL,
    price TEXT,
    images TEXT DEFAULT '[]',
    tickets TEXT DEFAULT '[]',
    custom_category TEXT,
    added_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add price/tickets columns if they don't exist yet
try { db.exec(`ALTER TABLE places ADD COLUMN price TEXT`); } catch {}
try { db.exec(`ALTER TABLE places ADD COLUMN tickets TEXT DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE places ADD COLUMN custom_category TEXT`); } catch {}
try { db.exec(`ALTER TABLE places ADD COLUMN visit_date TEXT`); } catch {}
try { db.exec(`ALTER TABLE places ADD COLUMN website TEXT`); } catch {}

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Resolve shortened Google Maps URL and extract coordinates
async function resolveCoords(url) {
  if (!url) return null;
  try {
    // Follow redirects to get the final URL
    let finalUrl = url;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(finalUrl, { method: 'HEAD', redirect: 'manual' });
      const loc = res.headers.get('location');
      if (!loc) break;
      finalUrl = loc.startsWith('http') ? loc : new URL(loc, finalUrl).href;
    }
    return extractCoords(finalUrl);
  } catch { return null; }
}

function extractCoords(url) {
  let m;
  // !3d!4d is the actual pin location — always prefer over map-view center
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // q=lat,lng (direct coordinate search)
  m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // ll=lat,lng
  m = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  // @lat,lng,zoom — map view center, least precise, last resort
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),\d+/);
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

// Endpoint: resolve a Maps URL → coords
app.post('/api/resolve-url', async (req, res) => {
  const { url } = req.body;
  const coords = extractCoords(url) || await resolveCoords(url);
  res.json(coords || {});
});

const parsePlace = p => ({
  ...p,
  images: JSON.parse(p.images || '[]'),
  tickets: JSON.parse(p.tickets || '[]'),
});

app.get('/api/places', (req, res) => {
  const places = db.prepare('SELECT * FROM places ORDER BY created_at DESC').all();
  res.json(places.map(parsePlace));
});

app.post('/api/places', (req, res) => {
  const { name, category, description, maps_url, lat, lng, price, custom_category, visit_date, website, added_by } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Name and category required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO places (id, name, category, description, maps_url, lat, lng, price, custom_category, visit_date, website, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, category, description || '', maps_url || '', lat || null, lng || null, price || '', custom_category || null, visit_date || null, website || '', added_by || 'Anonimno');
  res.json(parsePlace(db.prepare('SELECT * FROM places WHERE id = ?').get(id)));
});

// Upload images
app.post('/api/places/:id/images', (req, res) => {
  upload.array('images', 20)(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    const place = db.prepare('SELECT * FROM places WHERE id = ?').get(req.params.id);
    if (!place) return res.status(404).json({ error: 'Not found' });
    const existing = JSON.parse(place.images || '[]');
    const added = (req.files || []).map(f => '/uploads/' + f.filename);
    const all = [...existing, ...added];
    db.prepare('UPDATE places SET images = ? WHERE id = ?').run(JSON.stringify(all), req.params.id);
    res.json({ images: all });
  });
});

// Upload tickets
app.post('/api/places/:id/tickets', (req, res) => {
  upload.array('tickets', 20)(req, res, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    const place = db.prepare('SELECT * FROM places WHERE id = ?').get(req.params.id);
    if (!place) return res.status(404).json({ error: 'Not found' });
    const existing = JSON.parse(place.tickets || '[]');
    const added = (req.files || []).map(f => ({ name: f.originalname, url: '/uploads/' + f.filename }));
    const all = [...existing, ...added];
    db.prepare('UPDATE places SET tickets = ? WHERE id = ?').run(JSON.stringify(all), req.params.id);
    res.json({ tickets: all });
  });
});

app.delete('/api/places/:id', (req, res) => {
  db.prepare('DELETE FROM places WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.put('/api/places/:id', (req, res) => {
  const { name, category, description, maps_url, lat, lng, price, custom_category, visit_date, website } = req.body;
  db.prepare(`UPDATE places SET name=?, category=?, description=?, maps_url=?, lat=?, lng=?, price=?, custom_category=?, visit_date=?, website=? WHERE id=?`)
    .run(name, category, description, maps_url, lat, lng, price || '', custom_category || null, visit_date || null, website || '', req.params.id);
  res.json(parsePlace(db.prepare('SELECT * FROM places WHERE id = ?').get(req.params.id)));
});

app.listen(PORT, () => {
  console.log(`\n🌴 Bali Trip Planner tece na http://localhost:${PORT}\n`);
});
