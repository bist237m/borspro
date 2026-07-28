// api/src/routes/sectors.js
// Sektörler modülü — TÜMÜYLE mevcut verilerden (stocks + stock_quotes +
// fundamentals_snapshots) beslenir, worker'a yeni bir iş eklemez.

import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/sectors/overview
// Her sektör için: hisse sayısı, ort. günlük değişim, toplam piyasa değeri,
// ort. F/K (aşırı uçlar hariç), yabancı takas 1 haftalık ort. değişim,
// günün lideri ve en zayıfı.
router.get("/overview", authenticate, async (_req, res, next) => {
  try {
    const { rows } = await query(
      `
      WITH base AS (
        SELECT s.sector, s.symbol, s.name,
               q.change_pct, f.market_cap, f.pe_ratio, f.foreign_ratio_1w_change
        FROM stocks s
        LEFT JOIN stock_quotes q ON q.stock_id = s.id
        LEFT JOIN fundamentals_snapshots f ON f.stock_id = s.id
        WHERE s.is_active = TRUE AND s.sector IS NOT NULL
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY sector ORDER BY change_pct DESC NULLS LAST) AS rn_top,
          ROW_NUMBER() OVER (PARTITION BY sector ORDER BY change_pct ASC  NULLS LAST) AS rn_bottom
        FROM base
      )
      SELECT
        b.sector,
        COUNT(*)::int AS stock_count,
        ROUND(AVG(b.change_pct)::numeric, 2) AS avg_change_pct,
        SUM(b.market_cap) AS total_market_cap,
        ROUND(AVG(b.pe_ratio) FILTER (WHERE b.pe_ratio > 0 AND b.pe_ratio < 150)::numeric, 2) AS avg_pe,
        ROUND(AVG(b.foreign_ratio_1w_change)::numeric, 3) AS avg_foreign_1w_change,
        MAX(t.symbol)     AS top_symbol,
        MAX(t.change_pct) AS top_change_pct,
        MAX(w.symbol)     AS worst_symbol,
        MAX(w.change_pct) AS worst_change_pct
      FROM base b
      LEFT JOIN ranked t ON t.sector = b.sector AND t.rn_top = 1
      LEFT JOIN ranked w ON w.sector = b.sector AND w.rn_bottom = 1
      GROUP BY b.sector
      ORDER BY avg_change_pct DESC NULLS LAST
      `
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/sectors/:sector/stocks — bir sektördeki hisselerin detay listesi
router.get("/:sector/stocks", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `
      SELECT s.symbol, s.name, q.price, q.change_pct, q.volume,
             f.market_cap, f.pe_ratio, f.pb_ratio,
             f.foreign_ratio, f.foreign_ratio_1w_change, f.return_1w, f.return_1m
      FROM stocks s
      LEFT JOIN stock_quotes q ON q.stock_id = s.id
      LEFT JOIN fundamentals_snapshots f ON f.stock_id = s.id
      WHERE s.is_active = TRUE AND s.sector = $1
      ORDER BY q.change_pct DESC NULLS LAST
      `,
      [req.params.sector]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
