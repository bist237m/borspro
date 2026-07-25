# python/src/db.py
# PostgreSQL (Supabase) bağlantı yardımcıları — Node'daki db.js'in Python karşılığı.

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def get_connection():
    """Yeni bir bağlantı açar. `with get_connection() as conn:` şeklinde kullan."""
    return psycopg2.connect(DATABASE_URL)


def query(sql, params=None):
    """SELECT sorguları için — dict listesi döndürür."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()


def execute(sql, params=None):
    """INSERT/UPDATE/DELETE için — commit eder."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
        conn.commit()


def execute_returning(sql, params=None):
    """INSERT ... RETURNING id gibi sorgular için — ilk satırın ilk kolonunu döndürür."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            row = cur.fetchone()
        conn.commit()
        return row[0] if row else None
