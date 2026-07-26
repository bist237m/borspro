# python/src/news.py
# KAP haberlerini çeker (borsapy'nin ticker.news özelliği).
# Ayrı, periyodik çalışan bir script — ana --scan'e dahil değil.
#
# NOT: KAP sunucusu çok sık istek atınca bağlantıyı kesiyor
# ("Server disconnected"). Bunu önlemek için:
#   - istekler arası bekleme artırıldı (0.2sn -> 1.2sn)
#   - her hisse için 1 kere daha yeniden deneniyor

import time
from datetime import datetime
import borsapy as bp
from db import get_connection

MAX_PER_STOCK = 10
DELAY_SECONDS = 1.2
RETRY_DELAY_SECONDS = 4


def parse_date(date_str):
    try:
        return datetime.strptime(date_str.strip(), "%d.%m.%Y %H:%M:%S")
    except Exception:
        return None


def fetch_news_with_retry(symbol):
    """Bir kere dener, başarısız olursa biraz bekleyip bir kere daha dener."""
    try:
        return bp.Ticker(symbol).news
    except Exception as err:
        print(f"   ⚠️  {symbol}: ilk deneme başarısız ({err}), {RETRY_DELAY_SECONDS}sn sonra tekrar denenecek...")
        time.sleep(RETRY_DELAY_SECONDS)
        return bp.Ticker(symbol).news  # ikinci deneme — hata olursa yukarı fırlar


def fetch_and_save(cur, stock_id, symbol):
    df = fetch_news_with_retry(symbol)
    if df is None or len(df) == 0:
        return 0

    saved = 0
    for _, row in df.head(MAX_PER_STOCK).iterrows():
        title = row.get("Title")
        url = row.get("URL")
        published_at = parse_date(str(row.get("Date", "")))
        if not title or not url:
            continue

        cur.execute(
            """
            INSERT INTO stock_news (stock_id, title, published_at, url)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (stock_id, url) DO NOTHING
            """,
            (stock_id, title, published_at, url),
        )
        saved += 1

    return saved


def run_fetch_news():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            print(f"📰 KAP haberleri çekiliyor — {len(stocks)} hisse")

            total, errors = 0, 0
            for i, (stock_id, symbol) in enumerate(stocks):
                try:
                    count = fetch_and_save(cur, stock_id, symbol)
                    conn.commit()
                    total += count
                except Exception as err:
                    conn.rollback()
                    errors += 1
                    print(f"   ❌ {symbol}: {err}")

                if (i + 1) % 20 == 0:
                    print(f"   {i + 1}/{len(stocks)} tamamlandı...")

                time.sleep(DELAY_SECONDS)

    print(f"\n✅ KAP haberleri tamamlandı: {total} haber kaydedildi, {errors} hata")
    return {"total": total, "errors": errors}


if __name__ == "__main__":
    run_fetch_news()
