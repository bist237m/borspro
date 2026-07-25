// src/services/dataFetcher.js
// borsa-api kullanarak tüm BIST hisselerini çeker ve DB'ye yazar.

import BorsaAPI from "borsa-api";
import { query, client as getClient } from "../db.js";

const api = new BorsaAPI();

// ── TÜM BIST HİSSELERİNİ GÜNCELLE ────────────────────────
export async function fetchAndSyncAllStocks() {
  console.log("📡 Tüm BIST hisseleri çekiliyor...");

  // 1. Borsa'daki tüm hisseleri al
  const allSymbols = await api.getAllSymbols();           // THYAO, GARAN, ...
  console.log(`   ${allSymbols.length} hisse bulundu`);

  let updated = 0, inserted = 0, errors = 0;

  for (const symbol of allSymbols) {
    try {
      const data = await api.getStock(symbol);
      if (!data?.price) continue;

      // stocks tablosuna upsert
      await query(
        `INSERT INTO stocks (symbol, name, exchange, sector, currency, market_cap, shares_out)
         VALUES ($1, $2, 'BIST', $3, 'TRY', $4, $5)
         ON CONFLICT (symbol) DO UPDATE SET
           name       = EXCLUDED.name,
           sector     = COALESCE(EXCLUDED.sector, stocks.sector),
           market_cap = EXCLUDED.market_cap,
           shares_out = EXCLUDED.shares_out,
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [
          symbol,
          data.name        || symbol,
          data.sector      || null,
          data.marketCap   || null,
          data.sharesOut   || null,
        ]
      );

      // stock_quotes tablosuna upsert (anlık fiyat)
      await query(
        `INSERT INTO stock_quotes (stock_id, price, change_abs, change_pct, day_high, day_low, volume, quoted_at)
         SELECT id, $2, $3, $4, $5, $6, $7, NOW()
         FROM stocks WHERE symbol = $1
         ON CONFLICT (stock_id) DO UPDATE SET
           price      = EXCLUDED.price,
           change_abs = EXCLUDED.change_abs,
           change_pct = EXCLUDED.change_pct,
           day_high   = EXCLUDED.day_high,
           day_low    = EXCLUDED.day_low,
           volume     = EXCLUDED.volume,
           quoted_at  = NOW()`,
        [
          symbol,
          data.price       || 0,
          data.change      || 0,
          data.changePercent || 0,
          data.high        || 0,
          data.low         || 0,
          data.volume      || 0,
        ]
      );

      updated++;
    } catch (err) {
      errors++;
      console.error(`   ❌ ${symbol}: ${err.message}`);
    }
  }

  console.log(`   ✅ Güncellenen: ${updated} | Hata: ${errors}`);
  return { updated, errors };
}

// ── GEÇMİŞ FİYAT VERİSİ DOLDUR ───────────────────────────
export async function fetchPriceHistory(symbol, period = "1y") {
  const stock = await query(
    "SELECT id FROM stocks WHERE symbol = $1",
    [symbol]
  );
  if (!stock.rows[0]) throw new Error(`Hisse bulunamadı: ${symbol}`);
  const stockId = stock.rows[0].id;

  const history = await api.getHistoricalData(symbol, period);
  if (!history?.length) return 0;

  const db = await getClient();
  try {
    await db.query("BEGIN");
    let count = 0;
    for (const bar of history) {
      await db.query(
        `INSERT INTO price_history (stock_id, price_date, open, high, low, close, volume)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (stock_id, price_date) DO UPDATE SET
           open   = EXCLUDED.open,
           high   = EXCLUDED.high,
           low    = EXCLUDED.low,
           close  = EXCLUDED.close,
           volume = EXCLUDED.volume`,
        [stockId, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume]
      );
      count++;
    }
    await db.query("COMMIT");
    return count;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

// ── TÜM AKTİF HİSSELERİN GEÇMİŞİNİ DOLDUR ───────────────
export async function fetchAllHistory(period = "1y") {
  const { rows } = await query(
    "SELECT symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol"
  );
  console.log(`📅 ${rows.length} hisse için geçmiş veri çekiliyor...`);

  let total = 0, errors = 0;
  for (const { symbol } of rows) {
    try {
      const count = await fetchPriceHistory(symbol, period);
      total += count;
      console.log(`   ✅ ${symbol}: ${count} bar`);
    } catch (err) {
      errors++;
      console.error(`   ❌ ${symbol}: ${err.message}`);
    }
    // Rate limiting — API'yi yormamak için kısa bekleme
    await sleep(200);
  }

  console.log(`   Toplam: ${total} bar | Hata: ${errors}`);
  return { total, errors };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
