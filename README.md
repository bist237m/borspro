# 🚀 Borsa Pro Analitik

BIST hisse takip ve teknik analiz uygulaması.

## Klasör Yapısı

```
borsa-pro/
├── frontend/        React + Vite (Vercel)
├── api/             Node.js + Express (Railway)
├── worker/          Bull Queue + Scanner (Railway)
├── schema.sql            PostgreSQL şeması
├── migration_signals.sql Sinyal tabloları
├── DEPLOYMENT.md         Canlıya alma rehberi
└── borsa-pro.code-workspace
```

## Hızlı Başlangıç

```bash
# 1. Veritabanı kur (PostgreSQL)
psql -U postgres -c "CREATE DATABASE borsa_pro"
psql -U postgres -d borsa_pro -f schema.sql
psql -U postgres -d borsa_pro -f migration_signals.sql

# 2. API başlat
cd api && cp .env.example .env
npm install && npm run dev

# 3. Worker başlat (ayrı terminal)
cd worker && cp .env.example .env
npm install && npm run dev

# 4. Frontend başlat (ayrı terminal)
cd frontend && npm install && npm run dev
```

## Deployment

DEPLOYMENT.md dosyasına bakın.
