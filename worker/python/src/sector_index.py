# python/src/sector_index.py
# Sektör ve endeks (BIST30/50/100/Banka/Sınai/Hizmetler/Teknoloji) üyeliği.
#
# ÖNEMLİ: Hisse başına istek YAPMIYORUZ (mümkün olduğunda). borsapy'nin İş
# Yatırım screener'ı sektör bazında, Index sağlayıcısı da endeks bazında
# TOPLU liste veriyor:
#   - bp.sectors() -> tüm sektör adları (örn. ~20-30 tane)
#   - Screener().set_sector(ad).run() -> o sektördeki TÜM hisseler (tek istek)
#   - bp.Index(kod).components -> o endeksteki TÜM hisseler (tek istek)
#
# BİLİNEN KIRILGANLIK: bp.sectors(), İş Yatırım'ın sayfasından sabit bir
# ASP.NET dropdown ID'sini scrape ediyor. Bu ID sayfa her güncellendiğinde
# değişebiliyor ve borsapy bu durumda HATA FIRLATMIYOR, sessizce boş liste
# döndürüyor. Bu yüzden bulk yöntem boş dönerse, hisse başına (yavaş ama
# çalışan) KAP tabanlı Ticker(symbol).info["sector"] yöntemine otomatik
# düşüyoruz (aynı KAP altyapısı bilanço verisinde de kullanılıyor, çalıştığı
# doğrulandı).

from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import get_connection

# borsapy'nin İş Yatırım Index sağlayıcısındaki bilinen endeks kodları.
INDEX_CODES = {
    "XU030": "BIST 30",
    "XU050": "BIST 50",
    "XU100": "BIST 100",
    "XBANK": "BIST BANKA",
    "XUSIN": "BIST SINAİ",
    "XUHIZ": "BIST HİZMETLER",
    "XUTEK": "BIST TEKNOLOJİ",
}

MAX_WORKERS = 10  # KAP muhtemelen hız sınırı uyguluyor — 15 çok agresif olabilir, düşürüldü
RETRY_DELAY_SECONDS = 2


def _fetch_sector_per_stock(symbol: str):
    """Yedek plan: KAP üzerinden hisse başına sektör bilgisi.
    (sector, error) tuple döner — error None ise başarılı demektir.
    Geçici hatalarda (ağ/timeout) bir kere daha dener."""
    import time
    try:
        sector = bp.Ticker(symbol).info.get("sector")
        return (sector, None)
    except Exception as first_err:
        time.sleep(RETRY_DELAY_SECONDS)
        try:
            sector = bp.Ticker(symbol).info.get("sector")
            return (sector, None)
        except Exception as second_err:
            return (None, str(second_err) or str(first_err))


def run_sync_sectors():
    """stocks.sector kolonunu doldurur.
    Önce hızlı toplu yöntemi dener (bp.sectors() + set_sector tarama);
    o boş/başarısız dönerse hisse başına KAP fallback'ine geçer."""
    try:
        sector_names = bp.sectors()
    except Exception as err:
        print(f"⚠️  Toplu sektör listesi alınamadı ({err}), KAP fallback'ine geçiliyor...")
        sector_names = []

    if sector_names:
        print(f"🏷️  {len(sector_names)} sektör bulundu (toplu yöntem), taranıyor...")
        result = _sync_sectors_bulk(sector_names)
        if result["updated"] > 0:
            return result
        print("⚠️  Toplu yöntem 0 hisse güncelledi, KAP fallback'ine geçiliyor...")
    else:
        print("⚠️  Toplu sektör listesi boş döndü (İş Yatırım sayfa yapısı değişmiş olabilir), KAP fallback'ine geçiliyor...")

    return _sync_sectors_per_stock()


def _sync_sectors_bulk(sector_names):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE")
            symbol_to_id = {symbol: stock_id for stock_id, symbol in cur.fetchall()}

            updated = 0
            for sector_name in sector_names:
                try:
                    df = bp.Screener().set_sector(sector_name).run()
                except Exception as err:
                    print(f"   ❌ {sector_name}: {err}")
                    continue

                if df is None or df.empty or "symbol" not in df.columns:
                    continue

                symbols = df["symbol"].tolist()
                print(f"   📁 {sector_name}: {len(symbols)} hisse")

                for symbol in symbols:
                    stock_id = symbol_to_id.get(symbol)
                    if not stock_id:
                        continue
                    try:
                        cur.execute("SAVEPOINT sp_sector")
                        cur.execute("UPDATE stocks SET sector = %s WHERE id = %s", (sector_name, stock_id))
                        cur.execute("RELEASE SAVEPOINT sp_sector")
                        updated += 1
                    except Exception as err:
                        cur.execute("ROLLBACK TO SAVEPOINT sp_sector")
                        print(f"   ❌ {symbol}: {err}")

        conn.commit()

    print(f"✅ Sektör senkronizasyonu (toplu) tamamlandı: {updated} hisse güncellendi")
    return {"updated": updated}


def _sync_sectors_per_stock():
    """Yedek plan: her hisse için KAP'tan sektör çek (paralel).
    Sadece sector'ü BOŞ olan hisseleri işler — ilk çalıştırmadan sonra
    (yeni hisse eklenmediği sürece) tekrar çalıştırmalar neredeyse anında biter."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, symbol FROM stocks WHERE is_active = TRUE AND sector IS NULL ORDER BY symbol"
            )
            stocks = cur.fetchall()

            if not stocks:
                print("✅ Tüm hisselerin sektörü zaten dolu, çekilecek bir şey yok.")
                return {"updated": 0, "skipped": 0}

            print(f"🏷️  KAP üzerinden {len(stocks)} hisse için sektör çekiliyor ({MAX_WORKERS} paralel)...")

            updated, skipped, completed = 0, 0, 0
            error_samples = {}  # hata mesajı -> kaç hissede görüldü (teşhis için)

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(_fetch_sector_per_stock, symbol): (stock_id, symbol) for stock_id, symbol in stocks}

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    try:
                        sector_name, err = future.result()
                        if err:
                            short_err = str(err)[:120]
                            error_samples[short_err] = error_samples.get(short_err, 0) + 1
                        if not sector_name:
                            skipped += 1
                            continue

                        cur.execute("SAVEPOINT sp_sector_kap")
                        try:
                            cur.execute("UPDATE stocks SET sector = %s WHERE id = %s", (sector_name, stock_id))
                            cur.execute("RELEASE SAVEPOINT sp_sector_kap")
                            updated += 1
                        except Exception as err:
                            cur.execute("ROLLBACK TO SAVEPOINT sp_sector_kap")
                            print(f"   ❌ {symbol}: {err}")
                    except Exception as err:
                        print(f"   ❌ {symbol} (KAP hatası): {err}")

                    if completed % 100 == 0:
                        print(f"   {completed}/{len(stocks)} tamamlandı...")

            conn.commit()

    print(f"✅ Sektör senkronizasyonu (KAP fallback) tamamlandı: {updated} güncellendi, {skipped} veri yok")
    if error_samples:
        print("📋 Görülen hata türleri (teşhis için):")
        for msg, count in sorted(error_samples.items(), key=lambda x: -x[1])[:10]:
            print(f"   [{count}x] {msg}")
    return {"updated": updated, "skipped": skipped}


def run_sync_indices():
    """stock_indices tablosunu, endeks bazında toplu taramayla doldurur/günceller.
    Bu run'dan ÖNCEKİ üyelikler (artık o endekste olmayanlar) run sonunda temizlenir."""
    run_started_at = datetime.now(timezone.utc)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE")
            symbol_to_id = {symbol: stock_id for stock_id, symbol in cur.fetchall()}

            total_memberships = 0
            for code, label in INDEX_CODES.items():
                try:
                    components = bp.Index(code).components
                except Exception as err:
                    print(f"   ❌ {code} ({label}): {err}")
                    continue

                symbols = [c["symbol"] for c in components] if components else []
                print(f"   📊 {label} ({code}): {len(symbols)} hisse")

                for symbol in symbols:
                    stock_id = symbol_to_id.get(symbol)
                    if not stock_id:
                        continue
                    try:
                        cur.execute("SAVEPOINT sp_index")
                        cur.execute(
                            """
                            INSERT INTO stock_indices (stock_id, index_code, updated_at)
                            VALUES (%s, %s, NOW())
                            ON CONFLICT (stock_id, index_code) DO UPDATE SET updated_at = NOW()
                            """,
                            (stock_id, code),
                        )
                        cur.execute("RELEASE SAVEPOINT sp_index")
                        total_memberships += 1
                    except Exception as err:
                        cur.execute("ROLLBACK TO SAVEPOINT sp_index")
                        print(f"   ❌ {symbol}/{code}: {err}")

            # Bu run'da güncellenmeyen (artık o endekste olmayan) eski üyelikleri temizle.
            cur.execute("DELETE FROM stock_indices WHERE updated_at < %s", (run_started_at,))
            removed = cur.rowcount

        conn.commit()

    print(f"✅ Endeks senkronizasyonu tamamlandı: {total_memberships} üyelik, {removed} eski üyelik temizlendi")
    return {"memberships": total_memberships, "removed": removed}


def run_sync_sector_index():
    sectors_result = run_sync_sectors()
    indices_result = run_sync_indices()
    return {**sectors_result, **indices_result}


if __name__ == "__main__":
    run_sync_sector_index()
