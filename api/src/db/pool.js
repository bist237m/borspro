import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

// Artık DB_HOST/DB_USER gibi ayrı değişkenler yerine tek bir
// DATABASE_URL kullanıyoruz (worker'la aynı yaklaşım).
// Supabase pooler bağlantısı SSL istiyor, rejectUnauthorized: false
// self-signed sertifika uyarısını susturuyor (Supabase'in kendi sertifikası).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL bağlantı hatası:", err.message);
});

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;