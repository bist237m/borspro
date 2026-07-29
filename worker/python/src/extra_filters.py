# python/src/extra_filters.py
# Yeni filtreler (5 ve 6). Ana --scan'den AYRI çalışır (extra_scan.py üzerinden).
#
# HIZLANDIRMA: ADX, EMA100/120, MACD gibi "şu an ne durumda" değerlerini
# artık borsapy'nin hisse-başına yavaş fonksiyonlarıyla DEĞİL, TradingView'ın
# toplu sorgu API'siyle (tradingview_screener) TEK istekte tüm hisseler için
# çekiyoruz. Sadece kesişim tespiti (INV1, SMI, fiyat-EMA kesişimi) için
# borsapy'nin history() fonksiyonuyla hisse başına geçmiş veri lazım.

import borsapy as bp
import pandas as pd
from tradingview_screener import Query
from custom_filters import inv1_series, ema_series, crossed_above

# Zaman dilimi -> borsapy history() parametreleri
TIMEFRAME_MAP = {"4h": "4h", "1d": "1d", "1wk": "1wk", "2h": "2h", "30m": "30m"}
PERIOD_MAP    = {"4h": "6mo", "1d": "2y", "1wk": "2y", "2h": "3mo", "30m": "1mo"}

# Zaman dilimi -> TradingView alan eki (dakika cinsinden, haftalık için '1W')
TV_SUFFIX = {"4h": "240", "1d": "", "1wk": "1W", "2h": "120", "30m": "30"}


def fetch_bulk_scalars(symbols: list[str]) -> dict:
    """Tüm hisseler için ADX/EMA100/EMA120/MACD değerlerini TEK istekte çeker.
    Dönen: {symbol: {tf: {"adx":.., "ema100":.., "ema120":.., "macd":.., "signal":..}}}
    """
    cols = ["name"]
    col_map = []  # (kolon_adı, tf, alan_adı) eşleşmesi
    for tf, suf in TV_SUFFIX.items():
        for field, alias in [("ADX", "adx"), ("EMA100", "ema100"), ("EMA120", "ema120"),
                              ("MACD.macd", "macd"), ("MACD.signal", "signal")]:
            col_name = f"{field}|{suf}" if suf else field
            cols.append(col_name)
            col_map.append((col_name, tf, alias))

    tickers = [f"BIST:{s}" for s in symbols]
    _, df = Query().set_markets("turkey").select(*cols).set_tickers(*tickers).limit(1000).get_scanner_data()

    result = {}
    for _, row in df.iterrows():
        symbol = row["name"]
        result[symbol] = {}
        for col_name, tf, alias in col_map:
            result[symbol].setdefault(tf, {})[alias] = row.get(col_name)
    return result


# ── SMI (Stochastic Momentum Index) ────────────────────────
def smi_series(df: pd.DataFrame, length_k=10, length_d=3, length_ema=3):
    def ema_ema(source: pd.Series, length: int) -> pd.Series:
        first = source.ewm(span=length, adjust=False).mean()
        return first.ewm(span=length, adjust=False).mean()

    highest_high = df["High"].rolling(length_k).max()
    lowest_low   = df["Low"].rolling(length_k).min()
    hl_range     = highest_high - lowest_low
    rel_range    = df["Close"] - (highest_high + lowest_low) / 2

    smi = 200 * (ema_ema(rel_range, length_d) / ema_ema(hl_range, length_d))
    smi_signal = smi.ewm(span=length_ema, adjust=False).mean()
    return smi, smi_signal


# ── FİLTRE 5: IFT5_EMA_MACD ─────────────────────────────────
def filter_ift5_ema_macd(df, symbol: str, timeframe: str, bulk_scalars: dict) -> bool:
    """DEĞİŞTİ: Veriyi artık kendisi çekmiyor — hazır df alıyor.
    Aynı hissenin aynı zaman dilimi verisi tarama boyunca SADECE BİR KEZ indiriliyor."""
    if df is None or len(df) < 30:
        return False

    inv1 = inv1_series(df, cci_length=5, wma_length=9)
    c1 = crossed_above(inv1, 0.5, lookback=1)

    ema21 = ema_series(df["Close"], 21)
    price_minus_ema = df["Close"] - ema21
    c2 = crossed_above(price_minus_ema, 0, lookback=2)

    scalars = bulk_scalars.get(symbol, {}).get(timeframe, {})
    macd, signal = scalars.get("macd"), scalars.get("signal")
    c3 = macd is not None and signal is not None and macd > signal

    return bool(c1 and c2 and c3)


# ── FİLTRE 6: EMA120 ─────────────────────────────────────────
def filter_ema120(df, symbol: str, timeframe: str, bulk_scalars: dict) -> bool:
    """DEĞİŞTİ: Veriyi artık kendisi çekmiyor — hazır df alıyor."""
    if df is None or len(df) < 130:
        return False

    ema100_series = ema_series(df["Close"], 100)
    price_minus_ema100 = df["Close"] - ema100_series
    c_price_cross = crossed_above(price_minus_ema100, 0, lookback=2)

    smi, smi_signal = smi_series(df)
    c_smi_cross = crossed_above(smi - smi_signal, 0, lookback=1)
    c_smi_negative = smi.iloc[-1] < 0

    scalars = bulk_scalars.get(symbol, {}).get(timeframe, {})
    ema120_now, ema100_now = scalars.get("ema120"), scalars.get("ema100")
    adx_now = scalars.get("adx")
    macd_now, signal_now = scalars.get("macd"), scalars.get("signal")

    if None in (ema120_now, ema100_now, adx_now, macd_now, signal_now):
        return False

    c_ema = ema120_now >= ema100_now
    c_adx = adx_now > 20
    c_macd = (macd_now - signal_now) > 0

    return bool(c_price_cross and c_smi_cross and c_smi_negative and c_ema and c_adx and c_macd)
