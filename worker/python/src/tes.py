import borsapy as bp
import time

CORE_B = ["net_margin", "ebitda_margin", "ev_sales", "return_1d", "return_1w", "return_1m"]

for c in CORE_B:
    screener = bp.Screener()
    screener.add_filter(c, min=-9999, max=99999)
    df = screener.run()
    print(f"{c}: {len(df)} satır")
    time.sleep(1.5)

print("\n--- Hepsi birlikte ---")
screener = bp.Screener()
for c in CORE_B:
    screener.add_filter(c, min=-9999, max=99999)
df = screener.run()
print(f"6'sı birlikte: {len(df)} satır")