# python/src/extra_scan.py
# Filtre 5 (IFT5_EMA_MACD: 4h/1d/1wk) ve Filtre 6 (EMA120: 2h/30m)
# taramasını yapar. Ana --scan'den AYRI çalışır.
#
# ADX/EMA/MACD gibi anlık değerler artık TEK bir toplu TradingView
# sorgusuyla (tüm hisseler için birden) çekiliyor — çok daha hızlı.

from db import get_connection
from extra_filters import filter_ift5_ema_macd, filter_ema120, fetch_bulk_scalars

FILTER5_TIMEFRAMES = ["4h", "1d", "1wk"]
FILTER6_TIMEFRAMES = ["2h", "30m"]


def save_result(cur, stock_id, filter_code, timeframe, result):
    cur.execute(
        """
        INSERT INTO extra_filter_results (stock_id, filter_code, timeframe, result, updated_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id, filter_code, timeframe) DO UPDATE SET
          result     = EXCLUDED.result,
          updated_at = NOW()
        """,
        (stock_id, filter_code, timeframe, result),
    )


def run_extra_scan():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            symbols = [s for _, s in stocks]
            print(f"🔍 Ek filtre taraması başladı — {len(stocks)} hisse")

            print("📡 Toplu gösterge verisi çekiliyor (ADX/EMA/MACD, tüm zaman dilimleri)...")
            bulk_scalars = fetch_bulk_scalars(symbols)
            print(f"   {len(bulk_scalars)} hisse için veri geldi")

            hits = 0
            for i, (stock_id, symbol) in enumerate(stocks):
                try:
                    for tf in FILTER5_TIMEFRAMES:
                        r = filter_ift5_ema_macd(symbol, tf, bulk_scalars)
                        save_result(cur, stock_id, "IFT5_EMA_MACD", tf, r)
                        if r: hits += 1

                    for tf in FILTER6_TIMEFRAMES:
                        r = filter_ema120(symbol, tf, bulk_scalars)
                        save_result(cur, stock_id, "EMA120", tf, r)
                        if r: hits += 1

                    conn.commit()
                except Exception as err:
                    conn.rollback()
                    print(f"   ❌ {symbol}: {err}")

                if (i + 1) % 10 == 0:
                    print(f"   {i + 1}/{len(stocks)} tamamlandı...")

    print(f"\n✅ Ek filtre taraması tamamlandı — {hits} pozitif sonuç")
    return {"hits": hits}


if __name__ == "__main__":
    run_extra_scan()
