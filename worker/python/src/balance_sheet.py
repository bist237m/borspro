# python/src/balance_sheet.py
# Bilanço (dönemsel) verisi — borsapy'nin get_balance_sheet() fonksiyonundan.
#
# ÖNEMLİ TASARIM KARARI: Bilanço kalemleri (Toplam Varlıklar, Özkaynaklar vb.)
# şirketten şirkete/sektörden sektöre değişen onlarca satır içeriyor, üstelik
# bankalar (UFRS) ile sanayi şirketleri (XI_29) FARKLI formatlar kullanıyor.
# Sabit kolonlar tahmin edip yanlış isim yüzünden tüm taramayı çökertmek yerine
# (bkz. daha önceki revenue_yoy_growth hatası), ham veriyi JSON olarak saklıyoruz.
# AI tarafı zaten Türkçe muhasebe terimlerini anlıyor, ham JSON'u doğrudan
# yorumlayabiliyor — bizim kod tarafında kolon eşlemesi yapmamıza gerek yok.
#
# HIZLANDIRMA: history.py/scan.py gibi, ağ istekleri (yavaş kısım) paralel
# (ThreadPoolExecutor), veritabanı yazımı tek thread'de (ana thread) yapılıyor.
# Her hisse SAVEPOINT ile izole ediliyor — biri patlarsa diğerleri etkilenmez.

import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import get_connection

MAX_WORKERS = 8  # bilanço istekleri normal fiyat isteklerinden daha ağır, düşük tutuyoruz


def _clean_value(v):
    """NaN/None/numpy tiplerini JSON-uyumlu float'a çevirir."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def fetch_balance_sheet_data(symbol: str):
    """Bir hissenin en güncel 2 çeyreklik bilançosunu çeker.
    Önce sanayi şirketi formatını (XI_29, varsayılan) dener; boş dönerse
    bankacılık formatını (UFRS) dener. İkisi de boşsa None döner."""
    df = None
    financial_group_used = "XI_29"
    try:
        df = bp.Ticker(symbol).get_balance_sheet(quarterly=True, last_n=2)
    except Exception:
        df = None

    if df is None or df.empty:
        try:
            df = bp.Ticker(symbol).get_balance_sheet(quarterly=True, last_n=2, financial_group="UFRS")
            financial_group_used = "UFRS"
        except Exception:
            df = None

    if df is None or df.empty:
        return None

    periods = list(df.columns)
    if not periods:
        return None

    latest_period = periods[-1]
    prev_period = periods[-2] if len(periods) > 1 else None

    latest_data = {str(k): _clean_value(v) for k, v in df[latest_period].dropna().to_dict().items()}
    prev_data = {str(k): _clean_value(v) for k, v in df[prev_period].dropna().to_dict().items()} if prev_period is not None else {}

    return {
        "financial_group": financial_group_used,
        "period": str(latest_period),
        "prev_period": str(prev_period) if prev_period is not None else None,
        "data": latest_data,
        "prev_data": prev_data,
    }


def save_balance_sheet(cur, stock_id, result):
    payload = json.dumps({"data": result["data"], "prev_data": result["prev_data"], "prev_period": result["prev_period"]}, ensure_ascii=False)
    cur.execute(
        """
        UPDATE fundamentals_snapshots SET
          balance_sheet_json   = %s,
          balance_sheet_period = %s,
          financial_group      = %s,
          updated_at           = NOW()
        WHERE stock_id = %s
        """,
        (payload, result["period"], result["financial_group"], stock_id),
    )
    # Hissenin fundamentals_snapshots'ta hiç satırı yoksa UPDATE hiçbir şey etkilemez —
    # bu durumda en azından stock_id'yi kaydeden bir satır açıyoruz.
    if cur.rowcount == 0:
        cur.execute(
            """
            INSERT INTO fundamentals_snapshots (stock_id, balance_sheet_json, balance_sheet_period, financial_group, updated_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (stock_id) DO UPDATE SET
              balance_sheet_json   = EXCLUDED.balance_sheet_json,
              balance_sheet_period = EXCLUDED.balance_sheet_period,
              financial_group       = EXCLUDED.financial_group,
              updated_at            = NOW()
            """,
            (stock_id, payload, result["period"], result["financial_group"]),
        )


def run_fetch_balance_sheets():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            print(f"📑 Bilanço verisi çekiliyor — {len(stocks)} hisse ({MAX_WORKERS} paralel)")

            saved, skipped, errors = 0, 0, 0
            completed = 0

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(fetch_balance_sheet_data, symbol): (stock_id, symbol) for stock_id, symbol in stocks}

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    try:
                        result = future.result()
                        if result is None:
                            skipped += 1
                            continue

                        cur.execute("SAVEPOINT sp_balance_sheet")
                        try:
                            save_balance_sheet(cur, stock_id, result)
                            cur.execute("RELEASE SAVEPOINT sp_balance_sheet")
                            saved += 1
                        except Exception as err:
                            cur.execute("ROLLBACK TO SAVEPOINT sp_balance_sheet")
                            errors += 1
                            print(f"   ❌ {symbol}: {err}")
                    except Exception as err:
                        errors += 1
                        print(f"   ❌ {symbol} (ağ hatası): {err}")

                    if completed % 50 == 0:
                        print(f"   {completed}/{len(stocks)} tamamlandı...")

            conn.commit()

    print(f"\n✅ Bilanço taraması tamamlandı: {saved} kaydedildi, {skipped} veri yok, {errors} hata")
    return {"saved": saved, "skipped": skipped, "errors": errors}


if __name__ == "__main__":
    run_fetch_balance_sheets()
