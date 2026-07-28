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
    bankacılık formatını (UFRS) dener. İkisi de boşsa (result, reason) döner
    — reason, teşhis için gerçek hata mesajını ya da 'no_data' işaretini taşır.
    Geçici ağ/rate-limit hatalarında bir kere daha dener."""
    import time

    def _try_fetch(financial_group=None):
        kwargs = {"quarterly": True, "last_n": 2}
        if financial_group:
            kwargs["financial_group"] = financial_group
        return bp.Ticker(symbol).get_balance_sheet(**kwargs)

    last_err = None
    df = None
    financial_group_used = "XI_29"

    for financial_group, label in [(None, "XI_29"), ("UFRS", "UFRS")]:
        for attempt in range(2):  # 1 deneme + 1 tekrar deneme
            try:
                candidate = _try_fetch(financial_group)
                if candidate is not None and not candidate.empty:
                    df = candidate
                    financial_group_used = label
                    last_err = None
                    break
                last_err = "no_data"  # istek başarılı ama boş sonuç döndü
                break  # boş sonuç tekrar denemekle değişmez, sonraki formata geç
            except Exception as err:
                last_err = str(err)
                if attempt == 0:
                    time.sleep(2)  # geçici hata olabilir, kısa bekleyip tekrar dene
                continue
        if df is not None:
            break

    if df is None:
        return None, (last_err or "no_data")

    periods = list(df.columns)
    if not periods:
        return None, "empty_columns"

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
    }, None


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
            skip_reasons = {}  # sebep -> kaç hissede görüldü + örnek semboller (teşhis için)

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(fetch_balance_sheet_data, symbol): (stock_id, symbol) for stock_id, symbol in stocks}

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    try:
                        result, reason = future.result()
                        if result is None:
                            skipped += 1
                            key = (reason or "no_data")[:120]
                            bucket = skip_reasons.setdefault(key, {"count": 0, "examples": []})
                            bucket["count"] += 1
                            if len(bucket["examples"]) < 5:
                                bucket["examples"].append(symbol)
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
    if skip_reasons:
        print("📋 Veri gelmeyen hisselerin sebep dağılımı (teşhis için):")
        for reason, info in sorted(skip_reasons.items(), key=lambda x: -x[1]["count"])[:10]:
            print(f"   [{info['count']}x] {reason}  — örnek: {', '.join(info['examples'])}")
    return {"saved": saved, "skipped": skipped, "errors": errors}


if __name__ == "__main__":
    run_fetch_balance_sheets()
