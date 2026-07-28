# python/src/main.py
# Giriş noktası. Eski Node worker'daki index.js'in Python karşılığı.
#
# Kullanım:
#   python main.py --sync            → Fiyatları hemen güncelle
#   python main.py --scan            → Ana filtre taramasını başlat
#   python main.py --history         → 1 yıllık geçmiş veriyi çek
#   python main.py --extra-scan      → Filtre 5 ve 6'yı çalıştır
#   python main.py --fundamentals    → Temel+teknik veri (TradingView) + PE/PB/ROE/Piyasa Değeri/Net Kar (İş Yatırım, birleşik)
#   python main.py --news            → KAP haberlerini çek
#   python main.py --kriterleri      → İş Yatırım screener kriter listesini txt'e kaydet
#   python main.py --balance-sheet   → Bilanço verilerini çek (dönemsel, JSON olarak saklanır)
#   python main.py --sector-index    → Sektör ve endeks (BIST30/50/100 vb.) üyeliğini güncelle

import sys
from sync import run_sync_quotes
from scan import run_full_scan
from history import run_sync_history
from extra_scan import run_extra_scan
from fundamentals import run_fetch_fundamentals
from news import run_fetch_news
from kriterleri_bul import tum_kriterleri_kaydet
from balance_sheet import run_fetch_balance_sheets
from sector_index import run_sync_sector_index

print("🚀 Borsa Pro Worker (Python) başladı\n")

args = sys.argv[1:]

if not args:
    print("⚠️  Hiçbir bayrak verilmedi. Kullanım: --sync | --scan | --history | --extra-scan | --fundamentals | --news | --kriterleri | --balance-sheet | --sector-index")

if "--sync" in args:
    run_sync_quotes()

if "--history" in args:
    run_sync_history("1y")

if "--scan" in args:
    run_full_scan()

if "--extra-scan" in args:
    run_extra_scan()

if "--fundamentals" in args:
    run_fetch_fundamentals()

if "--news" in args:
    run_fetch_news()

if "--kriterleri" in args:
    tum_kriterleri_kaydet()

if "--balance-sheet" in args:
    run_fetch_balance_sheets()

if "--sector-index" in args:
    run_sync_sector_index()

print("\n✅ İşlem tamamlandı.")
