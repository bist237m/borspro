import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

// ── UYARILAR ───────────────────────────────────────────────
export const alertsRouter = Router();

// GET /api/alerts
alertsRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, s.symbol, s.name
       FROM alerts a
       JOIN stocks s ON s.id = a.stock_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/alerts
alertsRouter.post("/", authenticate, async (req, res, next) => {
  try {
    const { stock_id, condition, threshold } = req.body;
    if (!stock_id || !condition || threshold == null) {
      return res.status(400).json({ error: "stock_id, condition ve threshold zorunludur." });
    }
    const { rows } = await query(
      `INSERT INTO alerts (user_id, stock_id, condition, threshold)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, stock_id, condition, threshold]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/alerts/:id
alertsRouter.delete("/:id", authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM alerts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Uyarı bulunamadı." });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── HABERLER ───────────────────────────────────────────────
export const newsRouter = Router();

// GET /api/news?symbol=THYAO&limit=20
newsRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { symbol } = req.query;
    const params = [limit];
    let join = "";
    let where = "";

    if (symbol) {
      params.push(symbol.toUpperCase());
      join  = "JOIN news_stocks ns ON ns.news_id = n.id JOIN stocks s ON s.id = ns.stock_id";
      where = `AND s.symbol = $${params.length}`;
    }

    const { rows } = await query(
      `SELECT DISTINCT n.id, n.title, n.summary, n.source, n.url,
                       n.published_at, n.sentiment
       FROM news n ${join}
       WHERE TRUE ${where}
       ORDER BY n.published_at DESC
       LIMIT $1`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── EKONOMİK TAKVİM ────────────────────────────────────────
export const calendarRouter = Router();

// GET /api/calendar?country=TR&impact=high
calendarRouter.get("/", authenticate, async (req, res, next) => {
  try {
    const { country, impact } = req.query;
    const params = [];
    const where = [];

    if (country) { params.push(country.toUpperCase()); where.push(`country = $${params.length}`); }
    if (impact)  { params.push(impact);                where.push(`impact = $${params.length}`); }

    const { rows } = await query(
      `SELECT * FROM economic_calendar
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY event_at DESC
       LIMIT 50`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});


// ── PİYASA ŞERİDİ ──────────────────────────────────────────
export const marketRouter = Router();

// GET /api/market/ticker — BIST100, USD/TRY, Altın
marketRouter.get("/ticker", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM market_snapshot WHERE id = 1");
    if (!rows[0]) return res.json(null);
    res.json(rows[0]);
  } catch (err) { next(err); }
});