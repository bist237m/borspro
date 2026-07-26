import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/signals/tracked  — filtreye giren (takip edilen) tüm hisseler
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
         ts.milestone_5_at, ts.milestone_10_at, ts.milestone_20_at, ts.milestone_30_at
       FROM tracked_signals ts
       JOIN stocks s ON s.id = ts.stock_id
       ORDER BY ts.entry_date DESC`
    );

    const daysBetween = (a, b) => a && b ? Math.round((new Date(a) - new Date(b)) / 86400000) : null;

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
      const winners = items.filter(i => Number(i.change_pct) > 0).length;
      const avgChange = items.reduce((s, i) => s + Number(i.change_pct || 0), 0) / total;

      const avgOf = (field) => {
        const vals = items.filter(i => i[field] != null).map(i => i[field]);
        return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
      };

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
        items: items.map(i => ({
          symbol: i.symbol,
          name: i.name,
          entry_date: i.entry_date,
          change_pct: i.change_pct,
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

export default router;
