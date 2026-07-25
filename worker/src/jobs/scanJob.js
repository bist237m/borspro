// src/jobs/scanJob.js
// Artık bir Bull "processor" değil, doğrudan çağrılan bir fonksiyon.
// GitHub Actions bunu tek seferlik çalıştırıp bitirir.

import { query, client as getClient }                from "../db.js";
import { detectAllSignals, buildComment, calcScore } from "../services/technicals.js";

// ── YARDIMCI ──────────────────────────────────────────────

async function getPriceHistory(stockId) {
  const { rows } = await query(
    `SELECT price_date, open, high, low, close, volume
     FROM price_history
     WHERE stock_id = $1
     ORDER BY price_date ASC
     LIMIT 300`,
    [stockId]
  );
  return rows;
}

async function saveSignal(stockId, signals, score) {
  if (!signals.length) return null;
  const { rows } = await query(
    `INSERT INTO signals (stock_id, signal_types, direction, score, comment, scanned_at, scan_date)
     VALUES ($1, $2, $3, $4, $5, NOW(), CURRENT_DATE)
     ON CONFLICT (stock_id, scan_date) DO UPDATE SET
       signal_types = EXCLUDED.signal_types,
       direction    = EXCLUDED.direction,
       score        = EXCLUDED.score,
       comment      = EXCLUDED.comment,
       scanned_at   = NOW()
     RETURNING id`,
    [
      stockId,
      signals.map(s => s.type).join(","),
      signals[0].dir,
      score,
      buildComment(signals),
    ]
  );
  return rows[0]?.id;
}

async function addToWatchlists(stockId, comment, signalId) {
  await query(
    `INSERT INTO watchlist_items (watchlist_id, stock_id, auto_comment, signal_id, added_at)
     SELECT w.id, $1, $2, $3, NOW()
     FROM watchlists w
     WHERE w.is_default = TRUE
     ON CONFLICT (watchlist_id, stock_id) DO UPDATE SET
       auto_comment = EXCLUDED.auto_comment,
       signal_id    = EXCLUDED.signal_id,
       updated_at   = NOW()`,
    [stockId, comment, signalId]
  );
}

// ── TEK HİSSE TARA ────────────────────────────────────────
async function scanOne(stock) {
  const bars = await getPriceHistory(stock.id);
  if (bars.length < 50) return { symbol: stock.symbol, status: "skip", reason: "yetersiz veri" };

  const { signals } = detectAllSignals(bars);
  if (!signals.length) return { symbol: stock.symbol, status: "no_signal" };

  const score    = calcScore(signals);
  const comment  = buildComment(signals);
  const signalId = await saveSignal(stock.id, signals, score);

  await addToWatchlists(stock.id, comment, signalId);

  return {
    symbol:  stock.symbol,
    status:  "signal",
    signals: signals.map(s => s.type),
    score,
  };
}

// ── TAM TARAMA — artık düz bir async fonksiyon ─────────────
// Eskiden scanQueue.process("full_scan", ...) idi.
// Şimdi worker/src/index.js bunu doğrudan çağırıyor.
export async function runFullScan() {
  console.log(`\n🔍 [${new Date().toLocaleTimeString("tr-TR")}] Tam tarama başladı`);

  const { rows: stocks } = await query(
    "SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol"
  );

  console.log(`   ${stocks.length} hisse taranacak`);

  const results = { total: stocks.length, signals: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < stocks.length; i++) {
    try {
      const res = await scanOne(stocks[i]);
      if (res.status === "signal")    results.signals++;
      else if (res.status === "skip") results.skipped++;
    } catch (err) {
      results.errors++;
      console.error(`   ❌ ${stocks[i].symbol}: ${err.message}`);
    }
    if (i % 10 === 0) {
      console.log(`   ${i}/${stocks.length} tamamlandı...`);
    }
  }

  console.log(`\n✅ Tarama tamamlandı:`, results);
  return results;
}