# python/src/seed_stocks.py
# Borsa İstanbul'da işlem gören TÜM hisseleri (XUTUM endeksi bileşenleri)
# stocks tablosuna ekler. Tek bağlantı kullanır (574 hisse için ayrı ayrı
# bağlantı açmak çok yavaş oluyordu).

import borsapy as bp
from db import get_connection


def run_seed_stocks():
    xutum = bp.Index("XUTUM")
    components = xutum.components  # [{'symbol': 'AKBNK', 'name': 'AKBANK'}, ...]

    print(f"📋 XUTUM'da {len(components)} hisse bulundu, ekleniyor...")

    inserted = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            for i, comp in enumerate(components):
                symbol = comp["symbol"]
                name = comp.get("name", symbol)
                try:
                    cur.execute(
                        """
                        INSERT INTO stocks (symbol, name, exchange, currency, is_active)
                        VALUES (%s, %s, 'BIST', 'TRY', TRUE)
                        ON CONFLICT (symbol) DO UPDATE SET
                          name = EXCLUDED.name,
                          is_active = TRUE
                        """,
                        (symbol, name),
                    )
                    inserted += 1
                except Exception as err:
                    print(f"   ❌ {symbol}: {err}")

                if (i + 1) % 50 == 0:
                    print(f"   {i + 1}/{len(components)} işlendi...")

        conn.commit()

    print(f"✅ {inserted} hisse eklendi/güncellendi")
    return {"total": len(components), "inserted": inserted}


if __name__ == "__main__":
    run_seed_stocks()