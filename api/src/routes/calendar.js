// api/src/routes/calendar.js
// Şirket Takvimi — corporate_actions tablosundan (worker'ın --corporate-actions
// bayrağıyla zaten doldurduğu veri) piyasa genelinde yaklaşan ve yakın geçmiş
// sermaye artırımı / temettü olaylarını döndürür.

import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// GET /api/calendar/company?days_back=7&days_ahead=60
router.get("/company", authenticate, async (req, res, next) => {
  try {
    const daysBack  = Math.min(Number(req.query.days_back)  || 7,  30);
    const daysAhead = Math.min(Number(req.query.days_ahead) || 60, 180);

    const { rows } = await query(
      `
      SELECT ca.event_date, s.symbol, s.name, s.sector,
             ca.bedelli_oran, ca.bedelsiz_ic_oran, ca.bedelsiz_tm_oran,
             ca.nakit_tm_oran, ca.nakit_tm_tutar, ca.ruchan_oran, ca.price_tl
      FROM corporate_actions ca
      JOIN stocks s ON s.id = ca.stock_id
      WHERE s.is_active = TRUE
        AND ca.event_date BETWEEN CURRENT_DATE - ($1 || ' days')::interval
                              AND CURRENT_DATE + ($2 || ' days')::interval
      ORDER BY ca.event_date ASC, s.symbol ASC
      LIMIT 500
      `,
      [daysBack, daysAhead]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
