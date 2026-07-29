# python/src/extra_scan.py
# ARTIK AYRI TARAMA YAPMIYOR — sadece geriye dönük uyumluluk için duruyor.
#
# ESKİDEN: Bu script kendi başına 574 hisseyi SERİ (paralel değil) dolaşıyor,
# her hisse için filtre 5'te 3, filtre 6'da 2 ayrı history() isteği atıyordu.
# Üstelik 1d ve 1wk verisi scan.py tarafından da ayrıca indiriliyordu —
# yani aynı veri hisse başına iki kez ağdan çekiliyordu.
#
# ŞİMDİ: Ana tarama (scan.run_full_scan) her zaman dilimini hisse başına BİR KEZ
# indirip ana + ek filtrelerin hepsini o veriden hesaplıyor. Bu dosyayı
# çağırmak, ana taramayı çalıştırmakla aynı şeydir.

from scan import run_full_scan


def run_extra_scan():
    print("ℹ️  Ek filtreler artık ana taramaya dahil — birleşik tarama çalıştırılıyor.")
    return run_full_scan(include_extra=True)


if __name__ == "__main__":
    run_extra_scan()
