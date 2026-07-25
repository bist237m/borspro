# python/src/custom_indicators.py
# borsapy'de HAZIR OLMAYAN özel göstergeler.
# Standart olanlar (RSI, MACD, SMA, Bollinger, Stochastic, ADX) için
# bu dosyayı kullanmıyoruz — onlar doğrudan borsapy'den geliyor.

import math
import pandas as pd


def _wma(series: pd.Series, length: int):
    if len(series) < length:
        return None
    weights = list(range(1, length + 1))
    window = series.iloc[-length:]
    return sum(w * v for w, v in zip(weights, window)) / sum(weights)


def _rsi_series(closes: pd.Series, length: int) -> pd.Series:
    """Basit RSI serisi (IFT COMBO'nun iç hesaplaması için) — borsapy'nin
    kendi rsi()'ından bağımsız, çünkü burada tam seri (Series) gerekiyor."""
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(length).mean()
    avg_loss = loss.rolling(length).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def calc_ift_combo(df: pd.DataFrame) -> dict | None:
    """
    IFT COMBO — CCI, RSI, Stochastic ve MFI'nin Inverse Fisher Transform
    ile birleştirilmiş hali. Bizim özel göstergemiz, borsapy'de yok.

    df: 'Open','High','Low','Close','Volume' kolonlarını içeren DataFrame
        (borsapy'nin history() çıktısıyla birebir uyumlu).
    """
    if len(df) < 30:
        return None

    closes = df["Close"]
    highs = df["High"]
    lows = df["Low"]
    volumes = df["Volume"].fillna(1)

    wma_len = 9

    def ift(x):
        return (math.exp(2 * x) - 1) / (math.exp(2 * x) + 1)

    # CCI serisi (5 periyot, IFT için ölçeklenmiş)
    tp = (highs + lows + closes) / 3
    tp_sma = tp.rolling(5).mean()
    tp_mad = tp.rolling(5).apply(lambda x: (x - x.mean()).abs().mean(), raw=False)
    cci_raw = (tp - tp_sma) / (0.015 * tp_mad.replace(0, float("nan")))
    cci_series = (0.1 * cci_raw / 4).fillna(0)

    # RSI serisi (5 periyot, ölçeklenmiş)
    rsi5 = _rsi_series(closes, 5)
    rsi_series = 0.1 * (rsi5 - 50)

    # Stochastic serisi (5 periyot, ölçeklenmiş)
    hh = highs.rolling(5).max()
    ll = lows.rolling(5).min()
    stoch_raw = ((closes - ll) / (hh - ll).replace(0, float("nan"))) * 100
    stoch_series = (0.1 * (stoch_raw - 50)).fillna(0)

    # MFI serisi (5 periyot, ölçeklenmiş)
    hlc3 = (highs + lows + closes) / 3
    mf = hlc3 * volumes
    hlc3_diff = hlc3.diff()
    pos_mf = mf.where(hlc3_diff > 0, 0.0).rolling(5).sum()
    neg_mf = mf.where(hlc3_diff < 0, 0.0).rolling(5).sum()
    mfr = pos_mf / neg_mf.replace(0, float("nan"))
    mfi_series = (0.1 * (100 - 100 / (1 + mfr) - 50)).fillna(5.0)

    ift_cci = ift(_wma(cci_series, wma_len)) if _wma(cci_series, wma_len) is not None else None
    ift_rsi = ift(_wma(rsi_series, wma_len)) if _wma(rsi_series, wma_len) is not None else None
    ift_stoch = ift(_wma(stoch_series, wma_len)) if _wma(stoch_series, wma_len) is not None else None
    ift_mfi = ift(_wma(mfi_series, wma_len)) if _wma(mfi_series, wma_len) is not None else None

    vals = [v for v in [ift_cci, ift_rsi, ift_stoch, ift_mfi] if v is not None]
    if not vals:
        return None
    avg = sum(vals) / len(vals)

    signal = "neutral"
    if avg > 0.5:
        signal = "overbought"
    elif avg < -0.5:
        signal = "oversold"

    return {
        "cci": ift_cci,
        "rsi": ift_rsi,
        "stoch": ift_stoch,
        "mfi": ift_mfi,
        "avg": avg,
        "signal": signal,
    }
