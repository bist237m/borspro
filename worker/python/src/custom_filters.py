# python/src/custom_filters.py
# Senin verdiğin Pine Script mantığının Python/pandas karşılığı.
# Eski sinyal sistemini (RSI/TV tavsiyesi/eski IFT COMBO) tamamen değiştiriyor.

import math
import pandas as pd


# ── TEMEL GÖSTERGELER ─────────────────────────────────────

def ema_series(close: pd.Series, length: int) -> pd.Series:
    return close.ewm(span=length, adjust=False).mean()


def cci_series(source: pd.Series, length: int) -> pd.Series:
    """Standart CCI — Pine'daki: (src - sma(src,len)) / (0.015 * dev(src,len))
    dev = ortalama mutlak sapma (mean absolute deviation)."""
    ma = source.rolling(length).mean()
    mad = source.rolling(length).apply(lambda x: (x - x.mean()).abs().mean(), raw=False)
    return (source - ma) / (0.015 * mad.replace(0, float("nan")))


def wma_series(series: pd.Series, length: int) -> pd.Series:
    weights = list(range(1, length + 1))
    return series.rolling(length).apply(
        lambda x: sum(w * v for w, v in zip(weights, x)) / sum(weights), raw=True
    )


def inv1_series(df: pd.DataFrame, cci_length: int, wma_length: int = 9) -> pd.Series:
    """INV1 — CCI(close bazlı) üzerinden Inverse Fisher Transform."""
    cci_close = cci_series(df["Close"], cci_length)   # ÖNEMLİ: close bazlı, hlc3 değil
    v11 = 0.1 * (cci_close / 4)
    v21 = wma_series(v11, wma_length)
    exp2v = v21.apply(lambda x: math.exp(2 * x) if pd.notna(x) else float("nan"))
    return (exp2v - 1) / (exp2v + 1)


def macdas_series(close: pd.Series, fast=12, slow=26, signal=9) -> pd.Series:
    """MACDAS = macd - signal çizgisi (standart MACD histogramıyla aynı)."""
    macd = ema_series(close, fast) - ema_series(close, slow)
    signal_line = ema_series(macd, signal)
    return macd - signal_line


# ── KESİŞİM YARDIMCILARI ──────────────────────────────────

def crossed_above(series: pd.Series, level: float, lookback: int = 1) -> bool:
    """Son `lookback` bar içinde herhangi bir noktada seviyeyi yukarı kesti mi?"""
    s = series.dropna()
    if len(s) < 2:
        return False
    for i in range(1, min(lookback, len(s) - 1) + 1):
        prev, curr = s.iloc[-i - 1], s.iloc[-i]
        if prev <= level and curr > level:
            return True
    return False


def crossed_below(series: pd.Series, level: float, lookback: int = 1) -> bool:
    s = series.dropna()
    if len(s) < 2:
        return False
    for i in range(1, min(lookback, len(s) - 1) + 1):
        prev, curr = s.iloc[-i - 1], s.iloc[-i]
        if prev >= level and curr < level:
            return True
    return False


# ── 4 FİLTRE KOŞULU ────────────────────────────────────────
# Her fonksiyon df (Open/High/Low/Close/Volume) alır, True/False döner.

def haftalik_analiz_1(df: pd.DataFrame) -> bool:
    inv1 = inv1_series(df, cci_length=9, wma_length=9)
    ema21 = ema_series(df["Close"], 21)
    macdas = macdas_series(df["Close"])

    c1 = crossed_above(inv1, 0.5, lookback=1)
    c2 = ema21.iloc[-1] < df["Close"].iloc[-1]
    macdas_now = macdas.iloc[-1]
    c3 = (macdas_now < 0) or (macdas_now > 0 and crossed_above(macdas, 0, lookback=3))

    return bool(c1 and c2 and c3)


def haftalik_analiz_2(df: pd.DataFrame) -> bool:
    inv1 = inv1_series(df, cci_length=9, wma_length=9)
    ema21 = ema_series(df["Close"], 21)
    macdas = macdas_series(df["Close"])
    hlc3 = (df["High"] + df["Low"] + df["Close"]) / 3
    cci20 = cci_series(hlc3, 20)

    c1 = crossed_above(inv1, 0.5, lookback=1)
    c2 = ema21.iloc[-1] < df["Close"].iloc[-1]
    c3 = crossed_above(macdas, 0, lookback=1)
    c4 = crossed_above(cci20, 100, lookback=1)

    return bool(c1 and c2 and c3 and c4)


def haftalik_analiz_3(df: pd.DataFrame) -> bool:
    inv1 = inv1_series(df, cci_length=9, wma_length=9)
    ema21 = ema_series(df["Close"], 21)
    macdas = macdas_series(df["Close"])
    hlc3 = (df["High"] + df["Low"] + df["Close"]) / 3
    cci20 = cci_series(hlc3, 20)

    c1 = crossed_above(inv1, 0.5, lookback=1)
    # "EMA21 fiyatı aşağı keser" = fiyat EMA21'i yukarı keser
    price_minus_ema = df["Close"] - ema21
    c2 = crossed_above(price_minus_ema, 0, lookback=1)
    c3 = crossed_above(macdas, 0, lookback=1)
    c4 = cci20.iloc[-1] > -100

    return bool(c1 and c2 and c3 and c4)


def gunluk_analiz_1(df: pd.DataFrame) -> bool:
    inv1 = inv1_series(df, cci_length=13, wma_length=9)
    ema21 = ema_series(df["Close"], 21)
    macdas = macdas_series(df["Close"])
    hlc3 = (df["High"] + df["Low"] + df["Close"]) / 3
    cci20 = cci_series(hlc3, 20)

    c1 = crossed_above(inv1, 0.5, lookback=1)
    c2 = ema21.iloc[-1] < df["Close"].iloc[-1]
    c3 = macdas.iloc[-1] > 0
    c4 = crossed_above(cci20, 100, lookback=1)

    return bool(c1 and c2 and c3 and c4)


FILTERS = {
    "HAFTALIK_1": haftalik_analiz_1,
    "HAFTALIK_2": haftalik_analiz_2,
    "HAFTALIK_3": haftalik_analiz_3,
    "GUNLUK_1":   gunluk_analiz_1,
}

# Hangi filtreler haftalık, hangileri günlük veri istiyor
FILTER_TIMEFRAME = {
    "HAFTALIK_1": "1wk",
    "HAFTALIK_2": "1wk",
    "HAFTALIK_3": "1wk",
    "GUNLUK_1":   "1d",
}