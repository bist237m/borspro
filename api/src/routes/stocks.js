import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/stocks  — tüm aktif hisseler (+ anlık fiyat)
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { exchange, sector, search } = req.query;
    const params = [];
    const where = ["s.is_active = TRUE"];

    if (exchange) { params.push(exchange);  where.push(`s.exchange = $${params.length}`); }
    if (sector)   { params.push(sector);    where.push(`s.sector = $${params.length}`); }
    if (search)   { params.push(`%${search}%`); where.push(`(s.symbol ILIKE $${params.length} OR s.name ILIKE $${params.length})`); }

    const { rows } = await query(
      `SELECT s.id, s.symbol, s.name, s.exchange, s.sector, s.currency,
              q.price, q.change_abs, q.change_pct, q.volume, q.quoted_at
       FROM stocks s
       LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE ${where.join(" AND ")}
       ORDER BY s.symbol`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/:symbol  — tek hisse detayı
router.get("/:symbol", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*, q.price, q.change_abs, q.change_pct,
              q.bid, q.ask, q.day_high, q.day_low, q.volume, q.quoted_at
       FROM stocks s
       LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE s.symbol = $1 AND s.is_active = TRUE`,
      [req.params.symbol.toUpperCase()]
    );
    if (!rows[0]) return res.status(404).json({ error: "Hisse bulunamadı." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/:symbol/history?period=1m|3m|6m|1y|all
router.get("/:symbol/history", authenticate, async (req, res, next) => {
  try {
    const period = req.query.period || "3m";
    const intervalMap = { "1m":"1 month","3m":"3 months","6m":"6 months","1y":"1 year","all":"100 years" };
    const interval = intervalMap[period] || "3 months";

    const { rows } = await query(
      `SELECT ph.price_date, ph.open, ph.high, ph.low, ph.close, ph.adj_close, ph.volume
       FROM price_history ph
       JOIN stocks s ON s.id = ph.stock_id
       WHERE s.symbol = $1
         AND ph.price_date >= CURRENT_DATE - INTERVAL '${interval}'
       ORDER BY ph.price_date ASC`,
      [req.params.symbol.toUpperCase()]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
