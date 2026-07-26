import { Router } from "express";
import { query, getClient } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// ── PORTFÖYLER ─────────────────────────────────────────────

// GET /api/portfolios
router.get("/", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*,
        COUNT(DISTINCT pos.id) AS position_count,
        COALESCE(SUM(pos.quantity * pos.current_price), 0) AS total_value
       FROM portfolios p
       LEFT JOIN positions pos ON pos.portfolio_id = p.id
       WHERE p.user_id = $1
       GROUP BY p.id
       ORDER BY p.is_default DESC, p.created_at`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolios
router.post("/", authenticate, async (req, res, next) => {
  try {
    const { name, description, currency = "TRY" } = req.body;
    if (!name) return res.status(400).json({ error: "Portföy adı zorunludur." });

    const { rows } = await query(
      `INSERT INTO portfolios (user_id, name, description, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.user.id, name, description, currency]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/portfolios/:id — isim/para birimi güncelle
router.patch("/:id", authenticate, async (req, res, next) => {
  try {
    const { name, currency } = req.body;
    const fields = [];
    const values = [];
    let i = 1;
    if (name)     { fields.push(`name = $${i++}`);     values.push(name); }
    if (currency) { fields.push(`currency = $${i++}`); values.push(currency); }
    if (!fields.length) return res.status(400).json({ error: "Güncellenecek alan yok." });

    values.push(req.params.id, req.user.id);
    const { rows } = await query(
      `UPDATE portfolios SET ${fields.join(", ")}
       WHERE id = $${i} AND user_id = $${i + 1}
       RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: "Portföy bulunamadı." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/portfolios/:id
router.delete("/:id", authenticate, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `DELETE FROM portfolios WHERE id = $1 AND user_id = $2 AND is_default = FALSE`,
      [req.params.id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Portföy bulunamadı veya varsayılan portföy silinemez." });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── POZİSYONLAR ────────────────────────────────────────────

// GET /api/portfolios/:id/positions
router.get("/:id/positions", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pos.*, s.symbol, s.name, s.sector,
              q.price AS current_price,
              q.change_pct,
              (q.price - pos.avg_cost) * pos.quantity AS unrealized_pnl,
              ROUND(((q.price - pos.avg_cost) / pos.avg_cost) * 100, 2) AS unrealized_pct
       FROM positions pos
       JOIN portfolios p ON p.id = pos.portfolio_id
       JOIN stocks s ON s.id = pos.stock_id
       LEFT JOIN stock_quotes q ON q.stock_id = pos.stock_id
       WHERE pos.portfolio_id = $1 AND p.user_id = $2
       ORDER BY s.symbol`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ── İŞLEMLER (hisse alım/satım) ────────────────────────────

// GET /api/portfolios/:id/transactions
router.get("/:id/transactions", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.*, s.symbol, s.name
       FROM transactions t
       JOIN portfolios p ON p.id = t.portfolio_id
       JOIN stocks s ON s.id = t.stock_id
       WHERE t.portfolio_id = $1 AND p.user_id = $2
       ORDER BY t.executed_at DESC
       LIMIT 100`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolios/:id/transactions  — alım/satım işlemi ekle
router.post("/:id/transactions", authenticate, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { stock_id, type, quantity, price, commission = 0, notes, executed_at } = req.body;
    if (!stock_id || !type || !quantity || !price) {
      return res.status(400).json({ error: "stock_id, type, quantity ve price zorunludur." });
    }

    // Portföy bu kullanıcıya ait mi? (FOR UPDATE ile kilitleyip nakit bakiyesini de al)
    const { rows: pRows } = await client.query(
      "SELECT id, cash_balance FROM portfolios WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [req.params.id, req.user.id]
    );
    if (!pRows[0]) return res.status(404).json({ error: "Portföy bulunamadı." });

    const cashBalance = Number(pRows[0].cash_balance);
    const totalCost   = Number(quantity) * Number(price) + Number(commission || 0);

    // ALIM: nakit yetersizse engelle
    if (type === "buy" && cashBalance < totalCost) {
      throw Object.assign(
        new Error(`Yetersiz nakit bakiyesi. Gerekli: ₺${totalCost.toFixed(2)}, mevcut: ₺${cashBalance.toFixed(2)}`),
        { status: 400 }
      );
    }

    // İşlemi kaydet
    const { rows: txRows } = await client.query(
      `INSERT INTO transactions (portfolio_id, stock_id, type, quantity, price, commission, notes, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, stock_id, type, quantity, price, commission, notes, executed_at || new Date()]
    );

    // Pozisyonu güncelle (alım → quantity artır / satım → azalt)
    if (type === "buy") {
      await client.query(
        `INSERT INTO positions (portfolio_id, stock_id, quantity, avg_cost)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (portfolio_id, stock_id) DO UPDATE SET
           avg_cost = (positions.avg_cost * positions.quantity + $4 * $3) / (positions.quantity + $3),
           quantity = positions.quantity + $3,
           updated_at = NOW()`,
        [req.params.id, stock_id, quantity, price]
      );
    } else if (type === "sell") {
      const { rows: posRows } = await client.query(
        "SELECT quantity, avg_cost FROM positions WHERE portfolio_id = $1 AND stock_id = $2",
        [req.params.id, stock_id]
      );
      if (!posRows[0] || posRows[0].quantity < quantity) {
        throw Object.assign(new Error("Yetersiz hisse miktarı."), { status: 400 });
      }
      const realizedPnl = (price - posRows[0].avg_cost) * quantity;
      const newQty = posRows[0].quantity - quantity;

      if (newQty === 0) {
        await client.query(
          "DELETE FROM positions WHERE portfolio_id = $1 AND stock_id = $2",
          [req.params.id, stock_id]
        );
      } else {
        await client.query(
          `UPDATE positions SET quantity = $1,
             realized_pnl = realized_pnl + $2,
             updated_at = NOW()
           WHERE portfolio_id = $3 AND stock_id = $4`,
          [newQty, realizedPnl, req.params.id, stock_id]
        );
      }
    }

    // Nakit bakiyesini güncelle (alım → düş, satım → ekle)
    const cashDelta = type === "buy"
      ? -totalCost
      : (Number(quantity) * Number(price) - Number(commission || 0));

    await client.query(
      "UPDATE portfolios SET cash_balance = cash_balance + $1 WHERE id = $2",
      [cashDelta, req.params.id]
    );

    await client.query("COMMIT");
    res.status(201).json(txRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

// ── NAKİT İŞLEMLERİ ────────────────────────────────────────

// GET /api/portfolios/:id/cash-transactions
router.get("/:id/cash-transactions", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ct.*
       FROM cash_transactions ct
       JOIN portfolios p ON p.id = ct.portfolio_id
       WHERE ct.portfolio_id = $1 AND p.user_id = $2
       ORDER BY ct.executed_at DESC
       LIMIT 100`,
      [req.params.id, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/portfolios/:id/cash — nakit yatır / çek
router.post("/:id/cash", authenticate, async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query("BEGIN");

    const { type, amount, notes, executed_at } = req.body;
    if (!type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "type ve pozitif bir amount zorunludur." });
    }
    if (!["deposit", "withdraw"].includes(type)) {
      return res.status(400).json({ error: "type 'deposit' veya 'withdraw' olmalı." });
    }

    const { rows: pRows } = await client.query(
      "SELECT id, cash_balance FROM portfolios WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [req.params.id, req.user.id]
    );
    if (!pRows[0]) return res.status(404).json({ error: "Portföy bulunamadı." });

    const currentBalance = Number(pRows[0].cash_balance);

    if (type === "withdraw" && currentBalance < Number(amount)) {
      throw Object.assign(new Error("Yetersiz nakit bakiyesi."), { status: 400 });
    }

    const newBalance = type === "deposit"
      ? currentBalance + Number(amount)
      : currentBalance - Number(amount);

    await client.query(
      "UPDATE portfolios SET cash_balance = $1 WHERE id = $2",
      [newBalance, req.params.id]
    );

    const { rows: txRows } = await client.query(
      `INSERT INTO cash_transactions (portfolio_id, type, amount, notes, executed_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.params.id, type, amount, notes, executed_at || new Date()]
    );

    await client.query("COMMIT");
    res.status(201).json({ ...txRows[0], new_balance: newBalance });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
});

export default router;