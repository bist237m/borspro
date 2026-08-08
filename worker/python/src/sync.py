# python/src/sync.py
# Kayıtlı hisselerin anlık fiyatını günceller + üstteki piyasa
# şeridi için BIST100/USD/Altın verisini çeker.
#
# HIZLANDIRMA: Eskiden 574 hisse TEK TEK çekiliyordu (her biri ayrı
# bp.Ticker().history() ağ isteği + ayrı DB commit'i) — dakikalar sürüyordu.
# ŞİMDİ: extra_filters.fetch_bulk_scalars ile aynı desen — TradingView'ın
# toplu sorgu API'si (tradingview_screener) TÜM hisselerin fiyat/değişim/
# yüksek/düşük/hacim verisini TEK istekte veriyor, DB'ye de tek execute_values
# ile yazılıyor. 574 istek -> 1 istek, 574 commit -> 1 commit.
#
# Toplu sorgu herhangi bir sebeple başarısız olursa eski tek-tek yöntemine
# (fallback) düşer — böylece TradingView API'si değişse bile sync çalışmaya
# devam eder.

import borsapy as bp
import psycopg2.extras
from tradingview_screener import Query
from db import query, execute, get_connection
from scan import refresh_tracked_prices
from net_utils import throttled_retry


def fetch_bulk_quotes(symbols: list[str]) -> dict:
    """TÜM hisselerin anlık fiyat verisini TEK istekte çeker.
    Dönen: {symbol: {"price":.., "change_pct":.., "high":.., "low":.., "volume":..}}

    TradingView 'change' alanını YÜZDE olarak veriyor; change_abs ve prev_close
    bundan türetiliyor (prev_close = price / (1 + change/100))."""
    tickers = [f"BIST:{s}" for s in symbols]
    _, df = (
        Query()
        .set_markets("turkey")
        .select("name", "close", "change", "high", "low", "volume")
        .set_tickers(*tickers)
        .limit(2000)
        .get_scanner_data()
    )

    out = {}
    for _, row in df.iterrows():
        price = row.get("close")
        if price is None or price != price:  # None / NaN kontrolü
            continue
        out[row["name"]] = {
            "price":      float(price),
            "change_pct": float(row.get("change") or 0),
            "high":       float(row.get("high") or price),
            "low":        float(row.get("low") or price),
            "volume":     int(row.get("volume") or 0),
        }
    return out


def save_quotes_bulk(cur, rows):
    """Tüm fiyatları TEK sorguda yazar (execute_values)."""
    if not rows:
        return
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO stock_quotes
          (stock_id, price, change_abs, change_pct, day_high, day_low, volume, quoted_at)
        VALUES %s
        ON CONFLICT (stock_id) DO UPDATE SET
          price      = EXCLUDED.price,
          change_abs = EXCLUDED.change_abs,
          change_pct = EXCLUDED.change_pct,
          day_high   = EXCLUDED.day_high,
          day_low    = EXCLUDED.day_low,
          volume     = EXCLUDED.volume,
          quoted_at  = NOW()
        """,
        rows,
        template="(%s, %s, %s, %s, %s, %s, %s, NOW())",
    )


def run_sync_quotes():
    stocks = query("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"📡 Fiyat güncelleme başladı — {len(stocks)} hisse (toplu sorgu)")

    symbol_to_id = {row["symbol"]: row["id"] for row in stocks}
    updated, errors = 0, 0

    try:
        quotes = fetch_bulk_quotes(list(symbol_to_id.keys()))
        print(f"   📦 Toplu sorgudan {len(quotes)} hisse verisi geldi")

        rows = []
        for symbol, q in quotes.items():
            stock_id = symbol_to_id.get(symbol)
            if not stock_id:
                continue
            price, change_pct = q["price"], q["change_pct"]
            prev_close = price / (1 + change_pct / 100) if change_pct != -100 else price
            rows.append((
                stock_id, price, price - prev_close, change_pct,
                q["high"], q["low"], q["volume"],
            ))

        with get_connection() as conn:
            with conn.cursor() as cur:
                save_quotes_bulk(cur, rows)
            conn.commit()

        updated = len(rows)
        errors = len(symbol_to_id) - updated

        # Toplu sorgudan dönmeyen semboller — TradingView'da başka kodla geçiyor,
        # işlem görmüyor (askıda/yeni halka arz) ya da artık listede değil olabilir.
        # Sessizce yutmak yerine yazdırıyoruz ki stocks tablosu temizlenebilsin.
        if errors:
            missing = sorted(set(symbol_to_id) - set(quotes))
            print(f"   ⚠️  Veri gelmeyen {len(missing)} sembol: {', '.join(missing)}")
    except Exception as err:
        print(f"   ⚠️  Toplu sorgu başarısız ({err}), tek tek yönteme düşülüyor...")
        updated, errors = _sync_quotes_one_by_one(stocks)

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


def _sync_quotes_one_by_one(stocks):
    """YEDEK PLAN — toplu sorgu çalışmazsa eski tek-tek yöntemi.
    Yavaş (574 ayrı ağ isteği) ama TradingView'ın toplu API'si değişse bile
    sync'in tamamen durmamasını sağlar."""
    updated, errors = 0, 0
    for row in stocks:
        symbol = row["symbol"]
        try:
            df = throttled_retry(lambda: bp.Ticker(symbol).history(period="5g"))
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
    return updated, errors


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
    onlar hâlâ run_sync_quotes'un (5 dakikalık GitHub Actions) işi.

    run_sync_quotes ile aynı toplu sorgu yolunu kullanır — az sembol olsa bile
    tek istek, tek yazım."""
    rows_q = query(
        """
        SELECT DISTINCT s.id, s.symbol
        FROM positions p
        JOIN stocks s ON s.id = p.stock_id
        WHERE p.quantity > 0
        """
    )
    symbol_to_id = {r["symbol"]: r["id"] for r in rows_q}
    if not symbol_to_id:
        print("📡 Açık pozisyon yok, güncellenecek bir şey yok.")
        return {"updated": 0, "errors": 0}

    print(f"📡 Pozisyon fiyatları güncelleniyor — {len(symbol_to_id)} sembol: {', '.join(symbol_to_id)}")

    try:
        quotes = fetch_bulk_quotes(list(symbol_to_id.keys()))
        rows = []
        for symbol, q in quotes.items():
            stock_id = symbol_to_id.get(symbol)
            if not stock_id:
                continue
            price, change_pct = q["price"], q["change_pct"]
            prev_close = price / (1 + change_pct / 100) if change_pct != -100 else price
            rows.append((
                stock_id, price, price - prev_close, change_pct,
                q["high"], q["low"], q["volume"],
            ))

        with get_connection() as conn:
            with conn.cursor() as cur:
                save_quotes_bulk(cur, rows)
            conn.commit()

        updated = len(rows)
        errors = len(symbol_to_id) - updated
    except Exception as err:
        print(f"   ⚠️  Toplu sorgu başarısız ({err}), tek tek yönteme düşülüyor...")
        updated, errors = _sync_quotes_one_by_one(
            [{"symbol": sym} for sym in symbol_to_id]
        )

    print(f"   ✅ Güncellenen: {updated} | Hata: {errors}")
    return {"updated": updated, "errors": errors}


if __name__ == "__main__":
    run_sync_quotes()
