# python/src/db.py
# PostgreSQL (Supabase) bağlantı yardımcıları — Node'daki db.js'in Python karşılığı.

import os
import psycopg2
import psycopg2.extras
from psycopg2 import pool         # YENİ EKLENDİ
from contextlib import contextmanager # YENİ EKLENDİ
from dotenv import load_dotenv
load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
db_pool = pool.ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)


@contextmanager
def get_connection():
    """Havuzdan (pool) hazır bir bağlantı alır ve iş bitince geri bırakır."""
    conn = db_pool.getconn()
    try:
        yield conn
    finally:
        db_pool.putconn(conn)


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
