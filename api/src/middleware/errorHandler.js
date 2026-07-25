export function errorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${err.message}`);

  if (err.code === "23505") {   // PostgreSQL unique violation
    return res.status(409).json({ error: "Bu kayıt zaten mevcut." });
  }
  if (err.code === "23503") {   // Foreign key violation
    return res.status(400).json({ error: "İlgili kayıt bulunamadı." });
  }

  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Sunucu hatası." });
}
