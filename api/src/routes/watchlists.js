import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/watchlists
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT w.*, COUNT(wi.id) AS item_count
       FROM watchlists w
       LEFT JOIN watchlist_items wi ON wi.watchlist_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.is_default DESC, w.created_at`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/watchlists/:id/items  — hisseler + anlık fiyat
router.get("/:id/items", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT wi.id, wi.sort_order, wi.added_at,
              s.id AS stock_id, s.symbol, s.name, s.sector,
              q.price, q.change_abs, q.change_pct, q.day_high, q.day_low, q.volume
       FROM watchlist_items wi
       JOIN watchlists w ON w.id = wi.watchlist_id
       JOIN stocks s ON s.id = wi.stock_id
       LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE wi.watchlist_id = $1 AND w.user_id = $2
       ORDER BY wi.sort_order, wi.added_at`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/watchlists/:id/items  — hisse ekle
router.post("/:id/items", authenticate, async (req, res, next) => {
  try {
    const { stock_id } = req.body;
    if (!stock_id) return res.status(400).json({ error: "stock_id zorunludur." });

    // Liste bu kullanıcıya ait mi?
    const { rows: wRows } = await query(
      "SELECT id FROM watchlists WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    if (!wRows[0]) return res.status(404).json({ error: "Liste bulunamadı." });

    const { rows } = await query(
      `INSERT INTO watchlist_items (watchlist_id, stock_id)
       VALUES ($1, $2) RETURNING *`,
      [req.params.id, stock_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/watchlists/:id/items/:itemId  — hisse çıkar
router.delete("/:id/items/:itemId", authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM watchlist_items wi
       USING watchlists w
       WHERE wi.id = $1
         AND wi.watchlist_id = w.id
         AND w.user_id = $2`,
      [req.params.itemId, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Öğe bulunamadı." });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
