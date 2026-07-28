# python/src/sector_index.py
# Sektör ve endeks (BIST30/50/100/Banka/Sınai/Hizmetler/Teknoloji) üyeliği.
#
# ÖNEMLİ: Hisse başına istek YAPMIYORUZ. borsapy'nin İş Yatırım screener'ı
# sektör bazında, Index sağlayıcısı da endeks bazında TOPLU liste veriyor:
#   - bp.sectors() -> tüm sektör adları (örn. ~20-30 tane)
#   - Screener().set_sector(ad).run() -> o sektördeki TÜM hisseler (tek istek)
#   - bp.Index(kod).components -> o endeksteki TÜM hisseler (tek istek)
# Yani 574 hisse yerine sadece (sektör sayısı + endeks sayısı) kadar istek atıyoruz.

from datetime import datetime, timezone
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


def run_sync_sectors():
    """stocks.sector kolonunu, İş Yatırım'ın sektör bazında toplu taramasıyla doldurur."""
    try:
        sector_names = bp.sectors()
    except Exception as err:
        print(f"❌ Sektör listesi alınamadı: {err}")
        return {"updated": 0}

    print(f"🏷️  {len(sector_names)} sektör bulundu, taranıyor...")

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

    print(f"✅ Sektör senkronizasyonu tamamlandı: {updated} hisse güncellendi")
    return {"updated": updated}


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
