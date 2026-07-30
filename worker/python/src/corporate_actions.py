# python/src/corporate_actions.py
# Sermaye artırımları/temettü VE yabancı oranları — ikisi de aynı sayfadan
# (Temel-Degerler-Ve-Oranlar.aspx), TEK istekle.
#
# ÖNEMLİ: Bu veri AJAX ile değil, sayfanın kendi HTML'inde geliyor (JS ile
# sadece gizleniyor/gösteriliyor) — bu yüzden borsapy'nin kullandığı hazır
# istekler yerine burada DOĞRUDAN requests + BeautifulSoup ile sayfayı
# kendimiz çekip parse ediyoruz.
#
# Kolon eşlemesi (gerçek sayfa HTML'inden/ekran görüntüsünden elle çıkarıldı):
#
# Sermaye Artırımları (<tr class="SermayeRow">, class isimli kolonlar):
#   PRICE_TL                    -> event anındaki fiyat (TL)
#   HSP_BOLUNME_SONRASI_SERMAYE -> bölünme sonrası sermaye
#   SHHE_TARIH (data-order)     -> işlem/hak kullanım tarihi (YYYYMMDD...)
#   SHHE_BDLI_ORAN              -> Bedelli sermaye artışı oranı (%)
#   SHHE_BDLI_NOM_TUTAR         -> Bedelli nominal tutar
#   SHHE_RHK_ORAN               -> Rüçhan hakkı kullanım oranı (%)
#   SHHE_BDSZ_IK_ORAN           -> Bedelsiz (iç kaynak) oranı (%)
#   SHHE_BDSZ_TM_ORAN           -> Bedelsiz (temettü) oranı (%)
#   SHHE_NAKIT_TM_ORAN          -> Nakit temettü oranı (%)
#   SHHE_NAKIT_TM_TUTAR         -> Nakit temettü tutarı
#   SHHE_FIYAT_AYAR_OR          -> Fiyat ayar oranı (geçmiş fiyat düzeltmesi için)
#
# Yabancı Oranları (<tbody id="yabanciOranlarTbody">, kolonlar class'sız —
# ekran görüntüsünden pozisyonla eşlendi, SIRA SABİT):
#   td[0] -> Kod (sembol, <a> içinde)
#   td[1] -> Kapanış (TL)
#   td[2] -> Yabancı Oranı % (önceki seçili tarih — kullanılmıyor)
#   td[3] -> Yabancı Oranı % (GÜNCEL/en son tarih) -> fundamentals_snapshots.foreign_ratio
#   td[4] -> Değişim (Baz Puan)
#   td[5] -> Etki* (%) (yabancı takas adedi değişiminin halka açıklık adedine etkisi)

import requests
from datetime import datetime
from bs4 import BeautifulSoup
from db import get_connection

PAGE_URL = "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/Temel-Degerler-Ve-Oranlar.aspx"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": PAGE_URL,
}


def _parse_tr_number(text):
    """Türkçe sayı formatını ('1.234,56') float'a çevirir."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        return float(text.replace(".", "").replace(",", "."))
    except Exception:
        return None


def _fetch_page():
    """Sayfayı TEK seferde çeker — hem sermaye artırımları hem yabancı
    oranları tabloları aynı sayfanın HTML'inde (farklı sekmeler, JS ile
    gizli/gösterili), bu yüzden ikinci bir ağ isteğine gerek yok."""
    resp = requests.get(PAGE_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return BeautifulSoup(resp.content, "html.parser")


def parse_corporate_actions(soup):
    """<tr class="SermayeRow"> satırlarını parse eder."""
    rows = soup.find_all("tr", class_="SermayeRow")
    results = []
    for tr in rows:
        symbol_td = tr.find("td", class_="HISSE_KODU")
        a_tag = symbol_td.find("a") if symbol_td else None
        symbol = a_tag.text.strip() if a_tag else None
        if not symbol:
            continue

        def get_val(cls):
            td = tr.find("td", class_=cls)
            return td.text.strip() if td else None

        date_td = tr.find("td", class_="SHHE_TARIH")
        event_date = None
        if date_td and date_td.get("data-order"):
            try:
                event_date = datetime.strptime(date_td["data-order"][:8], "%Y%m%d").date()
            except Exception:
                event_date = None

        if event_date is None:
            continue  # tarihsiz satırı takvime koyamayız

        results.append({
            "symbol": symbol,
            "event_date": event_date,
            "price_tl": _parse_tr_number(get_val("PRICE_TL")),
            "capital_after": _parse_tr_number(get_val("HSP_BOLUNME_SONRASI_SERMAYE")),
            "bedelli_oran": _parse_tr_number(get_val("SHHE_BDLI_ORAN")),
            "bedelli_nom_tutar": _parse_tr_number(get_val("SHHE_BDLI_NOM_TUTAR")),
            "ruchan_oran": _parse_tr_number(get_val("SHHE_RHK_ORAN")),
            "bedelsiz_ic_oran": _parse_tr_number(get_val("SHHE_BDSZ_IK_ORAN")),
            "bedelsiz_tm_oran": _parse_tr_number(get_val("SHHE_BDSZ_TM_ORAN")),
            "nakit_tm_oran": _parse_tr_number(get_val("SHHE_NAKIT_TM_ORAN")),
            "nakit_tm_tutar": _parse_tr_number(get_val("SHHE_NAKIT_TM_TUTAR")),
            "fiyat_ayar_oran": _parse_tr_number(get_val("SHHE_FIYAT_AYAR_OR")),
        })
    return results


def parse_foreign_ratios(soup):
    """<tbody id="yabanciOranlarTbody"> satırlarını POZİSYONA göre parse eder
    (bu tabloda class isimleri yok, sıra sabit — ekran görüntüsüyle doğrulandı)."""
    tbody = soup.find("tbody", id="yabanciOranlarTbody")
    if tbody is None:
        return []

    results = []
    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue  # "Kayıt bulunamadı" gibi boş/placeholder satırlar

        a_tag = tds[0].find("a")
        symbol = (a_tag.text if a_tag else tds[0].text).strip()
        if not symbol:
            continue

        results.append({
            "symbol": symbol,
            "close_price": _parse_tr_number(tds[1].text),
            "foreign_ratio_prev": _parse_tr_number(tds[2].text),
            "foreign_ratio": _parse_tr_number(tds[3].text),
            "change_bp": _parse_tr_number(tds[4].text) if len(tds) > 4 else None,
            "impact_pct": _parse_tr_number(tds[5].text) if len(tds) > 5 else None,
        })
    return results


def fetch_corporate_actions():
    """Geriye dönük uyumluluk için — sadece sermaye artırımları listesini döner."""
    soup = _fetch_page()
    return parse_corporate_actions(soup)


def save_corporate_action(cur, stock_id, item):
    cur.execute(
        """
        INSERT INTO corporate_actions
          (stock_id, event_date, price_tl, capital_after,
           bedelli_oran, bedelli_nom_tutar, ruchan_oran,
           bedelsiz_ic_oran, bedelsiz_tm_oran,
           nakit_tm_oran, nakit_tm_tutar, fiyat_ayar_oran, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id, event_date) DO UPDATE SET
          price_tl           = EXCLUDED.price_tl,
          capital_after      = EXCLUDED.capital_after,
          bedelli_oran       = EXCLUDED.bedelli_oran,
          bedelli_nom_tutar  = EXCLUDED.bedelli_nom_tutar,
          ruchan_oran        = EXCLUDED.ruchan_oran,
          bedelsiz_ic_oran   = EXCLUDED.bedelsiz_ic_oran,
          bedelsiz_tm_oran   = EXCLUDED.bedelsiz_tm_oran,
          nakit_tm_oran      = EXCLUDED.nakit_tm_oran,
          nakit_tm_tutar     = EXCLUDED.nakit_tm_tutar,
          fiyat_ayar_oran    = EXCLUDED.fiyat_ayar_oran,
          updated_at         = NOW()
        """,
        (stock_id, item["event_date"], item["price_tl"], item["capital_after"],
         item["bedelli_oran"], item["bedelli_nom_tutar"], item["ruchan_oran"],
         item["bedelsiz_ic_oran"], item["bedelsiz_tm_oran"],
         item["nakit_tm_oran"], item["nakit_tm_tutar"], item["fiyat_ayar_oran"]),
    )


def save_foreign_ratio(cur, stock_id, item):
    """fundamentals_snapshots.foreign_ratio'yu bu güvenilir kaynaktan günceller
    (Screener'ın criteria_40'ı GARAN/KCHOL gibi hisselerde boş dönebiliyordu —
    bu sayfa TÜM hisseleri kapsıyor, tek istekte)."""
    cur.execute(
        """
        UPDATE fundamentals_snapshots SET
          foreign_ratio = %s,
          updated_at    = NOW()
        WHERE stock_id = %s
        """,
        (item["foreign_ratio"], stock_id),
    )
    if cur.rowcount == 0:
        cur.execute(
            """
            INSERT INTO fundamentals_snapshots (stock_id, foreign_ratio, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (stock_id) DO UPDATE SET
              foreign_ratio = EXCLUDED.foreign_ratio,
              updated_at    = NOW()
            """,
            (stock_id, item["foreign_ratio"]),
        )


def run_sync_corporate_actions():
    try:
        soup = _fetch_page()
        actions = parse_corporate_actions(soup)
        foreign_ratios = parse_foreign_ratios(soup)
    except Exception as err:
        print(f"❌ Sayfa çekilemedi: {err}")
        return {"saved": 0, "skipped": 0, "foreign_saved": 0}

    print(f"📅 {len(actions)} sermaye artırımı/temettü kaydı, {len(foreign_ratios)} yabancı oranı kaydı bulundu, işleniyor...")

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE")
            symbol_to_id = {symbol: stock_id for stock_id, symbol in cur.fetchall()}

            saved, skipped = 0, 0
            for item in actions:
                stock_id = symbol_to_id.get(item["symbol"])
                if not stock_id:
                    skipped += 1
                    continue
                try:
                    cur.execute("SAVEPOINT sp_corp_action")
                    save_corporate_action(cur, stock_id, item)
                    cur.execute("RELEASE SAVEPOINT sp_corp_action")
                    saved += 1
                except Exception as err:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_corp_action")
                    print(f"   ❌ {item['symbol']}: {err}")

            foreign_saved, foreign_skipped = 0, 0
            for item in foreign_ratios:
                stock_id = symbol_to_id.get(item["symbol"])
                if not stock_id or item["foreign_ratio"] is None:
                    foreign_skipped += 1
                    continue
                try:
                    cur.execute("SAVEPOINT sp_foreign_ratio")
                    save_foreign_ratio(cur, stock_id, item)
                    cur.execute("RELEASE SAVEPOINT sp_foreign_ratio")
                    foreign_saved += 1
                except Exception as err:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_foreign_ratio")
                    print(f"   ❌ {item['symbol']} (yabancı oranı): {err}")

        conn.commit()

    print(f"✅ Tamamlandı: {saved} sermaye/temettü kaydı, {foreign_saved} yabancı oranı kaydı ({foreign_skipped} atlandı), {skipped} sembol eşleşmedi")
    return {"saved": saved, "skipped": skipped, "foreign_saved": foreign_saved}


if __name__ == "__main__":
    run_sync_corporate_actions()
