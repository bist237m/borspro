# python/src/backfill_realized.py
# TEK SEFERLİK dolgu — realized_price/realized_pct kolonları eklenmeden ÖNCE
# %10'a ulaşmış (milestone_10_at dolu) ama realized_pct'i hâlâ NULL olan
# sinyaller için.
#
# HIZ: Eskiden bu script çalışmadan önce elle `--history` çalıştırmak gerekiyordu
# (579 hisse, ~5-10 dk). Artık SADECE ihtiyaç duyduğu hisselerin (tipik olarak
# 15-20 tane) son 1 aylık verisini kendisi çekiyor — saniyeler sürüyor.
#
# YAKLAŞIKLIK UYARISI: O anın gerçek fiyatı kayıtlı değildi (bu özellik daha
# yeni eklendi). En yakın kaynağımız price_history (günlük OHLCV) —
# milestone_10_at tarihinde ya da ondan SONRAKİ ilk işlem gününde oluşan
# kapanış fiyatını "o anki fiyat" olarak kabul ediyoruz.
#
# Milestone'lar ANLIK fiyattan tetiklendiği için (--sync 30 dk'da bir bakıyor),
# gün içinde %10'u görüp kapanışta geri düşen hisselerde kapanış o anı
# yansıtmaz. Bu durumda hesaplanan değer %10'un altında çıkar ve kayıt
# YAZILMAZ (atlanır) — yanlış veri, hiç veriden kötüdür.
#
# Çalıştır: python backfill_realized.py

from db import get_connection
from history import run_sync_history

HISTORY_PERIOD = "1mo"  # milestone'lar son haftalarda — 1 yıl indirmek gereksiz


def _symbols_needing_history(cur):
    """Dolgu bekleyen kayıtların sembollerini, price_history'de o tarihten
    sonra verisi OLMAYANLARLA sınırlı olarak döndürür."""
    cur.execute(
        """
        SELECT DISTINCT s.symbol
        FROM tracked_signals ts
        JOIN stocks s ON s.id = ts.stock_id
        WHERE ts.milestone_10_at IS NOT NULL
          AND ts.realized_pct IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM price_history ph
            WHERE ph.stock_id = ts.stock_id
              AND ph.price_date >= ts.milestone_10_at::date
          )
        """
    )
    return [r[0] for r in cur.fetchall()]


def run_backfill_realized(fetch_missing: bool = True):
    # ── 1. Eksik geçmiş veriyi SADECE gereken hisseler için çek ──
    if fetch_missing:
        with get_connection() as conn:
            with conn.cursor() as cur:
                missing = _symbols_needing_history(cur)

        if missing:
            print(f"📥 {len(missing)} hissenin geçmiş verisi eksik, çekiliyor: {', '.join(missing)}")
            run_sync_history(period=HISTORY_PERIOD, symbols=missing)
            print()
        else:
            print("✅ Gereken tüm geçmiş veri mevcut, indirmeye gerek yok.\n")

    # ── 2. Dolgu ──
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, stock_id, entry_price, milestone_10_at::date AS m10_date
                FROM tracked_signals
                WHERE milestone_10_at IS NOT NULL
                  AND realized_pct IS NULL
                """
            )
            candidates = cur.fetchall()
            print(f"🔎 {len(candidates)} kayıt bulundu (milestone_10_at dolu, realized_pct boş)")

            filled, skipped = 0, 0
            for tracked_id, stock_id, entry_price, m10_date in candidates:
                cur.execute(
                    """
                    SELECT close, price_date FROM price_history
                    WHERE stock_id = %s AND price_date >= %s
                    ORDER BY price_date ASC
                    LIMIT 1
                    """,
                    (stock_id, m10_date),
                )
                row = cur.fetchone()
                if not row:
                    skipped += 1
                    print(f"   ⚠️  {tracked_id}: {m10_date} sonrası price_history verisi yok, atlandı")
                    continue

                close_price, price_date = row
                entry_price_f = float(entry_price)
                realized_pct = ((float(close_price) - entry_price_f) / entry_price_f * 100) if entry_price_f else 0

                # SAĞLAMA: milestone_10_at o gün tetiklendiyse anlık fiyat >=10 idi.
                # Günlük kapanış bunun altında çıkarsa yazma — küçük tolerans (9.5)
                # yuvarlama farkları için.
                if realized_pct < 9.5:
                    skipped += 1
                    print(f"   ⚠️  {tracked_id}: {price_date} kapanışı sadece %{realized_pct:.2f} veriyor "
                          f"(beklenen >=10, o günkü kapanış tetikleme anını yansıtmıyor) — atlandı")
                    continue

                cur.execute(
                    "UPDATE tracked_signals SET realized_price = %s, realized_pct = %s WHERE id = %s",
                    (close_price, realized_pct, tracked_id),
                )
                filled += 1
                print(f"   ✅ {tracked_id}: {price_date} kapanışı ₺{close_price} -> %{realized_pct:.2f}")

        conn.commit()

    print(f"\n✅ Tamamlandı: {filled} kayıt dolduruldu, {skipped} atlandı")
    if skipped:
        print("   ℹ️  Atlananlar için realized_pct NULL kalır; rapor o satırlarda")
        print("      anlık change_pct'i kullanmaya devam eder.")
    return {"filled": filled, "skipped": skipped}


if __name__ == "__main__":
    run_backfill_realized()
