# python/src/scan.py
# Filtre sistemi: HAFTALIK_1/2/3 + GUNLUK_1
# Her taranan hisse için gösterge değerleri indicator_snapshots'a yazılır
# (filtreye girsin girmesin) — Teknik Analiz sayfası bunu okuyacak.

import borsapy as bp
from db import get_connection
from custom_filters import (
    haftalik_analiz_1, haftalik_analiz_2, haftalik_analiz_3, gunluk_analiz_1,
    compute_snapshot_values,
)

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
        "SELECT id, filter_types, entry_price, max_price, "
        "milestone_5_at, milestone_10_at, milestone_20_at, milestone_30_at "
        "FROM tracked_signals WHERE stock_id = %s AND is_active = TRUE",
        (stock_id,),
    )
    row = cur.fetchone()

    if row:
        (tracked_id, existing_types, entry_price, max_price,
         m5, m10, m20, m30) = row
        existing_set = set(existing_types.split(",")) if existing_types else set()
        merged_types = ",".join(sorted(existing_set | set(triggered)))
        new_max = max(float(max_price or 0), current_price)
        entry_price_f = float(entry_price) if entry_price else current_price
        change_pct = ((current_price - entry_price_f) / entry_price_f * 100) if entry_price_f else 0

        # Kilometre taşları — ilk kez ulaşılan eşiği kaydet, sonra dokunma
        if m5  is None and change_pct >= 5:  m5  = "NOW()"
        if m10 is None and change_pct >= 10: m10 = "NOW()"
        if m20 is None and change_pct >= 20: m20 = "NOW()"
        if m30 is None and change_pct >= 30: m30 = "NOW()"

        cur.execute(
            f"""
            UPDATE tracked_signals SET
              filter_types   = %s,
              current_price  = %s,
              change_pct     = %s,
              max_price      = %s,
              max_price_date = CASE WHEN %s > COALESCE(max_price, 0)
                                     THEN CURRENT_DATE ELSE max_price_date END,
              milestone_5_at  = {'NOW()' if m5  == 'NOW()' else 'milestone_5_at'},
              milestone_10_at = {'NOW()' if m10 == 'NOW()' else 'milestone_10_at'},
              milestone_20_at = {'NOW()' if m20 == 'NOW()' else 'milestone_20_at'},
              milestone_30_at = {'NOW()' if m30 == 'NOW()' else 'milestone_30_at'},
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


def save_snapshot(cur, stock_id, weekly_vals, daily_vals, filter_results):
    cur.execute(
        """
        INSERT INTO indicator_snapshots
          (stock_id, inv1_9, inv1_13, ema21_weekly, ema21_daily,
           macdas_weekly, macdas_daily, cci20_weekly, cci20_daily,
           price_weekly, price_daily,
           haftalik_1, haftalik_2, haftalik_3, gunluk_1, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id) DO UPDATE SET
          inv1_9        = EXCLUDED.inv1_9,
          inv1_13       = EXCLUDED.inv1_13,
          ema21_weekly  = EXCLUDED.ema21_weekly,
          ema21_daily   = EXCLUDED.ema21_daily,
          macdas_weekly = EXCLUDED.macdas_weekly,
          macdas_daily  = EXCLUDED.macdas_daily,
          cci20_weekly  = EXCLUDED.cci20_weekly,
          cci20_daily   = EXCLUDED.cci20_daily,
          price_weekly  = EXCLUDED.price_weekly,
          price_daily   = EXCLUDED.price_daily,
          haftalik_1    = EXCLUDED.haftalik_1,
          haftalik_2    = EXCLUDED.haftalik_2,
          haftalik_3    = EXCLUDED.haftalik_3,
          gunluk_1      = EXCLUDED.gunluk_1,
          updated_at    = NOW()
        """,
        (
            stock_id,
            weekly_vals.get("inv1"), daily_vals.get("inv1"),
            weekly_vals.get("ema21"), daily_vals.get("ema21"),
            weekly_vals.get("macdas"), daily_vals.get("macdas"),
            weekly_vals.get("cci20"), daily_vals.get("cci20"),
            weekly_vals.get("price"), daily_vals.get("price"),
            filter_results.get("HAFTALIK_1", False),
            filter_results.get("HAFTALIK_2", False),
            filter_results.get("HAFTALIK_3", False),
            filter_results.get("GUNLUK_1", False),
        ),
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

    filter_results = {}
    for name, func, tf, _ in FILTERS:
        df = df_w if tf == "1wk" else df_d
        if df is None or len(df) < 30:
            filter_results[name] = False
            continue
        try:
            filter_results[name] = bool(func(df))
        except Exception as err:
            print(f"   ⚠️  {symbol} {name} hesap hatası: {err}")
            filter_results[name] = False

    # Gösterge anlık değerlerini hesapla (haftalık: CCI 9, günlük: CCI 13)
    weekly_vals = compute_snapshot_values(df_w, 9)  if df_w is not None and len(df_w) >= 30 else {}
    daily_vals  = compute_snapshot_values(df_d, 13) if df_d is not None and len(df_d) >= 30 else {}
    save_snapshot(cur, stock_id, weekly_vals, daily_vals, filter_results)

    triggered = [name for name, ok in filter_results.items() if ok]
    if not triggered:
        return "no_signal"

    current_price = daily_vals.get("price") or weekly_vals.get("price")
    if current_price is None:
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
            print(f"🔍 Tam tarama başladı — {len(stocks)} hisse (4 filtre + snapshot)")

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