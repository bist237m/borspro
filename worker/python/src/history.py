# python/src/history.py
# Kayıtlı hisselerin geçmiş OHLCV verisini borsapy'den çekip price_history'e yazar.
#
# HIZLANDIRMA: Eskiden 574 hisse TEK TEK, aralarına 0.2sn bekleme konularak
# seri çekiliyordu (~10-15 dk). scan.py'deki desenle aynı mantık: ağ istekleri
# (yavaş kısım) ThreadPoolExecutor ile paralel, veritabanı yazımı tek thread'de
# (ana thread) SAVEPOINT ile izole ediliyor — biri patlarsa diğerleri etkilenmez.

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import query, get_connection
from net_utils import throttled_retry
import psycopg2.extras

MAX_WORKERS = 3  # TradingView 10 paralel isteği 429 (rate limit) ile karşılıyor
                 # ve bu bazen "invalid symbol" gibi görünen ikincil hatalara da
                 # yol açıyor (aşırı yüklenmiş oturumlar). Düşürüldü; ayrıca her
                 # istek net_utils.throttled_retry'dan geçiyor.


def pd_isna(value) -> bool:
    try:
        import math
        return value is None or (isinstance(value, float) and math.isnan(value))
    except Exception:
        return value is None


def fetch_history_data(symbol: str, period: str):
    """SADECE ağ isteği — veritabanına dokunmuyor, paralel/thread-safe.
    Barları (stock_id olmadan) hazır tuple listesi olarak döndürür.
    Hız sınırı ve 429 tekrar denemesi net_utils.throttled_retry'da."""
    df = throttled_retry(lambda: bp.Ticker(symbol).history(period=period))
    records = []
    for date, bar in df.iterrows():
        records.append((
            date.date(),
            float(bar["Open"]),
            float(bar["High"]),
            float(bar["Low"]),
            float(bar["Close"]),
            int(bar["Volume"]) if not pd_isna(bar["Volume"]) else 0,
        ))
    return records


def save_history(cur, stock_id, records):
    if not records:
        return
    rows = [(stock_id, *r) for r in records]
    insert_query = """
        INSERT INTO price_history (stock_id, price_date, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (stock_id, price_date) DO UPDATE SET
          open   = EXCLUDED.open,
          high   = EXCLUDED.high,
          low    = EXCLUDED.low,
          close  = EXCLUDED.close,
          volume = EXCLUDED.volume
    """
    psycopg2.extras.execute_values(cur, insert_query, rows)


def run_sync_history(period: str = "1y", symbols: list[str] | None = None):
    """Geçmiş OHLCV verisini çeker.

    symbols verilirse SADECE o semboller çekilir — tüm BIST'i (579 hisse,
    ~5-10 dk) taramak yerine ihtiyaç duyulan birkaç hisseyi saniyeler içinde
    güncellemek için. period'u da kısaltmak isteyebilirsin ("1mo" gibi):
    sadece son günler eksikse 1 yıllık veri indirmek gereksiz."""
    if symbols:
        stocks = query(
            "SELECT id, symbol FROM stocks WHERE is_active = TRUE AND symbol = ANY(%s) ORDER BY symbol",
            (list(symbols),),
        )
    else:
        stocks = query("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
    print(f"📅 Geçmiş veri senkronizasyonu ({period}) — {len(stocks)} hisse ({MAX_WORKERS} paralel)")

    started = time.time()
    total, errors, completed = 0, 0, 0

    # ÖNEMLİ — bağlantıyı ağ beklemesi boyunca AÇIK TUTMUYORUZ.
    # Eskiden tek bir DB bağlantısı taramanın tamamı (5-10 dk) boyunca açık
    # kalıyordu, ama o sürenin neredeyse tamamında sadece ağdan veri
    # bekleniyordu. Supabase pooler'ı boşta duran bağlantıyı kesiyor ve
    # ardından "cursor already closed" / "connection already closed" zinciri
    # geliyordu. Şimdi: sonuçlar bellekte biriktirilir, her BATCH_SIZE hissede
    # bir KISA ÖMÜRLÜ bağlantı açılıp yazılır ve hemen kapatılır.
    BATCH_SIZE = 25
    buffer = []   # (stock_id, records) listesi

    def flush(buf):
        """Biriken kayıtları tek kısa bağlantıda yazar. Yazılan bar sayısını
        ve hata sayısını döndürür."""
        if not buf:
            return 0, 0
        written, failed = 0, 0
        with get_connection() as conn:
            with conn.cursor() as cur:
                for stock_id, records in buf:
                    cur.execute("SAVEPOINT sp_history")
                    try:
                        save_history(cur, stock_id, records)
                        cur.execute("RELEASE SAVEPOINT sp_history")
                        written += len(records)
                    except Exception as err:
                        cur.execute("ROLLBACK TO SAVEPOINT sp_history")
                        failed += 1
                        print(f"   ❌ (yazım hatası): {err}")
            conn.commit()
        return written, failed

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        # DİKKAT: db.query() RealDictCursor kullanıyor, yani sözlük listesi
        # döner. "for stock_id, symbol in stocks" şeklinde açmak DEĞERLERİ
        # değil ANAHTARLARI verir ("id", "symbol") — bu yüzden script her hisse
        # için TradingView'a "symbol" adlı sembolü soruyordu ve hep
        # "invalid symbol" alıyordu. Anahtarla erişiyoruz.
        futures = {
            executor.submit(fetch_history_data, row["symbol"], period): (row["id"], row["symbol"])
            for row in stocks
        }

        for future in as_completed(futures):
            stock_id, symbol = futures[future]
            completed += 1
            try:
                records = future.result()
                buffer.append((stock_id, records))
            except Exception as err:
                errors += 1
                print(f"   ❌ {symbol} (ağ hatası): {err}")

            if len(buffer) >= BATCH_SIZE:
                w, f = flush(buffer)
                total += w
                errors += f
                buffer = []

            if completed % 50 == 0:
                elapsed = time.time() - started
                rate = completed / elapsed if elapsed else 0
                remaining = (len(stocks) - completed) / rate if rate else 0
                print(f"   {completed}/{len(stocks)} tamamlandı — tahmini kalan {remaining:.0f}sn")

    # Kalan artıkları yaz
    w, f = flush(buffer)
    total += w
    errors += f

    duration = time.time() - started
    print(f"\n✅ Tamamlandı ({duration:.1f}sn): {total} bar kaydedildi, {errors} hata")
    return {"total": total, "errors": errors, "duration_sec": round(duration, 1)}


if __name__ == "__main__":
    run_sync_history("1y")
