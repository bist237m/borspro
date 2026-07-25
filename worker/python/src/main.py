# python/src/main.py
# Giriş noktası. Eski Node worker'daki index.js'in Python karşılığı.
#
# Kullanım:
#   python main.py --sync    → Fiyatları hemen güncelle
#   python main.py --scan    → Taramayı hemen başlat
#   python main.py --history → 1 yıllık geçmiş veriyi çek

import sys
from sync import run_sync_quotes
from scan import run_full_scan
from history import run_sync_history

print("🚀 Borsa Pro Worker (Python) başladı\n")

args = sys.argv[1:]

if not args:
    print("⚠️  Hiçbir bayrak verilmedi. Kullanım: --sync | --scan | --history")

if "--sync" in args:
    run_sync_quotes()

if "--history" in args:
    run_sync_history("1y")

if "--scan" in args:
    run_full_scan()

print("\n✅ İşlem tamamlandı.")