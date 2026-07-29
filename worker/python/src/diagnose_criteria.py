# python/src/diagnose_criteria.py
# TEK SEFERLİK teşhis aracı — TARGET_CRITERIA ve SECTOR_CRITERIA listesindeki
# her kriteri TEK TEK dener (aralarına bekleme koyarak) ve hangisinin İş
# Yatırım screener'ını çökerttiğini (JSON yerine boş/HTML cevap) bulur.
#
# Çalıştır: python diagnose_criteria.py
# Çıktıda "❌ ÇÖKTÜ" yazan kriter numarasını bul, fundamentals.py'de o
# kriteri listeden çıkar ya da ayrı işaretle.

import time
import borsapy as bp

CANDIDATES = {
    "166": "Hedef Fiyat (TL) — güncel",
    "target_price": "Hedef Fiyat (TL) — eski/yedek (criteria_51)",
    "167": "Getiri Potansiyeli (%)",
    "338": "Önceki Hedef Fiyat (TL)",
    "132": "Son Öneri Tarihi",
    "323": "Bir Önceki Öneri Tarihi",
    "364": "Sektör F/K",
    "365": "Sektör FD/FAVÖK",
    "366": "Sektör PD/DD",
    "368": "Sektöre Göre F/K İskontosu (%)",
    "369": "Sektöre Göre PD/DD İskontosu (%)",
    "371": "Sektöre Göre FD/FAVÖK İskontosu (%)",
    "156": "{ID2} Temettü Verimi (%)",
    "157": "{ID3} Temettü Verimi (%)",
    "151": "{ID2} Hisse Başı Temettü (TL)",
    "152": "{ID3} Hisse Başı Temettü (TL)",
    "161": "{ID2} Temettü Dağıtma Oranı (%)",
    "162": "{ID3} Temettü Dağıtma Oranı (%)",
    "134": "{ID2} Temettü Tarihi",
    "326": "{ID3} Toplam Temettü (mn TL)",
}


def test_one(criteria_id: str, label: str) -> str:
    try:
        screener = bp.Screener()
        screener.add_filter(criteria_id, min=-9999, max=99999)
        df = screener.run()
        n = 0 if df is None else len(df)
        if n == 0:
            return f"⚠️  BOŞ DÖNDÜ (0 satır) — {criteria_id} muhtemelen filtrelenebilir bir kriter değil"
        return f"✅ OK — {n} satır"
    except Exception as err:
        return f"❌ ÇÖKTÜ — {err}"


if __name__ == "__main__":
    print(f"🔬 {len(CANDIDATES)} kriter tek tek test ediliyor (aralarda 1.5sn bekleme)...\n")
    results = {}
    for cid, label in CANDIDATES.items():
        sonuc = test_one(cid, label)
        results[cid] = sonuc
        print(f"  criteria_{cid:15s} {label:45s} -> {sonuc}")
        time.sleep(1.5)

    print("\n" + "=" * 70)
    bad = [cid for cid, r in results.items() if r.startswith("❌") or r.startswith("⚠️")]
    if bad:
        print(f"🚩 Sorunlu kriterler: {', '.join(bad)}")
        print("   Bunları fundamentals.py'deki ilgili CRITERIA listesinden çıkar.")
    else:
        print("✅ Tüm kriterler tek başına çalışıyor — sorun büyük ihtimalle")
        print("   hız sınırlama (rate limit) idi, fundamentals.py'deki bekleme")
        print("   süresini artırmak (time.sleep) yeterli olabilir.")
