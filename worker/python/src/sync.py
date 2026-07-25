# python/src/sync.py
# Kayıtlı hisselerin anlık fiyatını günceller.
# ÖNEMLİ: fast_info kullanmıyoruz — o, isyatirim.com'dan da veri çekmeye
# çalışıyor ve bazen çok yavaş/yanıtsız kalıyor. Bunun yerine sadece
# TradingView tabanlı history() kullanıyoruz.

import borsapy as bp
from db import query, execute


def run_sync_quotes():
    stocks = query("SELECT symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"📡 Fiyat güncelleme başladı — {len(stocks)} hisse")

    updated, errors = 0, 0

    for row in stocks:
        symbol = row["symbol"]
        try:
            df = bp.Ticker(symbol).history(period="5g")
            if df is None or len(df) == 0:
                errors += 1
                print(f"   ❌ {symbol}: veri yok")
                continue

            last = df.iloc[-1]
            prev_close = float(df.iloc[-2]["Close"]) if len(df) > 1 else float(last["Close"])
            last_price = float(last["Close"])

            execute(
                """
                INSERT INTO stock_quotes (stock_id, price, change_abs, change_pct, day_high, day_low, volume, quoted_at)
                SELECT id, %s, %s, %s, %s, %s, %s, NOW()
                FROM stocks WHERE symbol = %s
                ON CONFLICT (stock_id) DO UPDATE SET
                  price      = EXCLUDED.price,
                  change_abs = EXCLUDED.change_abs,
                  change_pct = EXCLUDED.change_pct,
                  day_high   = EXCLUDED.day_high,
                  day_low    = EXCLUDED.day_low,
                  volume     = EXCLUDED.volume,
                  quoted_at  = NOW()
                """,
                (
                    last_price,
                    last_price - prev_close,
                    ((last_price - prev_close) / prev_close * 100) if prev_close else 0,
                    float(last["High"]),
                    float(last["Low"]),
                    int(last["Volume"]) if last["Volume"] == last["Volume"] else 0,  # NaN kontrolü
                    symbol,
                ),
            )
            updated += 1
        except Exception as err:
            errors += 1
            print(f"   ❌ {symbol}: {err}")

    print(f"   ✅ Güncellenen: {updated} | Hata: {errors}")
    return {"updated": updated, "errors": errors}


if __name__ == "__main__":
    run_sync_quotes()