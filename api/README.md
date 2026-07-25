# Borsa Pro — Backend API

Node.js + Express + PostgreSQL + JWT

---

## Kurulum

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. Ortam değişkenlerini ayarla
cp .env.example .env
# .env dosyasını düzenle (DB bilgileri, JWT_SECRET vb.)

# 3. Veritabanını oluştur (schema.sql dosyasını çalıştır)
psql -U postgres -c "CREATE DATABASE borsa_pro"
psql -U postgres -d borsa_pro -f schema.sql

# 4. Geliştirme modunda başlat
npm run dev

# 5. Üretimde başlat
npm start
```

---

## Endpoint Listesi

### 🔐 Auth  `/api/auth`
| Metod | Yol         | Açıklama          | Auth |
|-------|-------------|-------------------|------|
| POST  | /register   | Yeni kullanıcı    | —    |
| POST  | /login      | Giriş → token     | —    |
| GET   | /me         | Profil bilgisi    | ✅   |

### 📈 Hisseler  `/api/stocks`
| Metod | Yol                      | Açıklama                          | Auth |
|-------|--------------------------|-----------------------------------|------|
| GET   | /                        | Tüm hisseler (filtre: exchange, sector, search) | ✅ |
| GET   | /:symbol                 | Tek hisse detayı + anlık fiyat   | ✅   |
| GET   | /:symbol/history?period= | Fiyat geçmişi (1m/3m/6m/1y/all)  | ✅   |

### 💼 Portföyler  `/api/portfolios`
| Metod  | Yol                        | Açıklama                  | Auth |
|--------|----------------------------|---------------------------|------|
| GET    | /                          | Portföy listesi           | ✅   |
| POST   | /                          | Yeni portföy              | ✅   |
| DELETE | /:id                       | Portföy sil               | ✅   |
| GET    | /:id/positions             | Pozisyonlar + K/Z         | ✅   |
| GET    | /:id/transactions          | İşlem geçmişi             | ✅   |
| POST   | /:id/transactions          | Alım/Satım işlemi ekle    | ✅   |

### 👁 İzleme Listeleri  `/api/watchlists`
| Metod  | Yol               | Açıklama              | Auth |
|--------|-------------------|-----------------------|------|
| GET    | /                 | Tüm listeler          | ✅   |
| GET    | /:id/items        | Hisseler + fiyatlar   | ✅   |
| POST   | /:id/items        | Hisse ekle            | ✅   |
| DELETE | /:id/items/:itemId| Hisse çıkar           | ✅   |

### 🔔 Uyarılar  `/api/alerts`
| Metod  | Yol  | Açıklama        | Auth |
|--------|------|-----------------|------|
| GET    | /    | Uyarı listesi   | ✅   |
| POST   | /    | Yeni uyarı      | ✅   |
| DELETE | /:id | Uyarı sil       | ✅   |

### 📰 Haberler  `/api/news`
| Metod | Yol              | Açıklama                          | Auth |
|-------|------------------|-----------------------------------|------|
| GET   | /?symbol=&limit= | Haberler (hisseye göre filtrele)  | ✅   |

### 🗓 Ekonomik Takvim  `/api/calendar`
| Metod | Yol                      | Açıklama                        | Auth |
|-------|--------------------------|---------------------------------|------|
| GET   | /?country=&impact=       | Ekonomik olaylar                | ✅   |

### ❤️ Sağlık  
| Metod | Yol     | Açıklama              |
|-------|---------|-----------------------|
| GET   | /health | DB bağlantı kontrolü  |

---

## İstek Örnekleri

```bash
# Kayıt
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"sifre123","full_name":"Test Kullanıcı"}'

# Giriş
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"sifre123"}'

# Hisse listesi (token ile)
curl http://localhost:3001/api/stocks \
  -H "Authorization: Bearer <TOKEN>"

# Alım işlemi
curl -X POST http://localhost:3001/api/portfolios/<PORT_ID>/transactions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"stock_id":"<STOCK_UUID>","type":"buy","quantity":100,"price":312.40}'
```
