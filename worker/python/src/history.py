# python/src/history.py
# Kayıtlı hisselerin geçmiş OHLCV verisini borsapy'den çekip price_history'e yazar.
#
# HIZLANDIRMA: Eskiden 574 hisse TEK TEK, aralarına 0.2sn bekleme konularak
# seri çekiliyordu (~10-15 dk). scan.py'deki desenle aynı mantık: ağ istekleri
# (yavaş kısım) ThreadPoolExecutor ile paralel, veritabanı yazımı tek thread'de
# (ana thread) SAVEPOINT ile izole ediliyor — biri patlarsa diğerleri etkilenmez.

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import query, get_connection
import psycopg2.extras

MAX_WORKERS = 10  # scan.py ile aynı tavan — kaynağı aşırı yormadan hızlandırır


def pd_isna(value) -> bool:
    try:
        import math
        return value is None or (isinstance(value, float) and math.isnan(value))
    except Exception:
        return value is None


def fetch_history_data(symbol: str, period: str):
    """SADECE ağ isteği — veritabanına dokunmuyor, paralel/thread-safe.
    Barları (stock_id olmadan) hazır tuple listesi olarak döndürür."""
    df = bp.Ticker(symbol).history(period=period)
    records = []
    for date, bar in df.iterrows():
        records.append((
            date.date(),
            float(bar["Open"]),
            float(bar["High"]),
            float(bar["Low"]),
            float(bar["Close"]),
            int(bar["Volume"]) if not pd_isna(bar["Volume"]) else 0,
        ))
    return records


def save_history(cur, stock_id, records):
    if not records:
        return
    rows = [(stock_id, *r) for r in records]
    insert_query = """
        INSERT INTO price_history (stock_id, price_date, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (stock_id, price_date) DO UPDATE SET
          open   = EXCLUDED.open,
          high   = EXCLUDED.high,
          low    = EXCLUDED.low,
          close  = EXCLUDED.close,
          volume = EXCLUDED.volume
    """
    psycopg2.extras.execute_values(cur, insert_query, rows)


def run_sync_history(period: str = "1y"):
    stocks = query("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"📅 Geçmiş veri senkronizasyonu ({period}) — {len(stocks)} hisse ({MAX_WORKERS} paralel)")

    started = time.time()
    total, errors, completed = 0, 0, 0

    with get_connection() as conn:
        with conn.cursor() as cur:
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {
                    executor.submit(fetch_history_data, symbol, period): (stock_id, symbol)
                    for stock_id, symbol in stocks
                }

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    try:
                        records = future.result()
                        cur.execute("SAVEPOINT sp_history")
                        try:
                            save_history(cur, stock_id, records)
                            cur.execute("RELEASE SAVEPOINT sp_history")
                            total += len(records)
                        except Exception as err:
                            cur.execute("ROLLBACK TO SAVEPOINT sp_history")
                            errors += 1
                            print(f"   ❌ {symbol} (yazım hatası): {err}")
                    except Exception as err:
                        errors += 1
                        print(f"   ❌ {symbol} (ağ hatası): {err}")

                    if completed % 50 == 0:
                        elapsed = time.time() - started
                        rate = completed / elapsed if elapsed else 0
                        remaining = (len(stocks) - completed) / rate if rate else 0
                        print(f"   {completed}/{len(stocks)} tamamlandı — tahmini kalan {remaining:.0f}sn")

        conn.commit()

    duration = time.time() - started
    print(f"\n✅ Tamamlandı ({duration:.1f}sn): {total} bar kaydedildi, {errors} hata")
    return {"total": total, "errors": errors, "duration_sec": round(duration, 1)}


if __name__ == "__main__":
    run_sync_history("1y")
