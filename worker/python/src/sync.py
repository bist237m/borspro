# python/src/sync.py
# Kayıtlı hisselerin anlık fiyatını günceller + üstteki piyasa
# şeridi için BIST100/USD/Altın verisini çeker.
# ÖNEMLİ: fast_info kullanmıyoruz — o, isyatirim.com'dan da veri çekmeye
# çalışıyor ve bazen çok yavaş/yanıtsız kalıyor. Bunun yerine sadece
# TradingView tabanlı history() kullanıyoruz.

import borsapy as bp
from db import query, execute, get_connection
from scan import refresh_tracked_prices


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

    # ── Takip edilen hisselerin fiyat/değişim/milestone'larını yenile ──
    # Filtre o gün yeniden tetiklenmese bile bu hisseler burada güncellenir —
    # yoksa current_price/change_pct giriş anındaki değerde donup kalır.
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                refreshed = refresh_tracked_prices(cur)
            conn.commit()
        print(f"   🔄 Takip edilen {refreshed} hissenin fiyat/milestone'u yenilendi")
    except Exception as err:
        print(f"   ⚠️  Takip fiyat yenileme hatası: {err}")

    # ── Piyasa şeridi: BIST100, USD/TRY, Altın ──
    try:
        run_sync_market_snapshot()
    except Exception as err:
        print(f"   ⚠️  Piyasa şeridi güncellenemedi: {err}")

    return {"updated": updated, "errors": errors}


def run_sync_market_snapshot():
    print("📊 Piyasa şeridi güncelleniyor (BIST100, USD/TRY, Altın)...")

    idx_info = bp.Index("XU100").info
    usd = bp.FX("USD").current
    gold = bp.FX("gram-altin").current

    # FX için 'current' açık şekilde değişim yüzdesi vermiyor,
    # gün içi open'a göre yaklaşık değişim hesaplıyoruz.
    def pct_from_open(cur):
        last, open_ = cur.get("last"), cur.get("open")
        if not last or not open_:
            return None
        return (last - open_) / open_ * 100

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO market_snapshot
                  (id, bist100_last, bist100_change_pct, usd_last, usd_change_pct, gold_last, gold_change_pct, updated_at)
                VALUES (1, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  bist100_last       = EXCLUDED.bist100_last,
                  bist100_change_pct = EXCLUDED.bist100_change_pct,
                  usd_last           = EXCLUDED.usd_last,
                  usd_change_pct     = EXCLUDED.usd_change_pct,
                  gold_last          = EXCLUDED.gold_last,
                  gold_change_pct    = EXCLUDED.gold_change_pct,
                  updated_at         = NOW()
                """,
                (
                    idx_info.get("last"), idx_info.get("change_percent"),
                    usd.get("last"), pct_from_open(usd),
                    gold.get("last"), pct_from_open(gold),
                ),
            )
        conn.commit()

    print("   ✅ Piyasa şeridi güncellendi")


def run_sync_position_quotes():
    """SADECE açık pozisyonlardaki hisselerin fiyatını günceller.
    574 hissenin tamamını çeken run_sync_quotes'tan FARKLI — bu, dakikada bir
    çalıştırılabilecek kadar hafif (tipik olarak 5-15 sembol).
    Piyasa şeridini ve takip edilen (tracked_signals) fiyatları GÜNCELLEMİYOR —
    onlar hâlâ run_sync_quotes'un (5 dakikalık GitHub Actions) işi."""
    symbols = query(
        """
        SELECT DISTINCT s.symbol
        FROM positions p
        JOIN stocks s ON s.id = p.stock_id
        WHERE p.quantity > 0
        """
    )
    symbol_list = [row["symbol"] for row in symbols]
    if not symbol_list:
        print("📡 Açık pozisyon yok, güncellenecek bir şey yok.")
        return {"updated": 0, "errors": 0}

    print(f"📡 Pozisyon fiyatları güncelleniyor — {len(symbol_list)} sembol: {', '.join(symbol_list)}")

    updated, errors = 0, 0
    for symbol in symbol_list:
        try:
            df = bp.Ticker(symbol).history(period="5g")
            if df is None or len(df) == 0:
                errors += 1
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
                    int(last["Volume"]) if last["Volume"] == last["Volume"] else 0,
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
