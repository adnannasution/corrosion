# Corrosion Mapping API
**Crude Distillation Unit — Process Unit 11**

REST API berbasis Node.js + Express dengan JSON file database.  
Siap deploy ke **Railway** (gratis, tanpa konfigurasi tambahan).

---

## 🚀 Deploy ke Railway

### Cara 1 — Via GitHub (Recommended)
```bash
# 1. Buat repo baru di GitHub, lalu push folder ini
git init
git add .
git commit -m "initial: corrosion mapping api"
git remote add origin https://github.com/USERNAME/corrosion-api.git
git push -u origin main

# 2. Buka https://railway.app → New Project → Deploy from GitHub Repo
# 3. Pilih repo → Railway otomatis detect Node.js dan deploy
# 4. URL API tersedia di tab Settings → Domains
```

### Cara 2 — Via Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

---

## 📁 Struktur File

```
corrosion-api/
├── server.js          # Main API server
├── package.json       # Dependencies
├── railway.json       # Railway config
├── data/
│   └── db.json        # Database JSON (72 equipment, 10 lines)
└── README.md
```

---

## 🔌 API Endpoints

### Health
| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/` | Info API + counts |
| GET | `/health` | Status check |

### Equipment (72 items)
| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/api/equipment` | List semua equipment |
| GET | `/api/equipment?status=critical` | Filter by status |
| GET | `/api/equipment?type=column` | Filter by type |
| GET | `/api/equipment/:tag` | Detail satu equipment |
| PUT | `/api/equipment/:tag` | Update data inspeksi |
| POST | `/api/equipment/bulk` | Update banyak sekaligus |

### Lines (10 line numbers)
| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/api/lines` | List semua line |
| GET | `/api/lines/:id` | Detail satu line |
| PUT | `/api/lines/:id` | Update data inspeksi |
| POST | `/api/lines/bulk` | Update banyak sekaligus |

### Dashboard
| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/api/summary` | Summary + critical items |
| GET | `/api/history` | Riwayat inspeksi |
| GET | `/api/history?tag=C-101` | Riwayat satu tag |
| GET | `/api/pfd` | Layout PFD (posisi x,y semua equipment) |

### Settings
| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/api/settings` | Semua settings |
| PUT | `/api/settings/:key` | Update satu setting |

---

## 📝 Contoh Request

### Update inspeksi C-101
```bash
curl -X PUT https://your-api.railway.app/api/equipment/C-101 \
  -H "Content-Type: application/json" \
  -d '{
    "measured_thickness": 21.5,
    "corrosion_rate": 0.42,
    "last_inspection_date": "2025-03-01",
    "notes": "Inspeksi rutin Q1 2025"
  }'
```

### Bulk update beberapa equipment sekaligus
```bash
curl -X POST https://your-api.railway.app/api/equipment/bulk \
  -H "Content-Type: application/json" \
  -d '[
    { "tag": "C-101", "measured_thickness": 21.5, "corrosion_rate": 0.42 },
    { "tag": "V-102", "measured_thickness": 10.8, "corrosion_rate": 0.50 },
    { "tag": "E-110A", "measured_thickness": 6.5, "corrosion_rate": 0.60 }
  ]'
```

### Get summary dashboard
```bash
curl https://your-api.railway.app/api/summary
```

Response:
```json
{
  "total": 82,
  "good": 45,
  "monitor": 18,
  "warning": 12,
  "critical": 3,
  "unknown": 4,
  "critical_items": [
    { "tag": "V-101A", "name": "Desalter A", "remaining_life_yr": 1.3 }
  ]
}
```

---

## 📊 Status Klasifikasi

| Status | Remaining Life |
|--------|---------------|
| 🟢 good | > 10 tahun |
| 🟡 monitor | 5 – 10 tahun |
| 🟠 warning | 2 – 5 tahun |
| 🔴 critical | < 2 tahun |
| ⚫ unknown | Data belum diisi |

---

## 🔧 Tipe Equipment

`column`, `vessel-h`, `vessel-v`, `hex`, `air-cooler`, `pump`, `furnace`

---

## ⚙️ Environment Variables (Opsional)

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `PORT` | `3000` | Port server (Railway set otomatis) |

---

## 📦 Integrasi dengan Frontend

Di file HTML corrosion mapping, ubah konstanta API_URL:
```javascript
const API_URL = 'https://your-api.railway.app';

// Load data dari API
const res = await fetch(`${API_URL}/api/equipment`);
const { data } = await res.json();
```
