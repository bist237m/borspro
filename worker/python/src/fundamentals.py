# python/src/fundamentals.py
# Temel + teknik veri — TradingView'ın toplu sorgu API'sinden TEK istekte.
#
# BİRLEŞTİRİLDİ (eskiden sync_fundamentals.py ayrı çalışıyordu):
# PE/PB/ROE/Piyasa Değeri/Net Kar için İş Yatırım Screener (KAP kaynaklı,
# Türk hisseleri için genelde daha güncel/isabetli) önceliklidir. Diğer
# tüm alanlar (FAVÖK, 52 hafta yüksek/düşük, büyüme oranları, RSI, SMA50,
# hacim, pivot, MACD) sadece TradingView'da var, oradan geliyor.

import pandas as pd
import borsapy as bp
from tradingview_screener import Query
from db import get_connection

COLUMNS = [
    "name", "close", "market_cap_basic", "ebitda",
    "price_earnings_ttm", "price_book_fq",
    "price_52_week_high", "price_52_week_low", "net_income",
    "return_on_equity_fq", "total_debt", "net_income_yoy_growth_fq",
    "total_revenue_yoy_growth_fq",
    "RSI", "SMA50", "volume", "average_volume_10d_calc",
    "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
    "MACD.macd", "MACD.signal",
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


def fetch_isyatirim(symbols: list[str]) -> dict:
    """İş Yatırım Screener'dan PE/PB/ROE/Piyasa Değeri/Net Kar çeker (TEK istek).
    Bu alanlar KAP'a dayandığı için Türk hisselerinde TradingView'dan
    daha güncel olabiliyor — bu yüzden save_fundamentals'ta önceliklidir."""
    try:
        screener = bp.Screener()
        screener.add_filter("pe", min=-9999, max=99999)
        screener.add_filter("pb", min=-9999, max=99999)
        screener.add_filter("roe", min=-9999, max=99999)
        df = screener.run()
    except Exception as err:
        print(f"   ⚠️  İş Yatırım Screener hatası, bu alanlar TradingView değerinde kalacak: {err}")
        return {}

    if df is None or df.empty:
        return {}

    df.set_index("symbol", inplace=True)
    result = {}
    for symbol in symbols:
        if symbol not in df.index:
            continue
        row = df.loc[symbol]
        if isinstance(row, pd.DataFrame):  # aynı sembol birden fazla satırda gelirse
            row = row.iloc[0]
        result[symbol] = row
    return result


def _safe_float_tr(val):
    """İş Yatırım'ın virgüllü sayı formatını (örn. '1.234,56') float'a çevirir."""
    if val is None or val != val or val == "":
        return None
    try:
        val_str = str(val).replace(".", "").replace(",", ".")
        return float(val_str)
    except Exception:
        return None


def save_fundamentals(cur, stock_id, row, iy_row=None):
    def clean(v):
        return None if v is None or v != v else float(v)  # NaN kontrolü

    favok      = clean(row.get("ebitda"))
    pe_ratio   = clean(row.get("price_earnings_ttm"))
    pb_ratio   = clean(row.get("price_book_fq"))
    market_cap = clean(row.get("market_cap_basic"))
    year_high  = clean(row.get("price_52_week_high"))
    year_low   = clean(row.get("price_52_week_low"))
    net_kar    = clean(row.get("net_income"))
    roe        = clean(row.get("return_on_equity_fq"))
    total_debt = clean(row.get("total_debt"))
    ni_growth  = clean(row.get("net_income_yoy_growth_fq"))
    rev_growth = clean(row.get("total_revenue_yoy_growth_fq"))
    rsi        = clean(row.get("RSI"))
    sma50      = clean(row.get("SMA50"))
    volume     = clean(row.get("volume"))
    avg_vol10  = clean(row.get("average_volume_10d_calc"))
    pivot_s1   = clean(row.get("Pivot.M.Classic.S1"))
    pivot_r1   = clean(row.get("Pivot.M.Classic.R1"))
    macd_line  = clean(row.get("MACD.macd"))
    macd_sig   = clean(row.get("MACD.signal"))

    # İş Yatırım verisi varsa bu 5 alanda TradingView'ın önüne geçer (KAP kaynaklı)
    if iy_row is not None:
        iy_pe  = _safe_float_tr(iy_row.get("criteria_28"))    # F/K
        iy_pb  = _safe_float_tr(iy_row.get("criteria_30"))    # PD/DD
        iy_roe = _safe_float_tr(iy_row.get("criteria_422"))   # ROE
        iy_mc  = _safe_float_tr(iy_row.get("criteria_59"))    # Piyasa Değeri (mn TL)
        iy_nk  = _safe_float_tr(iy_row.get("criteria_169"))   # Net Kar (mn TL)

        if iy_pe  is not None: pe_ratio   = iy_pe
        if iy_pb  is not None: pb_ratio   = iy_pb
        if iy_roe is not None: roe        = iy_roe
        if iy_mc  is not None: market_cap = iy_mc
        if iy_nk  is not None: net_kar    = iy_nk

    cur.execute(
        """
        INSERT INTO fundamentals_snapshots
          (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low,
           roe, total_debt, net_income_yoy_growth, revenue_yoy_growth,
           rsi, sma50, volume, avg_volume_10d, pivot_s1, pivot_r1, macd_line, macd_signal_line,
           updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id) DO UPDATE SET
          favok                  = EXCLUDED.favok,
          net_kar                = EXCLUDED.net_kar,
          pe_ratio               = EXCLUDED.pe_ratio,
          pb_ratio               = EXCLUDED.pb_ratio,
          market_cap             = EXCLUDED.market_cap,
          year_high              = EXCLUDED.year_high,
          year_low               = EXCLUDED.year_low,
          roe                    = EXCLUDED.roe,
          total_debt             = EXCLUDED.total_debt,
          net_income_yoy_growth  = EXCLUDED.net_income_yoy_growth,
          revenue_yoy_growth     = EXCLUDED.revenue_yoy_growth,
          rsi                    = EXCLUDED.rsi,
          sma50                  = EXCLUDED.sma50,
          volume                 = EXCLUDED.volume,
          avg_volume_10d         = EXCLUDED.avg_volume_10d,
          pivot_s1               = EXCLUDED.pivot_s1,
          pivot_r1               = EXCLUDED.pivot_r1,
          macd_line              = EXCLUDED.macd_line,
          macd_signal_line       = EXCLUDED.macd_signal_line,
          updated_at             = NOW()
        """,
        (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low,
         roe, total_debt, ni_growth, rev_growth,
         rsi, sma50, volume, avg_vol10, pivot_s1, pivot_r1, macd_line, macd_sig),
    )


def run_fetch_fundamentals():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            symbol_to_id = {symbol: stock_id for stock_id, symbol in stocks}

            symbols = list(symbol_to_id.keys())

            print(f"📊 TradingView'dan {len(symbols)} hisse için temel+teknik veri çekiliyor...")
            df = fetch_all(symbols)
            print(f"   {len(df)} hisse için TradingView verisi döndü")

            print("📊 İş Yatırım Screener'dan PE/PB/ROE/Piyasa Değeri/Net Kar çekiliyor...")
            iy_data = fetch_isyatirim(symbols)
            print(f"   {len(iy_data)} hisse için İş Yatırım verisi döndü")

            saved, skipped = 0, 0
            for _, row in df.iterrows():
                symbol = row["name"]
                stock_id = symbol_to_id.get(symbol)
                if not stock_id:
                    skipped += 1
                    continue
                try:
                    save_fundamentals(cur, stock_id, row, iy_data.get(symbol))
                    saved += 1
                except Exception as err:
                    print(f"   ❌ {symbol}: {err}")

            conn.commit()

    missing = len(symbol_to_id) - saved - skipped
    print(f"\n✅ Tamamlandı: {saved} kaydedildi, {skipped} eşleşmedi, {missing} TradingView'da bulunamadı")
    return {"saved": saved, "skipped": skipped}


if __name__ == "__main__":
    run_fetch_fundamentals()
