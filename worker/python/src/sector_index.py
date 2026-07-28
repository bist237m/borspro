# python/src/sector_index.py
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import get_connection
import psycopg2.extras  # PostgreSQL batch işlemleri için

INDEX_CODES = {
    "XU030": "BIST 30",
    "XU050": "BIST 50",
    "XU100": "BIST 100",
    "XBANK": "BIST BANKA",
    "XUSIN": "BIST SINAİ",
    "XUHIZ": "BIST HİZMETLER",
    "XUTEK": "BIST TEKNOLOJİ",
}

MAX_WORKERS = 12
RETRY_DELAY_SECONDS = 1.5


def _fetch_sector_per_stock(symbol: str):
    """Yedek plan: KAP üzerinden hisse başına sektör bilgisi."""
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
    Önce tüm listeyi tek istekte Screener üzerinden çekmeyi dener."""
    
    # 1. DENEME: Tüm hisseleri Screener üzerinden tek hamlede çek
    try:
        print("🏷️  Tüm sektörler İş Yatırım Screener üzerinden toplu çekiliyor...")
        df = bp.Screener().run()  # Filtresiz tüm hisseler
        if df is not None and not df.empty and "symbol" in df.columns and "sector" in df.columns:
            # Sektörü dolu olanları (symbol, sector) ikilisi olarak al
            sector_data = df.dropna(subset=["sector"])[["symbol", "sector"]].to_dict("records")
            if sector_data:
                result = _update_sectors_in_db(sector_data)
                if result["updated"] > 0:
                    return result
    except Exception as err:
        print(f"⚠️  Screener toplu çekim başarısız ({err}), eski toplu yönteme geçiliyor...")

    # 2. DENEME: bp.sectors() ile sektör bazlı tarama
    try:
        sector_names = bp.sectors()
        if sector_names:
            print(f"🏷️  {len(sector_names)} sektör bulundu, taranıyor...")
            result = _sync_sectors_bulk(sector_names)
            if result["updated"] > 0:
                return result
    except Exception as err:
        print(f"⚠️  Sektör listesi alınamadı ({err}).")

    # 3. DENEME (Fallback): KAP üzerinden tek tek paralel çekim
    print("⚠️  Toplu yöntemler başarısız oldu, KAP fallback'ine geçiliyor...")
    return _sync_sectors_per_stock()


def _update_sectors_in_db(symbol_sector_list):
    """Verilen [{'symbol': 'THYAO', 'sector': 'Ulaştırma'}, ...] listesini 
    tek bir BATCH UPDATE sorgusuyla DB'de günceller."""
    if not symbol_sector_list:
        return {"updated": 0}

    with get_connection() as conn:
        with conn.cursor() as cur:
            # PostgreSQL BATCH UPDATE
            query = """
                UPDATE stocks AS s
                SET sector = v.sector
                FROM (VALUES %s) AS v(symbol, sector)
                WHERE s.symbol = v.symbol AND s.is_active = TRUE;
            """
            data_tuples = [(item["symbol"], item["sector"]) for item in symbol_sector_list]
            
            psycopg2.extras.execute_values(cur, query, data_tuples)
            updated_count = cur.rowcount

        conn.commit()

    print(f"✅ Sektörler toplu güncellendi: {updated_count} hisse")
    return {"updated": updated_count}


def _sync_sectors_bulk(sector_names):
    """Sektör adları üzerinden tek tek Screener tatar ve toplu DB'ye yazar."""
    records_to_update = []
    
    for sector_name in sector_names:
        try:
            df = bp.Screener().set_sector(sector_name).run()
            if df is not None and not df.empty and "symbol" in df.columns:
                symbols = df["symbol"].tolist()
                for sym in symbols:
                    records_to_update.append({"symbol": sym, "sector": sector_name})
        except Exception as err:
            print(f"   ❌ {sector_name}: {err}")
            continue

    return _update_sectors_in_db(records_to_update)


def _sync_sectors_per_stock():
    """Yedek plan: Sadece sektörü BOŞ olan hisseleri KAP'tan paralel çeker."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, symbol FROM stocks WHERE is_active = TRUE AND sector IS NULL ORDER BY symbol"
            )
            stocks = cur.fetchall()

            if not stocks:
                print("✅ Tüm hisselerin sektörü zaten dolu.")
                return {"updated": 0, "skipped": 0}

            print(f"🏷️  KAP üzerinden {len(stocks)} hisse çekiliyor ({MAX_WORKERS} paralel worker)...")

            to_update = []
            skipped, completed = 0, 0

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(_fetch_sector_per_stock, symbol): (stock_id, symbol) for stock_id, symbol in stocks}

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    
                    sector_name, err = future.result()
                    if sector_name:
                        to_update.append((stock_id, sector_name))
                    else:
                        skipped += 1

                    if completed % 100 == 0:
                        print(f"   {completed}/{len(stocks)} tamamlandı...")

            # DB Güncellemesi (Tüm thread'ler bitince BATCH olarak)
            if to_update:
                update_query = """
                    UPDATE stocks AS s
                    SET sector = v.sector
                    FROM (VALUES %s) AS v(id, sector)
                    WHERE s.id = v.id;
                """
                psycopg2.extras.execute_values(cur, update_query, to_update)

        conn.commit()

    print(f"✅ Sektör KAP fallback tamamlandı: {len(to_update)} güncellendi, {skipped} boş kalındı.")
    return {"updated": len(to_update), "skipped": skipped}


def run_sync_indices():
    """stock_indices tablosunu BATCH UPSERT ile doldurur."""
    run_started_at = datetime.now(timezone.utc)

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE")
            symbol_to_id = {symbol: stock_id for stock_id, symbol in cur.fetchall()}

            upsert_tuples = []
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
                    if stock_id:
                        upsert_tuples.append((stock_id, code))

            # BATCH UPSERT (Tek hamlede tüm endeks ilişkilerini kaydet)
            if upsert_tuples:
                upsert_query = """
                    INSERT INTO stock_indices (stock_id, index_code, updated_at)
                    VALUES %s
                    ON CONFLICT (stock_id, index_code) DO UPDATE SET updated_at = NOW()
                """
                psycopg2.extras.execute_values(cur, upsert_query, upsert_tuples)

            # Bu çalışmada güncellenmeyen eski üyelikleri temizle
            cur.execute("DELETE FROM stock_indices WHERE updated_at < %s", (run_started_at,))
            removed = cur.rowcount

        conn.commit()

    print(f"✅ Endeks senkronizasyonu tamamlandı: {len(upsert_tuples)} üyelik işlendi, {removed} eski üyelik silindi.")
    return {"memberships": len(upsert_tuples), "removed": removed}


def run_sync_sector_index():
    sectors_result = run_sync_sectors()
    indices_result = run_sync_indices()
    return {**sectors_result, **indices_result}


if __name__ == "__main__":
    run_sync_sector_index()