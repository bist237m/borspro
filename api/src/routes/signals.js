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

export default router;
