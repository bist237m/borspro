import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/signals/tracked — filtreye giren (takip edilen) tüm hisseler
router.get("/tracked", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ts.*, s.symbol, s.name
       FROM tracked_signals ts
       JOIN stocks s ON s.id = ts.stock_id
       WHERE ts.is_active = TRUE
       ORDER BY ts.updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/signals/performance — her filtrenin geçmiş isabet oranı + hisse bazlı detay
router.get("/performance", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         unnest(string_to_array(ts.filter_types, ',')) AS filter_code,
         s.symbol, s.name,
         ts.change_pct, ts.entry_date,
         ts.realized_price, ts.realized_pct,
         ts.milestone_5_at, ts.milestone_10_at, ts.milestone_20_at, ts.milestone_30_at
       FROM tracked_signals ts
       JOIN stocks s ON s.id = ts.stock_id
       ORDER BY ts.entry_date DESC`
    );

    const daysBetween = (a, b) => a && b ? Math.round((new Date(a) - new Date(b)) / 86400000) : null;
    // %10'a ilk ulaşıldığı anda dondurulan getiri varsa ONU, yoksa anlık
    // change_pct'i kullan — "%10'da kâr realize ettim" varsayımıyla raporlama.
    const effectivePct = (i) => i.realized_pct != null ? Number(i.realized_pct) : Number(i.change_pct || 0);

    const grouped = {};
    for (const row of rows) {
      const code = row.filter_code;
      if (!grouped[code]) grouped[code] = [];
      grouped[code].push({
        ...row,
        days_to_5:  daysBetween(row.milestone_5_at,  row.entry_date),
        days_to_10: daysBetween(row.milestone_10_at, row.entry_date),
        days_to_20: daysBetween(row.milestone_20_at, row.entry_date),
        days_to_30: daysBetween(row.milestone_30_at, row.entry_date),
      });
    }

    const result = Object.entries(grouped).map(([code, items]) => {
      const total = items.length;
      const winners = items.filter(i => effectivePct(i) > 0).length;
      const avgChange = items.reduce((s, i) => s + effectivePct(i), 0) / total;

      const avgOf = (field) => {
        const vals = items.filter(i => i[field] != null).map(i => i[field]);
        return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
      };

      // %10'a ulaşanlar arasında sonradan %20/%30'a da devam edenlerin oranı
      // ("%10'da çıksam ne kaçırmış olurdum?" sorusunun cevabı)
      const reached10Items = items.filter(i => i.milestone_10_at);
      const from10To20 = reached10Items.filter(i => i.milestone_20_at).length;
      const from10To30 = reached10Items.filter(i => i.milestone_30_at).length;

      return {
        filter_code: code,
        total,
        win_rate: total > 0 ? Math.round((winners / total) * 100) : 0,
        avg_change_pct: Math.round(avgChange * 100) / 100,
        avg_days_to_5:  avgOf("days_to_5"),
        avg_days_to_10: avgOf("days_to_10"),
        avg_days_to_20: avgOf("days_to_20"),
        avg_days_to_30: avgOf("days_to_30"),
        reached_5:  items.filter(i => i.milestone_5_at).length,
        reached_10: items.filter(i => i.milestone_10_at).length,
        reached_20: items.filter(i => i.milestone_20_at).length,
        reached_30: items.filter(i => i.milestone_30_at).length,
        // Koşullu devam oranları: %10'u görenlerin kaçı %20/%30'a devam etti
        continuation_10_to_20_pct: reached10Items.length
          ? Math.round((from10To20 / reached10Items.length) * 100) : null,
        continuation_10_to_30_pct: reached10Items.length
          ? Math.round((from10To30 / reached10Items.length) * 100) : null,
        items: items.map(i => ({
          symbol: i.symbol,
          name: i.name,
          entry_date: i.entry_date,
          change_pct: i.change_pct,
          realized_pct: i.realized_pct,
          is_realized: i.realized_pct != null,
          days_to_5: i.days_to_5,
          days_to_10: i.days_to_10,
          days_to_20: i.days_to_20,
          days_to_30: i.days_to_30,
        })),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/signals/extra-tracked — ek filtreleri (Filtre 5/6) sağlayan hisseler
// + tracked_signals'tan giriş tarihi / milestone gün sayısı (diğer filtrelerle aynı takip mantığı)
router.get("/extra-tracked", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT efr.filter_code, efr.timeframe, efr.updated_at,
              s.id AS stock_id, s.symbol, s.name
       FROM extra_filter_results efr
       JOIN stocks s ON s.id = efr.stock_id
       WHERE efr.result = TRUE
       ORDER BY efr.filter_code, efr.timeframe, s.symbol`
    );

    if (!rows.length) return res.json([]);

    const stockIds = [...new Set(rows.map(r => r.stock_id))];
    const { rows: trackedRows } = await query(
      `SELECT stock_id, filter_types, change_pct, entry_date,
              milestone_5_at, milestone_10_at, milestone_20_at, milestone_30_at
       FROM tracked_signals
       WHERE is_active = TRUE AND stock_id = ANY($1::uuid[])`,
      [stockIds]
    );
    const trackingByStock = {};
    for (const t of trackedRows) trackingByStock[t.stock_id] = t;

    // extra_filter_results timeframe küçük harf tutuyor (4h,1d,1wk,2h,30m),
    // tracked_signals.filter_types ise büyük harf sonek kullanıyor (_4H,_1D,...)
    const TF_SUFFIX = { "4h": "4H", "1d": "1D", "1wk": "1WK", "2h": "2H", "30m": "30M" };
    const daysBetween = (a, b) => a && b ? Math.round((new Date(a) - new Date(b)) / 86400000) : null;

    const grouped = {};
    for (const row of rows) {
      const key = `${row.filter_code}|${row.timeframe}`;
      if (!grouped[key]) {
        grouped[key] = { filter_code: row.filter_code, timeframe: row.timeframe, stocks: [] };
      }

      const combinedCode = `${row.filter_code}_${TF_SUFFIX[row.timeframe] || row.timeframe.toUpperCase()}`;
      const t = trackingByStock[row.stock_id];
      const matches = t?.filter_types && t.filter_types.split(",").includes(combinedCode);

      grouped[key].stocks.push({
        symbol: row.symbol,
        name: row.name,
        updated_at: row.updated_at,
        entry_date:  matches ? t.entry_date : null,
        change_pct:  matches ? t.change_pct : null,
        days_to_5:   matches ? daysBetween(t.milestone_5_at,  t.entry_date) : null,
        days_to_10:  matches ? daysBetween(t.milestone_10_at, t.entry_date) : null,
        days_to_20:  matches ? daysBetween(t.milestone_20_at, t.entry_date) : null,
        days_to_30:  matches ? daysBetween(t.milestone_30_at, t.entry_date) : null,
      });
    }

    res.json(Object.values(grouped));
  } catch (err) {
    next(err);
  }
});

export default router;