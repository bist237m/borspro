# python/src/sector_index.py
# Sektör ve endeks (BIST30/50/100/Banka/Sınai/Hizmetler/Teknoloji) üyeliği.
#
# ÖNEMLİ: Hisse başına istek YAPMIYORUZ (mümkün olduğunda). borsapy'nin İş
# Yatırım screener'ı sektör bazında, Index sağlayıcısı da endeks bazında
# TOPLU liste veriyor:
#   - Screener().set_sector(ID).run() -> o sektördeki TÜM hisseler (tek istek)
#   - bp.Index(kod).components -> o endeksteki TÜM hisseler (tek istek)
#
# BİLİNEN KIRILGANLIK (ÇÖZÜLDÜ): bp.sectors() ve set_sector(isim), İş
# Yatırım'ın sayfasından sabit bir ASP.NET dropdown ID'sini scrape ederek
# isim->ID çevirisi yapıyor (borsapy/screener.py: set_sector içinde
# self._provider.get_sectors() çağrısı). Bu scraping kırılmış durumda,
# sessizce boş liste dönüyor — set_sector(isim) de bu yüzden başarısız
# oluyordu. ÇÖZÜM: set_sector() zaten ID ile de çağrılabiliyor
# (id.startswith("0") ise isim->ID çevirisini hiç yapmadan direkt kullanıyor).
# Gerçek ID'leri gelismis-hisse-arama.aspx sayfasının select2 dropdown
# HTML'inden (option id'lerinin sonundaki 4 haneli kod) elle çıkardık —
# böylece kırık bp.sectors()'a hiç ihtiyaç duymadan sektör bazlı toplu
# tarama yapabiliyoruz.

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

# gelismis-hisse-arama.aspx sayfasının "Sektör" dropdown'undan (select2 HTML,
# option id'lerinin sonundaki 4 haneli kod) elle çıkarılan gerçek ID eşlemesi.
SECTOR_ID_MAP = {
    "0001": "Bankacılık",
    "0002": "Bilgisayar Toptancılığı",
    "0003": "Boya",
    "0004": "Cam",
    "0005": "Çimento",
    "0006": "Dayanıklı Tüketim",
    "0007": "Demir-Çelik Döküm",
    "0008": "Demir-Çelik Temel",
    "0009": "Deri Giyim",
    "0010": "Eğlence Hizmetleri",
    "0011": "Elektrik Üretim",
    "0012": "Elektrik Enerji Ürt.Teçh/Tesis Kurulum",
    "0013": "Endüstriyel Tekstil",
    "0014": "Fin.Kiralama ve Faktoring",
    "0015": "GYO",
    "0016": "Gıda",
    "0017": "Havayolları ve Hizm.",
    "0018": "Hayvancılık",
    "0019": "Holdingler",
    "0020": "İletişim Cihazları",
    "0021": "İnşaat Malzemeleri",
    "0022": "İnşaat- Taahhüt",
    "0023": "Kablo",
    "0024": "Kağıt Ürünleri",
    "0025": "Kimyasal Ürün",
    "0026": "Kırtasiye",
    "0028": "Medya",
    "0029": "Meşrubat / İçecek",
    "0030": "Mobilya",
    "0031": "Otomotiv",
    "0032": "Otomotiv Lastiği",
    "0033": "Otomotiv Parçası",
    "0034": "Pazarlama",
    "0035": "Perakande - Ticaret",
    "0036": "Petrol",
    "0037": "Sağlık ve İlaç",
    "0038": "Elektrik - Doğalgaz Dağıtım",
    "0039": "Seramik",
    "0040": "Sigorta",
    "0041": "Spor",
    "0042": "Tarım Kimyasalları",
    "0043": "Teknoloji",
    "0045": "Tekstil Entegre",
    "0046": "Turizm",
    "0047": "Yatırım Ortaklıkları",
    "0048": "Ulaştırma-Lojistik",
    "0049": "Diğer",
    "0050": "İletişim",
    "0051": "Aracı Kurumlar",
    "0052": "Madencilik",
    "0053": "Savunma",
    "0054": "Endüstriyel Makine -Teçhizat Üretim",
    "0055": "Varlık Yönetim",
}

MAX_WORKERS = 10  # KAP muhtemelen hız sınırı uyguluyor — 15 çok agresif olabilir, düşürüldü
RETRY_DELAY_SECONDS = 2


def _fetch_sector_per_stock(symbol: str):
    """Son çare yedek plan: KAP üzerinden hisse başına sektör bilgisi.
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
    1) Önce SECTOR_ID_MAP'teki gerçek ID'lerle toplu tarama (hızlı, güvenilir —
       kırık bp.sectors() isim çevirisine hiç ihtiyaç duymuyor).
    2) O da 0 sonuç verirse (örn. API başka bir sebeple değişmişse), hisse
       başına KAP fallback'ine düşer."""
    result = _sync_sectors_bulk_by_id()
    if result["updated"] > 0:
        return result
    print("⚠️  ID tabanlı toplu yöntem de 0 hisse güncelledi, KAP fallback'ine geçiliyor...")
    return _sync_sectors_per_stock()


def _sync_sectors_bulk_by_id():
    print(f"🏷️  {len(SECTOR_ID_MAP)} sektör ID'si ile toplu tarama başlıyor (bp.sectors() atlanıyor)...")
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE")
            symbol_to_id = {symbol: stock_id for stock_id, symbol in cur.fetchall()}

            updated = 0
            for sector_id, sector_name in SECTOR_ID_MAP.items():
                try:
                    df = bp.Screener().set_sector(sector_id).run()
                except Exception as err:
                    print(f"   ❌ {sector_name} ({sector_id}): {err}")
                    continue

                if df is None or df.empty or "symbol" not in df.columns:
                    continue

                symbols = df["symbol"].tolist()
                print(f"   📁 {sector_name} ({sector_id}): {len(symbols)} hisse")

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

    print(f"✅ Sektör senkronizasyonu (ID tabanlı toplu) tamamlandı: {updated} hisse güncellendi")
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
