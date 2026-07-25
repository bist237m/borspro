# python/src/scan.py
# Tam BIST taraması. Standart sinyaller borsapy'den (TradingView motoru),
# özel gösterge (IFT COMBO) bizim custom_indicators.py'den geliyor.

import borsapy as bp
from db import query, execute
from custom_indicators import calc_ift_combo


def comment_for(signal_type: str, value) -> str:
    texts = {
        "RSI_OVERSOLD":   f"RSI {value:.1f} ile aşırı satım bölgesinde.",
        "RSI_OVERBOUGHT": f"RSI {value:.1f} ile aşırı alım bölgesinde.",
        "TV_STRONG_BUY":  "TradingView göstergeleri güçlü AL sinyali veriyor.",
        "TV_STRONG_SELL": "TradingView göstergeleri güçlü SAT sinyali veriyor.",
        "IFT_OVERSOLD":   f"IFT COMBO {value:.3f} — aşırı satımı teyit ediyor.",
        "IFT_OVERBOUGHT": f"IFT COMBO {value:.3f} — aşırı alımı teyit ediyor.",
    }
    return texts.get(signal_type, signal_type)


def score_for(signals: list) -> int:
    weights = {"strong": 30, "moderate": 15}
    total = sum(weights.get(s["strength"], 10) for s in signals)
    return min(total, 100)


def scan_one(symbol: str) -> dict:
    stock = bp.Ticker(symbol)
    signals = []

    # 1) RSI — borsapy'den hazır değer
    rsi_value = stock.rsi()
    if rsi_value is not None:
        if rsi_value < 30:
            signals.append({"type": "RSI_OVERSOLD", "value": rsi_value, "dir": "bullish",
                             "strength": "strong" if rsi_value < 20 else "moderate"})
        elif rsi_value > 70:
            signals.append({"type": "RSI_OVERBOUGHT", "value": rsi_value, "dir": "bearish",
                             "strength": "strong" if rsi_value > 80 else "moderate"})

    # 2) TradingView'ın kendi genel tavsiyesi (STRONG_BUY / STRONG_SELL uçları)
    ta = stock.ta_signals()
    recommendation = ta.get("summary", {}).get("recommendation")
    if recommendation == "STRONG_BUY":
        signals.append({"type": "TV_STRONG_BUY", "value": 1, "dir": "bullish", "strength": "strong"})
    elif recommendation == "STRONG_SELL":
        signals.append({"type": "TV_STRONG_SELL", "value": 1, "dir": "bearish", "strength": "strong"})

    # 3) Özel gösterge: IFT COMBO (borsapy'de yok, kendimiz hesaplıyoruz)
    history_df = stock.history(period="1y")
    ift = calc_ift_combo(history_df) if history_df is not None and len(history_df) else None
    if ift and ift["signal"] == "oversold":
        signals.append({"type": "IFT_OVERSOLD", "value": ift["avg"], "dir": "bullish",
                         "strength": "strong" if abs(ift["avg"]) > 0.7 else "moderate"})
    elif ift and ift["signal"] == "overbought":
        signals.append({"type": "IFT_OVERBOUGHT", "value": ift["avg"], "dir": "bearish",
                         "strength": "strong" if abs(ift["avg"]) > 0.7 else "moderate"})

    if not signals:
        return {"symbol": symbol, "status": "no_signal"}

    comment = " | ".join(comment_for(s["type"], s["value"]) for s in signals)
    score = score_for(signals)
    signal_types = ",".join(s["type"] for s in signals)
    direction = signals[0]["dir"]

    save_signal(symbol, signal_types, direction, score, comment)

    return {"symbol": symbol, "status": "signal", "signals": [s["type"] for s in signals], "score": score}


def save_signal(symbol: str, signal_types: str, direction: str, score: int, comment: str):
    rows = query("SELECT id FROM stocks WHERE symbol = %s", (symbol,))
    if not rows:
        return
    stock_id = rows[0]["id"]

    signal_id = execute_returning_signal(stock_id, signal_types, direction, score, comment)

    execute(
        """
        INSERT INTO watchlist_items (watchlist_id, stock_id, auto_comment, signal_id, added_at)
        SELECT w.id, %s, %s, %s, NOW()
        FROM watchlists w
        WHERE w.is_default = TRUE
        ON CONFLICT (watchlist_id, stock_id) DO UPDATE SET
          auto_comment = EXCLUDED.auto_comment,
          signal_id    = EXCLUDED.signal_id,
          updated_at   = NOW()
        """,
        (stock_id, comment, signal_id),
    )


def execute_returning_signal(stock_id, signal_types, direction, score, comment):
    from db import get_connection
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO signals (stock_id, signal_types, direction, score, comment, scanned_at, scan_date)
                VALUES (%s, %s, %s, %s, %s, NOW(), CURRENT_DATE)
                ON CONFLICT (stock_id, scan_date) DO UPDATE SET
                  signal_types = EXCLUDED.signal_types,
                  direction    = EXCLUDED.direction,
                  score        = EXCLUDED.score,
                  comment      = EXCLUDED.comment,
                  scanned_at   = NOW()
                RETURNING id
                """,
                (stock_id, signal_types, direction, score, comment),
            )
            row = cur.fetchone()
        conn.commit()
        return row[0] if row else None


def run_full_scan():
    stocks = query("SELECT symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"🔍 Tam tarama başladı — {len(stocks)} hisse")

    results = {"total": len(stocks), "signals": 0, "skipped": 0, "errors": 0}

    for i, row in enumerate(stocks):
        symbol = row["symbol"]
        try:
            res = scan_one(symbol)
            if res["status"] == "signal":
                results["signals"] += 1
        except Exception as err:
            results["errors"] += 1
            print(f"   ❌ {symbol}: {err}")

        if i % 10 == 0:
            print(f"   {i}/{len(stocks)} tamamlandı...")

    print(f"✅ Tarama tamamlandı: {results}")
    return results


if __name__ == "__main__":
    run_full_scan()