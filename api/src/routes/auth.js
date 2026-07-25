import { Router } from "express";
import bcrypt from "bcryptjs";
import { query } from "../db/pool.js";
import { signToken } from "../utils/jwt.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, full_name, plan, created_at`,
      [email.toLowerCase(), hash, full_name]
    );

    const user = rows[0];

    // Varsayılan portföy oluştur
    await query(
      `INSERT INTO portfolios (user_id, name, is_default)
       VALUES ($1, 'Ana Portföy', TRUE)`,
      [user.id]
    );

    // Varsayılan izleme listesi oluştur
    await query(
      `INSERT INTO watchlists (user_id, name, is_default)
       VALUES ($1, 'Favoriler', TRUE)`,
      [user.id]
    );

    const token = signToken({ id: user.id, email: user.email, plan: user.plan });
    res.status(201).json({ token, user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "E-posta ve şifre zorunludur." });
    }

    const { rows } = await query(
      `SELECT id, email, password_hash, full_name, plan FROM users
       WHERE email = $1 AND is_active = TRUE`,
      [email.toLowerCase()]
    );

    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "E-posta veya şifre hatalı." });
    }

    const { password_hash, ...safeUser } = user;
    const token = signToken({ id: user.id, email: user.email, plan: user.plan });
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get("/me", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, email, full_name, plan, avatar_url, timezone, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
