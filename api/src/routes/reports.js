import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/reports/tax-summary — yıl bazında gerçekleşen K/Z özeti
router.get("/tax-summary", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT
         EXTRACT(YEAR FROM t.executed_at)::int AS year,
         COUNT(*) AS sell_count,
         SUM(t.realized_pnl) AS total_realized_pnl
       FROM transactions t
       JOIN portfolios p ON p.id = t.portfolio_id
       WHERE p.user_id = $1 AND t.type = 'sell' AND t.realized_pnl IS NOT NULL
       GROUP BY year
       ORDER BY year DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
