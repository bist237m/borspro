# python/src/main.py
# Giriş noktası. Eski Node worker'daki index.js'in Python karşılığı.
#
# Kullanım:
#   python main.py --sync         → Fiyatları hemen güncelle
#   python main.py --scan         → Ana filtre taramasını başlat
#   python main.py --history      → 1 yıllık geçmiş veriyi çek
#   python main.py --extra-scan   → Filtre 5 ve 6'yı çalıştır
#   python main.py --fundamentals → Temel + teknik veri (FAVÖK, PD/DD, RSI vb.)
#   python main.py --news         → KAP haberlerini çek

import sys
from sync import run_sync_quotes
from scan import run_full_scan
from history import run_sync_history
from extra_scan import run_extra_scan
from fundamentals import run_fetch_fundamentals
from news import run_fetch_news

print("🚀 Borsa Pro Worker (Python) başladı\n")

args = sys.argv[1:]

if not args:
    print("⚠️  Hiçbir bayrak verilmedi. Kullanım: --sync | --scan | --history | --extra-scan | --fundamentals | --news")

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

print("\n✅ İşlem tamamlandı.")
