# python/src/scan.py
# Yeni filtre sistemi: HAFTALIK_1/2/3 + GUNLUK_1
# Eski RSI/TradingView tavsiyesi/eski IFT COMBO sistemi tamamen kaldırıldı.

import borsapy as bp
from db import get_connection
from custom_filters import (
    haftalik_analiz_1, haftalik_analiz_2, haftalik_analiz_3, gunluk_analiz_1,
)

# (isim, fonksiyon, zaman_dilimi, borsapy period parametresi)
FILTERS = [
    ("HAFTALIK_1", haftalik_analiz_1, "1wk", "2y"),
    ("HAFTALIK_2", haftalik_analiz_2, "1wk", "2y"),
    ("HAFTALIK_3", haftalik_analiz_3, "1wk", "2y"),
    ("GUNLUK_1",   gunluk_analiz_1,   "1d",  "1y"),
]


def save_signal(cur, stock_id, triggered, current_price):
    signal_types = ",".join(triggered)
    score = min(len(triggered) * 25, 100)
    comment = f"{signal_types} tetiklendi (fiyat: {current_price:.2f})"
    cur.execute(
        """
        INSERT INTO signals (stock_id, signal_types, direction, score, comment, scanned_at, scan_date)
        VALUES (%s, %s, 'bullish', %s, %s, NOW(), CURRENT_DATE)
        ON CONFLICT (stock_id, scan_date) DO UPDATE SET
          signal_types = EXCLUDED.signal_types,
          score        = EXCLUDED.score,
          comment      = EXCLUDED.comment,
          scanned_at   = NOW()
        """,
        (stock_id, signal_types, score, comment),
    )


def track_stock(cur, stock_id, triggered, current_price):
    cur.execute(
        "SELECT id, filter_types, entry_price, max_price FROM tracked_signals "
        "WHERE stock_id = %s AND is_active = TRUE",
        (stock_id,),
    )
    row = cur.fetchone()

    if row:
        tracked_id, existing_types, entry_price, max_price = row
        existing_set = set(existing_types.split(",")) if existing_types else set()
        merged_types = ",".join(sorted(existing_set | set(triggered)))
        new_max = max(float(max_price or 0), current_price)
        entry_price_f = float(entry_price) if entry_price else current_price
        change_pct = ((current_price - entry_price_f) / entry_price_f * 100) if entry_price_f else 0

        cur.execute(
            """
            UPDATE tracked_signals SET
              filter_types   = %s,
              current_price  = %s,
              change_pct     = %s,
              max_price      = %s,
              max_price_date = CASE WHEN %s > COALESCE(max_price, 0)
                                     THEN CURRENT_DATE ELSE max_price_date END,
              updated_at     = NOW()
            WHERE id = %s
            """,
            (merged_types, current_price, change_pct, new_max, current_price, tracked_id),
        )
    else:
        signal_types = ",".join(triggered)
        cur.execute(
            """
            INSERT INTO tracked_signals
              (stock_id, filter_types, entry_date, entry_price, current_price, change_pct, max_price, max_price_date)
            VALUES (%s, %s, CURRENT_DATE, %s, %s, 0, %s, CURRENT_DATE)
            """,
            (stock_id, signal_types, current_price, current_price, current_price),
        )


def scan_one(cur, stock_id, symbol):
    ticker = bp.Ticker(symbol)

    try:
        df_w = ticker.history(period="2y", interval="1wk")
    except Exception:
        df_w = None
    try:
        df_d = ticker.history(period="1y", interval="1d")
    except Exception:
        df_d = None

    triggered = []
    for name, func, tf, _ in FILTERS:
        df = df_w if tf == "1wk" else df_d
        if df is None or len(df) < 30:
            continue
        try:
            if func(df):
                triggered.append(name)
        except Exception as err:
            print(f"   ⚠️  {symbol} {name} hesap hatası: {err}")

    if not triggered:
        return "no_signal"

    if df_d is not None and len(df_d):
        current_price = float(df_d["Close"].iloc[-1])
    elif df_w is not None and len(df_w):
        current_price = float(df_w["Close"].iloc[-1])
    else:
        return "no_signal"

    save_signal(cur, stock_id, triggered, current_price)
    track_stock(cur, stock_id, triggered, current_price)
    return "signal"


def run_full_scan():
    results = {"total": 0, "signals": 0, "no_signal": 0, "errors": 0}

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            results["total"] = len(stocks)
            print(f"🔍 Tam tarama başladı — {len(stocks)} hisse (4 filtre)")

            for i, (stock_id, symbol) in enumerate(stocks):
                try:
                    status = scan_one(cur, stock_id, symbol)
                    conn.commit()
                    if status == "signal":
                        results["signals"] += 1
                    else:
                        results["no_signal"] += 1
                except Exception as err:
                    conn.rollback()
                    results["errors"] += 1
                    print(f"   ❌ {symbol}: {err}")

                if (i + 1) % 10 == 0:
                    print(f"   {i + 1}/{len(stocks)} tamamlandı...")

    print(f"\n✅ Tarama tamamlandı: {results}")
    return results


if __name__ == "__main__":
    run_full_scan()