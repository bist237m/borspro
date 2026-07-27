# python/src/extra_scan.py
# Filtre 5 (IFT5_EMA_MACD: 4h/1d/1wk) ve Filtre 6 (EMA120: 2h/30m)
# taramasını yapar. Ana --scan'den AYRI çalışır.
#
# Artık ana filtrelerle AYNI takip mekanizmasını (tracked_signals) kullanıyor —
# bu yüzden Raporlar sayfasındaki "Filtre Performans Raporu" bu filtreleri de
# otomatik olarak kapsıyor (isabet oranı, kilometre taşı takibi).

from db import get_connection
from extra_filters import filter_ift5_ema_macd, filter_ema120, fetch_bulk_scalars
from scan import track_stock  # ana filtrelerle aynı takip fonksiyonu

FILTER5_TIMEFRAMES = ["4h", "1d", "1wk"]
FILTER6_TIMEFRAMES = ["2h", "30m"]

# tracked_signals'ta ana filtrelerle karışmasın diye zaman dilimini de koda ekliyoruz
TF_SUFFIX = {"4h": "4H", "1d": "1D", "1wk": "1WK", "2h": "2H", "30m": "30M"}


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


def get_current_price(cur, stock_id):
    cur.execute("SELECT price FROM stock_quotes WHERE stock_id = %s", (stock_id,))
    row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def run_extra_scan():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            print(f"🔍 Ek filtre taraması başladı — {len(stocks)} hisse")

            symbols = [s for _, s in stocks]
            print("📡 Toplu gösterge verisi çekiliyor (ADX/EMA/MACD, tüm zaman dilimleri)...")
            bulk_scalars = fetch_bulk_scalars(symbols)
            print(f"   {len(bulk_scalars)} hisse için veri geldi")

            hits = 0
            for i, (stock_id, symbol) in enumerate(stocks):
                try:
                    triggered_codes = []

                    for tf in FILTER5_TIMEFRAMES:
                        r = filter_ift5_ema_macd(symbol, tf, bulk_scalars)
                        save_result(cur, stock_id, "IFT5_EMA_MACD", tf, r)
                        if r:
                            hits += 1
                            triggered_codes.append(f"IFT5_EMA_MACD_{TF_SUFFIX[tf]}")

                    for tf in FILTER6_TIMEFRAMES:
                        r = filter_ema120(symbol, tf, bulk_scalars)
                        save_result(cur, stock_id, "EMA120", tf, r)
                        if r:
                            hits += 1
                            triggered_codes.append(f"EMA120_{TF_SUFFIX[tf]}")

                    if triggered_codes:
                        current_price = get_current_price(cur, stock_id)
                        if current_price is not None:
                            track_stock(cur, stock_id, triggered_codes, current_price)

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
