// api/src/app.js
// Express app kurulumu — app.listen() BURADA YOK.
// Yerel çalıştırma için index.js, Vercel için kök dizindeki
// index.js bu dosyayı kullanıyor.

import "dotenv/config";
import express from "express";
import cors from "cors";

import authRouter       from "./routes/auth.js";
import stocksRouter     from "./routes/stocks.js";
import portfoliosRouter from "./routes/portfolios.js";
import watchlistsRouter from "./routes/watchlists.js";
import { alertsRouter, newsRouter, calendarRouter } from "./routes/misc.js";
import jobsRouter    from "./routes/jobs.js";
import signalsRouter from "./routes/signals.js";
import { errorHandler } from "./middleware/errorHandler.js";
import pool from "./db/pool.js";

const app = express();

// ── MIDDLEWARE ─────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
  next();
});

// ── ROUTES ─────────────────────────────────────────────────
app.use("/api/auth",       authRouter);
app.use("/api/stocks",     stocksRouter);
app.use("/api/portfolios", portfoliosRouter);
app.use("/api/watchlists", watchlistsRouter);
app.use("/api/alerts",     alertsRouter);
app.use("/api/news",       newsRouter);
app.use("/api/calendar",   calendarRouter);
app.use("/api/jobs",       jobsRouter);
app.use("/api/signals",    signalsRouter);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "connected", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

app.use((_req, res) => res.status(404).json({ error: "Endpoint bulunamadı." }));

app.use(errorHandler);

export default app;