// src/db.js
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

export const query  = (sql, params) => pool.query(sql, params);
export const client = () => pool.connect();
export default pool;
