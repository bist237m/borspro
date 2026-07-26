# python/src/fundamentals.py
# Temel veri (FAVÖK, PD/DD, F/K vb.) — artık TradingView'ın toplu
# sorgu API'sinden TEK istekte çekiliyor (İş Yatırım yerine).
# Önceki isyatirim tabanlı yöntem 20-40 dakika sürüyordu, bu ~1 saniye.

from tradingview_screener import Query
from db import get_connection

COLUMNS = [
    "name", "close", "market_cap_basic", "ebitda",
    "price_earnings_ttm", "price_book_fq",
    "price_52_week_high", "price_52_week_low", "net_income",
]


def fetch_all(symbols: list[str]):
    tickers = [f"BIST:{s}" for s in symbols]
    _, df = (
        Query()
        .set_markets("turkey")
        .select(*COLUMNS)
        .set_tickers(*tickers)
        .limit(1000)
        .get_scanner_data()
    )
    return df


def save_fundamentals(cur, stock_id, row):
    def clean(v):
        return None if v is None or v != v else float(v)  # NaN kontrolü

    favok      = clean(row.get("ebitda"))
    pe_ratio   = clean(row.get("price_earnings_ttm"))
    pb_ratio   = clean(row.get("price_book_fq"))
    market_cap = clean(row.get("market_cap_basic"))
    year_high  = clean(row.get("price_52_week_high"))
    year_low   = clean(row.get("price_52_week_low"))
    net_kar    = clean(row.get("net_income"))

    cur.execute(
        """
        INSERT INTO fundamentals_snapshots
          (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id) DO UPDATE SET
          favok      = EXCLUDED.favok,
          net_kar    = EXCLUDED.net_kar,
          pe_ratio   = EXCLUDED.pe_ratio,
          pb_ratio   = EXCLUDED.pb_ratio,
          market_cap = EXCLUDED.market_cap,
          year_high  = EXCLUDED.year_high,
          year_low   = EXCLUDED.year_low,
          updated_at = NOW()
        """,
        (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low),
    )


def run_fetch_fundamentals():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            symbol_to_id = {symbol: stock_id for stock_id, symbol in stocks}

            print(f"📊 TradingView'dan {len(symbol_to_id)} hisse için temel veri çekiliyor...")
            df = fetch_all(list(symbol_to_id.keys()))
            print(f"   {len(df)} hisse için veri döndü")

            saved, skipped = 0, 0
            for _, row in df.iterrows():
                symbol = row["name"]
                stock_id = symbol_to_id.get(symbol)
                if not stock_id:
                    skipped += 1
                    continue
                try:
                    save_fundamentals(cur, stock_id, row)
                    saved += 1
                except Exception as err:
                    print(f"   ❌ {symbol}: {err}")

            conn.commit()

    missing = len(symbol_to_id) - saved - skipped
    print(f"\n✅ Temel veri tamamlandı: {saved} kaydedildi, {skipped} eşleşmedi, {missing} TradingView'da bulunamadı")
    return {"saved": saved, "skipped": skipped}


if __name__ == "__main__":
    run_fetch_fundamentals()
