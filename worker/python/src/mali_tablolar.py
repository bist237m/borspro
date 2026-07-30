# python/src/mali_tablolar.py
# Bilanço + Gelir Tablosu + Nakit Akım Tablosu — sirket-karti.aspx?hisse=SEMBOL
# sayfasından, TEK istekte, hisse başına.
#
# NEDEN borsapy YERİNE BU: borsapy'nin get_balance_sheet() fonksiyonu sadece
# iki financial_group kodu biliyor (XI_29 sanayi, UFRS banka) ve hangisinin
# doğru olduğunu biz deneyerek buluyorduk — bazı şirketlerde (GARAN, KCHOL
# gibi büyük banka/holdingler) ikisi de tutmuyor, boş dönüyordu.
#
# Bu sayfa (sirket-karti.aspx) şirketin türüne göre DOĞRU formatı OTOMATİK
# gösteriyor — AKBNK'de "I. NAKİT DEĞERLER VE MERKEZ BANKASI", "Krediler"
# gibi banka-özel satırlar kendiliğinden çıkıyor, bizim iki formatı elle
# denememize hiç gerek yok. Üstelik bilanço+gelir tablosu+nakit akım
# ÜÇÜ BİRDEN tek sayfada, tek istekte geliyor (borsapy'de üç ayrı çağrı).
#
# Dönem kolonları tahmin edilmiyor — <select id="ddlMaliTabloDonemN"> içindeki
# selected option'dan doğrudan okunuyor (bkz. diagnose script çıktısı:
# ddlMaliTabloDonem1 -> "2026/3" seçili, ddlMaliTabloDonem2 -> "2025/12" vb.).
#
# İSTENEN BÖLÜMLER: Bilanço, Gelir Tablosu, Nakit Akım Tablosu.
# "Dipnot" bölümü sayısal tablo değil (açıklama metni), atlanıyor.

import json
import math
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup
from db import get_connection

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}
URL_TMPL = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse={symbol}"
MAX_WORKERS = 8  # bilanço isteği ağır, düşük tutuyoruz (history.py/balance_sheet.py ile aynı tavan)

WANTED_SECTIONS = {"Bilanço", "Bilano", "Gelir Tablosu", "Nakit Akım Tablosu", "Nakit Akim Tablosu"}
SKIP_SECTIONS = {"Dipnot"}


def _parse_tr_number(text):
    """Türkçe sayı formatını ('1.234.567' ya da '1.234,56') float'a çevirir."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        # Bilanço rakamları genelde tam sayı (nokta binlik ayracı), bazı
        # oranlar virgüllü ondalık olabilir — ikisini de destekle.
        if "," in text:
            return float(text.replace(".", "").replace(",", "."))
        return float(text.replace(".", ""))
    except Exception:
        return None


def _clean_value(v):
    """NaN/None'ı JSON-uyumlu hale getirir."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def fetch_mali_tablo(symbol: str):
    """Bir hissenin bilanço+gelir tablosu+nakit akımını çeker.
    Başarılı olursa (result, None), olmazsa (None, hata_mesajı) döner.
    Geçici ağ hatalarında (timeout/bağlantı) bir kere daha dener."""
    resp = None
    last_err = None
    for attempt in range(2):  # 1 deneme + 1 tekrar deneme
        try:
            resp = requests.get(URL_TMPL.format(symbol=symbol), headers=HEADERS, timeout=30)
            resp.raise_for_status()
            last_err = None
            break
        except Exception as err:
            last_err = str(err)
            resp = None
            if attempt == 0:
                time.sleep(2)  # geçici olabilir, kısa bekleyip tekrar dene
            continue

    if resp is None:
        return None, last_err or "bilinmeyen ağ hatası"

    soup = BeautifulSoup(resp.content, "html.parser")
    tbody = soup.find("tbody", id="tbodyMTablo")
    if tbody is None:
        return None, "tbodyMTablo bulunamadı"

    table = tbody.find_parent("table")
    thead = table.find("thead") if table else None
    if thead is None:
        return None, "thead bulunamadı"

    # Dönem etiketlerini tahmin ETMEDEN, dropdown'ların "selected" option'ından oku.
    periods = []
    for select in thead.find_all("select", id=lambda x: x and x.startswith("ddlMaliTabloDonem")):
        selected_opt = select.find("option", selected=True)
        periods.append(selected_opt.get("value") if selected_opt else None)

    if not periods:
        return None, "dönem (period) dropdown'ları bulunamadı"

    sections = {}
    current_section = None
    for tr in tbody.find_all("tr"):
        if "arabaslik" in (tr.get("class") or []):
            label = tr.get_text(strip=True)
            # "Bilano"/"Bilanço" gibi encoding farklarını tolere et
            current_section = label
            continue

        if current_section is None:
            continue
        if any(skip in current_section for skip in SKIP_SECTIONS):
            continue

        tds = tr.find_all("td")
        if len(tds) < 2:
            continue

        row_label = tds[0].get_text(strip=True)
        if not row_label:
            continue

        values = [_clean_value(_parse_tr_number(td.get_text(strip=True))) for td in tds[1:1 + len(periods)]]

        # Bölüm adını normalize et (encoding farkı olsa bile tutarlı anahtar kullan)
        section_key = (
            "Bilanço" if "Bilan" in current_section else
            "Gelir Tablosu" if "Gelir" in current_section else
            "Nakit Akım Tablosu" if "Nakit" in current_section else
            current_section
        )
        sections.setdefault(section_key, {})[row_label] = values

    if not sections:
        return None, "hiçbir bölüm satırı parse edilemedi"

    return {"periods": periods, "sections": sections}, None


def save_mali_tablo(cur, stock_id, result):
    """fundamentals_snapshots.balance_sheet_json'a yazar — artık sadece bilanço
    değil, gelir tablosu ve nakit akımını da içeren zengin bir JSON."""
    payload = json.dumps(result, ensure_ascii=False)
    latest_period = result["periods"][0] if result["periods"] else None

    cur.execute(
        """
        UPDATE fundamentals_snapshots SET
          balance_sheet_json   = %s,
          balance_sheet_period = %s,
          updated_at            = NOW()
        WHERE stock_id = %s
        """,
        (payload, latest_period, stock_id),
    )
    if cur.rowcount == 0:
        cur.execute(
            """
            INSERT INTO fundamentals_snapshots (stock_id, balance_sheet_json, balance_sheet_period, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (stock_id) DO UPDATE SET
              balance_sheet_json   = EXCLUDED.balance_sheet_json,
              balance_sheet_period = EXCLUDED.balance_sheet_period,
              updated_at            = NOW()
            """,
            (stock_id, payload, latest_period),
        )


def run_fetch_mali_tablolar():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            print(f"📑 Mali tablolar çekiliyor (bilanço+gelir+nakit akım) — {len(stocks)} hisse ({MAX_WORKERS} paralel)")

            saved, errors = 0, 0
            completed = 0
            error_reasons = {}
            started = time.time()

            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(fetch_mali_tablo, symbol): (stock_id, symbol) for stock_id, symbol in stocks}

                for future in as_completed(futures):
                    stock_id, symbol = futures[future]
                    completed += 1
                    try:
                        result, reason = future.result()
                        if result is None:
                            errors += 1
                            bucket = error_reasons.setdefault((reason or "?")[:100], {"count": 0, "examples": []})
                            bucket["count"] += 1
                            if len(bucket["examples"]) < 5:
                                bucket["examples"].append(symbol)
                            continue

                        cur.execute("SAVEPOINT sp_mali_tablo")
                        try:
                            save_mali_tablo(cur, stock_id, result)
                            cur.execute("RELEASE SAVEPOINT sp_mali_tablo")
                            saved += 1
                        except Exception as err:
                            cur.execute("ROLLBACK TO SAVEPOINT sp_mali_tablo")
                            errors += 1
                            print(f"   ❌ {symbol} (yazım hatası): {err}")
                    except Exception as err:
                        errors += 1
                        print(f"   ❌ {symbol} (ağ hatası): {err}")

                    if completed % 50 == 0:
                        elapsed = time.time() - started
                        rate = completed / elapsed if elapsed else 0
                        remaining = (len(stocks) - completed) / rate if rate else 0
                        print(f"   {completed}/{len(stocks)} tamamlandı — tahmini kalan {remaining:.0f}sn")

        conn.commit()

    duration = time.time() - started
    print(f"\n✅ Tamamlandı ({duration:.1f}sn): {saved} kaydedildi, {errors} hata")
    if error_reasons:
        print("📋 Hata sebep dağılımı:")
        for reason, info in sorted(error_reasons.items(), key=lambda x: -x[1]["count"])[:10]:
            print(f"   [{info['count']}x] {reason} — örnek: {', '.join(info['examples'])}")
    return {"saved": saved, "errors": errors}


if __name__ == "__main__":
    run_fetch_mali_tablolar()
