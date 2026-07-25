# python/src/history.py
# Kayıtlı hisselerin geçmiş OHLCV verisini borsapy'den çekip price_history'e yazar.

import time
import borsapy as bp
from db import query, execute


def run_sync_history(period: str = "1y"):
    stocks = query("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"📅 Geçmiş veri senkronizasyonu ({period}) — {len(stocks)} hisse")

    total, errors = 0, 0

    for row in stocks:
        symbol, stock_id = row["symbol"], row["id"]
        try:
            df = bp.Ticker(symbol).history(period=period)
            count = 0
            for date, bar in df.iterrows():
                execute(
                    """
                    INSERT INTO price_history (stock_id, price_date, open, high, low, close, volume)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (stock_id, price_date) DO UPDATE SET
                      open   = EXCLUDED.open,
                      high   = EXCLUDED.high,
                      low    = EXCLUDED.low,
                      close  = EXCLUDED.close,
                      volume = EXCLUDED.volume
                    """,
                    (
                        stock_id,
                        date.date(),
                        float(bar["Open"]),
                        float(bar["High"]),
                        float(bar["Low"]),
                        float(bar["Close"]),
                        int(bar["Volume"]) if not pd_isna(bar["Volume"]) else 0,
                    ),
                )
                count += 1
            total += count
            print(f"   ✅ {symbol}: {count} bar")
        except Exception as err:
            errors += 1
            print(f"   ❌ {symbol}: {err}")

        time.sleep(0.2)  # kaynağı yormamak için kısa bekleme

    print(f"   Toplam: {total} bar | Hata: {errors}")
    return {"total": total, "errors": errors}


def pd_isna(value) -> bool:
    try:
        import math
        return value is None or (isinstance(value, float) and math.isnan(value))
    except Exception:
        return value is None


if __name__ == "__main__":
    run_sync_history("1y")