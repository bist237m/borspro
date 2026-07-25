# 🚀 Borsa Pro — Deployment Rehberi
## Frontend → Vercel | Backend + Worker → Railway | DB → Supabase

---

## 1. Supabase (Veritabanı)

1. https://supabase.com → Yeni proje oluştur
2. **SQL Editor** → `schema.sql` dosyasını çalıştır
3. **SQL Editor** → `scanner/migration_signals.sql` dosyasını çalıştır
4. **Settings → Database** → Connection string'i kopyala
   ```
   postgresql://postgres:[SIFRE]@db.[PROJE].supabase.co:5432/postgres
   ```

---

## 2. Railway (Backend API + Worker + Redis)

### Adım 1: Redis ekle
1. https://railway.app → Yeni proje
2. **+ New** → **Redis** → deploy et
3. Redis servisinin **REDIS_URL**'ini kopyala

### Adım 2: API servisini deploy et
1. **+ New** → **GitHub Repo** → `api/` klasörünü seç
   (ya da monorepo ise root dir = `api` seç)
2. **Variables** sekmesine ekle:
   ```
   DATABASE_URL = [Supabase connection string]
   JWT_SECRET   = [güçlü rastgele string — min 32 karakter]
   CLIENT_URL   = https://[proje-adiniz].vercel.app
   REDIS_URL    = [Railway Redis URL]
   PORT         = 3001
   NODE_ENV     = production
   ```
3. Deploy tamamlanınca domain'i kopyala:
   `https://borsa-pro-api-xxxx.railway.app`

### Adım 3: Worker servisini deploy et
1. **+ New** → **GitHub Repo** → `worker/` klasörünü seç
2. **Variables** sekmesine ekle:
   ```
   DATABASE_URL = [Supabase connection string]
   REDIS_URL    = [Railway Redis URL]
   NODE_ENV     = production
   ```
3. Deploy et → Worker otomatik başlar ve 17:25'i bekler

### Adım 4: İlk veri yükleme (önemli!)
Railway'de Worker servisinin terminaline:
```bash
# Önce geçmiş veriyi yükle (1 saat sürebilir)
node src/index.js --history

# Sonra anlık fiyatları güncelle
node src/index.js --sync
```

---

## 3. Vercel (Frontend)

1. https://vercel.com → **Import Git Repository** → `frontend/` klasörünü seç
2. **Framework Preset**: Vite
3. **Environment Variables** ekle:
   ```
   VITE_API_URL = https://borsa-pro-api-xxxx.railway.app
   ```
4. **Deploy** → URL'yi al

### Son adım: API'nin CORS'unu güncelle
Railway API servisine dön, şunu ekle:
```
CLIENT_URL = https://[proje-adiniz].vercel.app
```

---

## 4. Deployment Sonrası Test

```bash
# API sağlık kontrolü
curl https://borsa-pro-api-xxxx.railway.app/health

# Kayıt ol
curl -X POST https://borsa-pro-api-xxxx.railway.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"sifre123","full_name":"Test"}'

# Manuel tarama başlat (token ile)
curl -X POST https://borsa-pro-api-xxxx.railway.app/api/jobs/scan \
  -H "Authorization: Bearer [TOKEN]"
```

---

## Mimari Özeti

```
Kullanıcı
   │
   ▼
Vercel (Frontend — React)
   │ HTTPS API istekleri
   ▼
Railway API (Express + JWT)
   │                    │
   │ Job ekle           │ DB sorguları
   ▼                    ▼
Railway Redis     Supabase PostgreSQL
   │                    ▲
   │ Job çek            │ Sonuç yaz
   ▼                    │
Railway Worker ──────────
  ├─ borsa-api (fiyat çek)
  ├─ RSI / MACD / IFT hesapla
  ├─ Sinyal tespit et
  └─ 17:25 TRT otomatik çalış
```

---

## Maliyet (Ücretsiz Plan Limitleri)

| Servis   | Plan    | Limit                        |
|----------|---------|------------------------------|
| Supabase | Free    | 500MB DB, 2GB bant genişliği |
| Railway  | Hobby   | $5/ay kredi (genelde yeterli)|
| Vercel   | Free    | 100GB bant, sınırsız deploy  |
| Redis    | Railway | Hobby plan ile gelir         |

> Tüm BIST hisselerini taramak (~500 hisse) için Railway Hobby plan yeterlidir.
