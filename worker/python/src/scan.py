# python/src/scan.py
# Filtre sistemi: HAFTALIK_1/2/3 + GUNLUK_1
# HIZLANDIRMA: history() çağrıları artık PARALEL (ThreadPoolExecutor) —
# ağ istekleri (yavaş kısım) aynı anda birden çok hisse için yapılıyor,
# veritabanı yazımı ise güvenli şekilde tek tek (ana thread'de) yapılıyor.

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import borsapy as bp
from db import get_connection
from custom_filters import (
    haftalik_analiz_1, haftalik_analiz_2, haftalik_analiz_3, gunluk_analiz_1,
    cci100_kesme, iftcci5_kesme,
    compute_snapshot_values,
)
from extra_filters import filter_ift5_ema_macd, filter_ema120, fetch_bulk_scalars
from net_utils import throttled_retry

FILTER5_TIMEFRAMES = ["4h", "1d", "1wk"]
FILTER6_TIMEFRAMES = ["2h", "30m"]
TF_SUFFIX = {"4h": "4H", "1d": "1D", "1wk": "1WK", "2h": "2H", "30m": "30M"}

FILTERS = [
    ("HAFTALIK_1", haftalik_analiz_1, "1wk", "2y"),
    ("HAFTALIK_2", haftalik_analiz_2, "1wk", "2y"),
    ("HAFTALIK_3", haftalik_analiz_3, "1wk", "2y"),
    ("GUNLUK_1",   gunluk_analiz_1,   "1d",  "1y"),
    ("CCI100_HAFTALIK",  cci100_kesme,  "1wk", "2y"),
    ("CCI100_GUNLUK",    cci100_kesme,  "1d",  "1y"),
    ("IFTCCI5_HAFTALIK", iftcci5_kesme, "1wk", "2y"),
    ("IFTCCI5_GUNLUK",   iftcci5_kesme, "1d",  "1y"),
]

MAX_WORKERS = 8  # Hız sınırının GERÇEK freni net_utils.MIN_INTERVAL (global,
                 # thread sayısından bağımsız). Worker sayısı sadece ağ gecikmesini
                 # örtüştürmeye yarıyor, o yüzden yüksek tutmak güvenli.
                  # Burada durum history.py'den DAHA ağır: hisse başına 5 zaman
                  # dilimi indiriliyor (FETCH_SPEC), yani 5 kat istek. Düşürüldü;
                  # ayrıca her istek net_utils.throttled_retry'dan geçiyor.


def save_signal(cur, stock_id, triggered, current_price):
    signal_types = ",".join(triggered)
    score = min(len(triggered) * 25, 100)
    comment = f"{signal_types} tetiklendi (fiyat: {current_price:.2f})"
    cur.execute(
        """
        INSERT INTO signals (stock_id, signal_types, direction, score, comment, scanned_at, scan_date)
        VALUES (%s, %s, 'bullish', %s, %s, NOW(), CURRENT_DATE)
        ON CONFLICT (stock_id, scan_date) DO UPDATE SET
          signal_types = EXCLUDED.signal_types,
          score        = EXCLUDED.score,
          comment      = EXCLUDED.comment,
          scanned_at   = NOW()
        """,
        (stock_id, signal_types, score, comment),
    )


def _apply_price_update(cur, tracked_id, entry_price, max_price, m5, m10, m20, m30, current_price):
    """Tek bir tracked_signals satırının fiyat/değişim/max/milestone alanlarını günceller.
    filter_types'a DOKUNMAZ — hem track_stock (yeni tetikleme) hem de
    refresh_tracked_prices (filtre tetiklenmese bile periyodik güncelleme) bunu paylaşır.

    ÖNEMLİ: change_pct ANLIK bir değer — fiyat dalgalandıkça yukarı/aşağı oynar.
    Raporlama amaçlı "gerçekleşen getiri" ayrı tutulur: %10'a İLK ulaşıldığı anda
    current_price/change_pct realized_price/realized_pct'e DONDURULUR ve bir daha
    değişmez — sanki o noktada kâr realize edilmiş gibi. Bu, is_active/milestone
    takibini etkilemez; sadece raporlardaki "ortalama getiri" bu dondurulmuş
    değeri kullanır (bkz. signals.js /performance)."""
    entry_price_f = float(entry_price) if entry_price else current_price
    change_pct = ((current_price - entry_price_f) / entry_price_f * 100) if entry_price_f else 0
    new_max = max(float(max_price or 0), current_price)

    target_hit_now = False
    if m5  is None and change_pct >= 5:  m5  = "NOW()"
    if m10 is None and change_pct >= 10:
        m10 = "NOW()"
        target_hit_now = True  # %10'a İLK kez bu güncellemede ulaşıldı -> getiriyi burada dondur
    if m20 is None and change_pct >= 20: m20 = "NOW()"
    if m30 is None and change_pct >= 30: m30 = "NOW()"

    realized_sql = "realized_price = %s, realized_pct = %s," if target_hit_now else ""
    realized_params = [current_price, change_pct] if target_hit_now else []

    cur.execute(
        f"""
        UPDATE tracked_signals SET
          current_price  = %s,
          change_pct     = %s,
          max_price      = %s,
          max_price_date = CASE WHEN %s > COALESCE(max_price, 0)
                                 THEN CURRENT_DATE ELSE max_price_date END,
          milestone_5_at  = {'NOW()' if m5  == 'NOW()' else 'milestone_5_at'},
          milestone_10_at = {'NOW()' if m10 == 'NOW()' else 'milestone_10_at'},
          milestone_20_at = {'NOW()' if m20 == 'NOW()' else 'milestone_20_at'},
          milestone_30_at = {'NOW()' if m30 == 'NOW()' else 'milestone_30_at'},
          {realized_sql}
          updated_at     = NOW()
        WHERE id = %s
        """,
        (current_price, change_pct, new_max, current_price, *realized_params, tracked_id),
    )


def track_stock(cur, stock_id, triggered, current_price):
    cur.execute(
        "SELECT id, filter_types, entry_price, max_price, "
        "milestone_5_at, milestone_10_at, milestone_20_at, milestone_30_at "
        "FROM tracked_signals WHERE stock_id = %s AND is_active = TRUE",
        (stock_id,),
    )
    row = cur.fetchone()

    if row:
        (tracked_id, existing_types, entry_price, max_price,
         m5, m10, m20, m30) = row
        existing_set = set(existing_types.split(",")) if existing_types else set()
        merged_types = ",".join(sorted(existing_set | set(triggered)))

        cur.execute(
            "UPDATE tracked_signals SET filter_types = %s WHERE id = %s",
            (merged_types, tracked_id),
        )
        _apply_price_update(cur, tracked_id, entry_price, max_price, m5, m10, m20, m30, current_price)
    else:
        signal_types = ",".join(triggered)
        cur.execute(
            """
            INSERT INTO tracked_signals
              (stock_id, filter_types, entry_date, entry_price, current_price, change_pct, max_price, max_price_date)
            VALUES (%s, %s, CURRENT_DATE, %s, %s, 0, %s, CURRENT_DATE)
            """,
            (stock_id, signal_types, current_price, current_price, current_price),
        )


def refresh_tracked_prices(cur):
    """Filtre yeniden tetiklenmese bile TÜM aktif takip edilen hisselerin
    current_price/change_pct/max_price/milestone'larını en son stock_quotes
    değerine göre günceller. --sync her çalıştığında (30 dk'da bir) çağrılır,
    böylece fiyat takibi filtrenin yeniden tetiklenmesine bağımlı kalmaz."""
    cur.execute(
        """
        SELECT ts.id, ts.entry_price, ts.max_price,
               ts.milestone_5_at, ts.milestone_10_at, ts.milestone_20_at, ts.milestone_30_at,
               q.price
        FROM tracked_signals ts
        JOIN stock_quotes q ON q.stock_id = ts.stock_id
        WHERE ts.is_active = TRUE AND q.price IS NOT NULL
        """
    )
    rows = cur.fetchall()

    updated = 0
    for (tracked_id, entry_price, max_price, m5, m10, m20, m30, quote_price) in rows:
        _apply_price_update(cur, tracked_id, entry_price, max_price, m5, m10, m20, m30, float(quote_price))
        updated += 1

    return updated


def save_extra_result(cur, stock_id, filter_code, timeframe, result):
    cur.execute(
        """
        INSERT INTO extra_filter_results (stock_id, filter_code, timeframe, result, updated_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id, filter_code, timeframe) DO UPDATE SET
          result     = EXCLUDED.result,
          updated_at = NOW()
        """,
        (stock_id, filter_code, timeframe, result),
    )


def save_snapshot(cur, stock_id, weekly_vals, daily_vals, filter_results):
    cur.execute(
        """
        INSERT INTO indicator_snapshots
          (stock_id, inv1_9, inv1_13, ema21_weekly, ema21_daily,
           macdas_weekly, macdas_daily, cci20_weekly, cci20_daily,
           price_weekly, price_daily,
           iftcci5_weekly_value, iftcci5_daily_value,
           haftalik_1, haftalik_2, haftalik_3, gunluk_1,
           cci100_haftalik, cci100_gunluk, iftcci5_haftalik, iftcci5_gunluk,
           updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id) DO UPDATE SET
          inv1_9        = EXCLUDED.inv1_9,
          inv1_13       = EXCLUDED.inv1_13,
          ema21_weekly  = EXCLUDED.ema21_weekly,
          ema21_daily   = EXCLUDED.ema21_daily,
          macdas_weekly = EXCLUDED.macdas_weekly,
          macdas_daily  = EXCLUDED.macdas_daily,
          cci20_weekly  = EXCLUDED.cci20_weekly,
          cci20_daily   = EXCLUDED.cci20_daily,
          price_weekly  = EXCLUDED.price_weekly,
          price_daily   = EXCLUDED.price_daily,
          iftcci5_weekly_value = EXCLUDED.iftcci5_weekly_value,
          iftcci5_daily_value  = EXCLUDED.iftcci5_daily_value,
          haftalik_1    = EXCLUDED.haftalik_1,
          haftalik_2    = EXCLUDED.haftalik_2,
          haftalik_3    = EXCLUDED.haftalik_3,
          gunluk_1      = EXCLUDED.gunluk_1,
          cci100_haftalik  = EXCLUDED.cci100_haftalik,
          cci100_gunluk    = EXCLUDED.cci100_gunluk,
          iftcci5_haftalik = EXCLUDED.iftcci5_haftalik,
          iftcci5_gunluk   = EXCLUDED.iftcci5_gunluk,
          updated_at    = NOW()
        """,
        (
            stock_id,
            weekly_vals.get("inv1"), daily_vals.get("inv1"),
            weekly_vals.get("ema21"), daily_vals.get("ema21"),
            weekly_vals.get("macdas"), daily_vals.get("macdas"),
            weekly_vals.get("cci20"), daily_vals.get("cci20"),
            weekly_vals.get("price"), daily_vals.get("price"),
            weekly_vals.get("iftcci5"), daily_vals.get("iftcci5"),
            filter_results.get("HAFTALIK_1", False),
            filter_results.get("HAFTALIK_2", False),
            filter_results.get("HAFTALIK_3", False),
            filter_results.get("GUNLUK_1", False),
            filter_results.get("CCI100_HAFTALIK", False),
            filter_results.get("CCI100_GUNLUK", False),
            filter_results.get("IFTCCI5_HAFTALIK", False),
            filter_results.get("IFTCCI5_GUNLUK", False),
        ),
    )


# ── BİRLEŞİK VERİ ÇEKME ────────────────────────────────────
# ESKİDEN: scan.py 1wk+1d çekiyordu, extra_scan.py ayrıca 4h+1d+1wk (filtre 5)
# ve 2h+30m (filtre 6) çekiyordu — yani 1d ve 1wk verisi hisse başına İKİ KEZ
# indiriliyordu, üstelik extra_scan seri (paralel değil) çalışıyordu.
# ŞİMDİ: her zaman dilimi hisse başına SADECE BİR KEZ indirilir, tüm filtreler
# (ana + ek) aynı bellekteki veriden hesaplanır.
FETCH_SPEC = {
    "1wk": "2y",
    "1d":  "1y",
    "4h":  "6mo",
    "2h":  "3mo",
    "30m": "1mo",
}


def fetch_all_timeframes(symbol: str) -> dict:
    """Bir hisse için gereken TÜM zaman dilimlerini tek seferde indirir.
    Her istek net_utils.throttled_retry'dan geçer — global hız sınırlayıcı +
    429'da üstel bekleme ile tekrar deneme. Bir zaman dilimi tüm denemelerde
    başarısız olursa None döner (o filtre False sayılır, tarama devam eder)."""
    ticker = bp.Ticker(symbol)
    out = {}
    for tf, period in FETCH_SPEC.items():
        try:
            out[tf] = throttled_retry(
                lambda p=period, i=tf: ticker.history(period=p, interval=i)
            )
        except Exception:
            out[tf] = None
    return out


def scan_one_data(symbol: str, bulk_scalars: dict | None = None) -> dict:
    """SADECE veri toplama + hesaplama — veritabanına dokunmuyor, thread-safe.
    Ana filtreler ve ek filtreler (5/6) aynı indirilen veriden hesaplanır."""
    frames = fetch_all_timeframes(symbol)
    df_w, df_d = frames.get("1wk"), frames.get("1d")

    # ── Ana filtreler ──
    filter_results = {}
    for name, func, tf, _ in FILTERS:
        df = frames.get(tf)
        if df is None or len(df) < 30:
            filter_results[name] = False
            continue
        try:
            filter_results[name] = bool(func(df))
        except Exception:
            filter_results[name] = False

    # ── Ek filtreler (5: IFT5_EMA_MACD / 6: EMA120) ──
    # bulk_scalars verilmezse ek filtreler atlanır (sadece ana tarama modu).
    extra_results = []   # (filter_code, timeframe, result)
    if bulk_scalars is not None:
        for tf in FILTER5_TIMEFRAMES:
            try:
                r = bool(filter_ift5_ema_macd(frames.get(tf), symbol, tf, bulk_scalars))
            except Exception:
                r = False
            extra_results.append(("IFT5_EMA_MACD", tf, r))
        for tf in FILTER6_TIMEFRAMES:
            try:
                r = bool(filter_ema120(frames.get(tf), symbol, tf, bulk_scalars))
            except Exception:
                r = False
            extra_results.append(("EMA120", tf, r))

    weekly_vals = compute_snapshot_values(df_w, 9)  if df_w is not None and len(df_w) >= 30 else {}
    daily_vals  = compute_snapshot_values(df_d, 13) if df_d is not None and len(df_d) >= 30 else {}

    triggered = [name for name, ok in filter_results.items() if ok]
    # Ek filtreler tracked_signals'ta ana filtrelerle karışmasın diye zaman dilimi ekli
    triggered += [f"{code}_{TF_SUFFIX[tf]}" for code, tf, ok in extra_results if ok]

    current_price = daily_vals.get("price") or weekly_vals.get("price")

    return {
        "symbol": symbol,
        "filter_results": filter_results,
        "extra_results": extra_results,
        "weekly_vals": weekly_vals,
        "daily_vals": daily_vals,
        "triggered": triggered,
        "current_price": current_price,
    }


def scan_one(cur, stock_id, symbol):
    """Tek hisse için veri topla + veritabanına yaz (tek seferlik test için)."""
    data = scan_one_data(symbol)
    save_snapshot(cur, stock_id, data["weekly_vals"], data["daily_vals"], data["filter_results"])
    if not data["triggered"] or data["current_price"] is None:
        return "no_signal"
    save_signal(cur, stock_id, data["triggered"], data["current_price"])
    track_stock(cur, stock_id, data["triggered"], data["current_price"])
    return "signal"


def run_full_scan(include_extra: bool = True):
    """Ana filtreler + (varsayılan olarak) ek filtreler TEK geçişte.

    include_extra=False verilirse sadece ana filtreler çalışır (eski davranış).
    Ek filtreler dahilken hisse başına 5 zaman dilimi indirilir; eskiden aynı iş
    iki ayrı script'te 7 indirmeyle ve ek tarama tarafı SERİ yapılıyordu."""
    results = {"total": 0, "signals": 0, "no_signal": 0, "errors": 0, "extra_hits": 0}
    started = time.time()

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            symbol_to_id = {symbol: stock_id for stock_id, symbol in stocks}
            results["total"] = len(stocks)

            # Ek filtrelerin ihtiyaç duyduğu ADX/EMA/MACD değerleri — TEK toplu istek.
            bulk_scalars = None
            if include_extra:
                print("📡 Toplu gösterge verisi çekiliyor (ADX/EMA/MACD, tüm zaman dilimleri)...")
                try:
                    bulk_scalars = fetch_bulk_scalars(list(symbol_to_id.keys()))
                    print(f"   {len(bulk_scalars)} hisse için veri geldi")
                except Exception as err:
                    print(f"   ⚠️  Toplu gösterge verisi alınamadı, ek filtreler atlanacak: {err}")
                    bulk_scalars = None

            mode = "ana + ek filtreler" if bulk_scalars is not None else "sadece ana filtreler"
            print(f"🔍 Tam tarama başladı — {len(stocks)} hisse ({MAX_WORKERS} paralel, {mode})")

            completed = 0
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                futures = {executor.submit(scan_one_data, symbol, bulk_scalars): symbol for symbol in symbol_to_id}

                for future in as_completed(futures):
                    symbol = futures[future]
                    stock_id = symbol_to_id[symbol]
                    completed += 1
                    try:
                        data = future.result()
                        save_snapshot(cur, stock_id, data["weekly_vals"], data["daily_vals"], data["filter_results"])

                        for code, tf, r in data.get("extra_results", []):
                            save_extra_result(cur, stock_id, code, tf, r)
                            if r:
                                results["extra_hits"] += 1

                        if data["triggered"] and data["current_price"] is not None:
                            save_signal(cur, stock_id, data["triggered"], data["current_price"])
                            track_stock(cur, stock_id, data["triggered"], data["current_price"])
                            results["signals"] += 1
                        else:
                            results["no_signal"] += 1

                        conn.commit()
                    except Exception as err:
                        conn.rollback()
                        results["errors"] += 1
                        print(f"   ❌ {symbol}: {err}")

                    if completed % 20 == 0:
                        elapsed = time.time() - started
                        rate = completed / elapsed if elapsed else 0
                        remaining = (len(stocks) - completed) / rate if rate else 0
                        print(f"   {completed}/{len(stocks)} tamamlandı — tahmini kalan {remaining/60:.1f} dk")

    results["duration_sec"] = round(time.time() - started, 1)
    print(f"\n✅ Tarama tamamlandı ({results['duration_sec']/60:.1f} dk): {results}")
    return results


if __name__ == "__main__":
    run_full_scan()
