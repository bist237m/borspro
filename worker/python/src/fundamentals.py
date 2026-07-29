# python/src/fundamentals.py
# Temel + teknik veri — TradingView'ın toplu sorgu API'sinden TEK istekte.
#
# BİRLEŞTİRİLDİ (eskiden sync_fundamentals.py ayrı çalışıyordu):
# PE/PB/ROE/Piyasa Değeri/Net Kar için İş Yatırım Screener (KAP kaynaklı,
# Türk hisseleri için genelde daha güncel/isabetli) önceliklidir. Diğer
# tüm alanlar (FAVÖK, 52 hafta yüksek/düşük, büyüme oranları, RSI, SMA50,
# hacim, pivot, MACD) sadece TradingView'da var, oradan geliyor.

import pandas as pd
import borsapy as bp
from tradingview_screener import Query
from db import get_connection

import concurrent.futures

def fetch_isyatirim(symbols: list[str]) -> dict:
    """İş Yatırım Screener'dan temel veri çeker.
    
    Tüm kriterleri otomatik olarak güvenli (maksimum 8-10'lu) gruplara böler
    ve API'ye ThreadPoolExecutor ile PARALEL (eşzamanlı) istek atar.
    Bu hem süreyi saniyelere indirir hem de API'nin kolon atlamasını önler.
    """
    ALL_CRITERIA = [
        # Temel Alanlar
        "pe", "pb", "roe", "float_ratio", "foreign_ratio", "ev_ebitda",
        "net_margin", "ebitda_margin", "ev_sales", 
        "return_1d", "return_1w", "return_1m", "dividend_yield",
        "foreign_ratio_1w_change", "foreign_ratio_1m_change",
        "pe_hist_avg", "ev_ebitda_hist_avg",
        # Hedef Fiyat ve Sektör
        "166", "target_price", "167", "338", "132", "323",
        "364", "365", "366", "368", "369", "371",
        # Temettü
        "156", "157", "151", "152", "161", "162", "134", "326"
    ]

    # Kriterleri 8'erli güvenli küçük parçalara (chunk) bölüyoruz
    CHUNK_SIZE = 8
    chunks = [ALL_CRITERIA[i:i + CHUNK_SIZE] for i in range(0, len(ALL_CRITERIA), CHUNK_SIZE)]

    frames = []
    
    # 5 iş parçacığı (worker) ile paralel istek atıyoruz
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_chunk = {
            executor.submit(_run_screener, chunk, f"Grup-{i+1}"): chunk 
            for i, chunk in enumerate(chunks)
        }
        
        for future in concurrent.futures.as_completed(future_to_chunk):
            df = future.result()
            if df is not None and not df.empty:
                # Gelen verinin index'ini symbol yapıyoruz
                if "symbol" in df.columns:
                    df.set_index("symbol", inplace=True)
                frames.append(df)

    if not frames:
        return {}

    # Parçalanmış veri setlerini symbol bazında birleştiriyoruz
    result = {}
    for symbol in symbols:
        merged = {}
        found = False
        for d in frames:
            if symbol in d.index:
                found = True
                row = d.loc[symbol]
                if isinstance(row, pd.DataFrame):  # Tekrarlayan satır kontrolü
                    row = row.iloc[0]
                merged.update(row.to_dict())
        
        if found:
            result[symbol] = merged

    return result

COLUMNS = [
    "name", "close", "market_cap_basic", "ebitda",
    "price_earnings_ttm", "price_book_fq",
    "price_52_week_high", "price_52_week_low", "net_income",
    "return_on_equity_fq", "total_debt", "net_income_yoy_growth_fq",
    "total_revenue_yoy_growth_fq",
    "RSI", "SMA50", "volume", "average_volume_10d_calc",
    "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
    "MACD.macd", "MACD.signal",
]


def fetch_all(symbols: list[str]):
    tickers = [f"BIST:{s}" for s in symbols]
    _, df = (
        Query()
        .set_markets("turkey")
        .select(*COLUMNS)
        .set_tickers(*tickers)
        .limit(1000)
        .get_scanner_data()
    )
    return df


def _run_screener(criteria_list, label):
    """Verilen kriterlerle TEK bir İş Yatırım Screener isteği çalıştırır."""
    try:
        screener = bp.Screener()
        for c in criteria_list:
            screener.add_filter(c, min=-9999, max=99999)
        return screener.run()
    except Exception as err:
        print(f"   ⚠️  İş Yatırım Screener hatası ({label}): {err}")
        return None


def fetch_isyatirim(symbols: list[str]) -> dict:
    """İş Yatırım Screener'dan temel veri çeker.

    ÜÇ AYRI istekte çalışır (eskiden TEK istekte 36 kriterdi). Sebep: 19 yeni
    kriter (hedef fiyat/sektör/temettü) eklendikten sonra free_float ve
    foreign_ratio gibi ESKİ, daha önce sorunsuz çalışan alanlar bazı hisselerde
    (GARAN, KCHOL gibi büyük/likit hisseler dahil) boş dönmeye başladı — İş
    Yatırım'ın tek istekte bu kadar çok kriteri işlerken bazı kolonları sessizce
    atladığı görülüyor. Kriterleri gruplara bölüp ayrı istek yapmak bu riski
    izole ediyor: bir grup bozulsa bile diğerleri etkilenmiyor.
    """
    CORE_CRITERIA = [
        "pe", "pb", "roe", "float_ratio", "foreign_ratio", "ev_ebitda",
        "net_margin", "ebitda_margin", "ev_sales",
        "return_1d", "return_1w", "return_1m", "dividend_yield",
        "foreign_ratio_1w_change", "foreign_ratio_1m_change",
        "pe_hist_avg", "ev_ebitda_hist_avg",
    ]
    TARGET_SECTOR_CRITERIA = [
        "166", "target_price", "167", "338", "132", "323",   # hedef fiyat / öneri
        "364", "365", "366", "368", "369", "371",             # sektörel karşılaştırma
    ]
    DIVIDEND_CRITERIA = [
        "156", "157", "151", "152", "161", "162", "134", "326",  # temettü detayı (ID2/ID3)
    ]

    df_core   = _run_screener(CORE_CRITERIA, "temel alanlar")
    df_target = _run_screener(TARGET_SECTOR_CRITERIA, "hedef fiyat/sektör")
    df_div    = _run_screener(DIVIDEND_CRITERIA, "temettü detayı")

    frames = [d for d in (df_core, df_target, df_div) if d is not None and not d.empty]
    if not frames:
        return {}

    for d in frames:
        d.set_index("symbol", inplace=True)

    result = {}
    for symbol in symbols:
        merged = {}
        found = False
        for d in frames:
            if symbol not in d.index:
                continue
            found = True
            row = d.loc[symbol]
            if isinstance(row, pd.DataFrame):  # aynı sembol birden fazla satırda gelirse
                row = row.iloc[0]
            merged.update(row.to_dict())
        if found:
            result[symbol] = merged
    return result


def _safe_float_tr(val):
    """İş Yatırım'dan gelen değeri float'a çevirir.

    ÖNEMLİ: borsapy her criteria değerini önce float(value) ile çevirmeyi
    dener; başarılı olursa (nokta ondalıklı/tam sayı gibi 'temiz' bir değerse)
    zaten float olarak veriyor, başarısız olursa (virgüllü Türkçe format gibi)
    ham string bırakıyor. Yani hangi alanın hangi formatta geleceği DEĞİŞKEN.
    Bu yüzden her zaman 'virgüllü Türkçe format' varsayıp nokta silmek YANLIŞ —
    zaten temiz olan bir float'ta noktayı bin ayracı sanıp siler (41.67 -> 4167).
    Önce tip kontrolü yapıyoruz; sadece gerçekten virgül içeren string'lerde
    Türkçe format dönüşümü uyguluyoruz."""
    if val is None or val != val or val == "":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    try:
        val_str = str(val).strip()
        if "," in val_str:
            # Türkçe format: "1.234,56" -> bin ayracı noktaları sil, virgülü ondalık noktaya çevir
            val_str = val_str.replace(".", "").replace(",", ".")
        # virgül yoksa zaten standart ondalık formatta (örn. "41.67") — olduğu gibi çevir
        return float(val_str)
    except Exception:
        return None


def save_fundamentals(cur, stock_id, row, iy_row=None):
    def clean(v):
        return None if v is None or v != v else float(v)  # NaN kontrolü

    favok      = clean(row.get("ebitda"))
    pe_ratio   = clean(row.get("price_earnings_ttm"))
    pb_ratio   = clean(row.get("price_book_fq"))
    market_cap = clean(row.get("market_cap_basic"))
    year_high  = clean(row.get("price_52_week_high"))
    year_low   = clean(row.get("price_52_week_low"))
    net_kar    = clean(row.get("net_income"))
    roe        = clean(row.get("return_on_equity_fq"))
    total_debt = clean(row.get("total_debt"))
    ni_growth  = clean(row.get("net_income_yoy_growth_fq"))
    rev_growth = clean(row.get("total_revenue_yoy_growth_fq"))
    rsi        = clean(row.get("RSI"))
    sma50      = clean(row.get("SMA50"))
    volume     = clean(row.get("volume"))
    avg_vol10  = clean(row.get("average_volume_10d_calc"))
    pivot_s1   = clean(row.get("Pivot.M.Classic.S1"))
    pivot_r1   = clean(row.get("Pivot.M.Classic.R1"))
    macd_line  = clean(row.get("MACD.macd"))
    macd_sig   = clean(row.get("MACD.signal"))

    # İş Yatırım verisi varsa bu alanlarda TradingView'ın önüne geçer (KAP kaynaklı)
    free_float    = None
    foreign_rate  = None
    ev_ebitda     = None
    net_margin    = None
    ebitda_margin = None
    ev_sales                = None
    return_1d               = None
    return_1w               = None
    return_1m                = None
    dividend_yield          = None
    foreign_ratio_1w_change = None
    foreign_ratio_1m_change = None
    pe_hist_avg             = None
    ev_ebitda_hist_avg      = None
    target_price = upside_potential = prev_target_price = None
    last_reco_date = prev_reco_date = None
    sector_pe = sector_ev_ebitda = sector_pb = None
    sector_pe_discount = sector_pb_discount = sector_ev_ebitda_discount = None
    cash_dividend_yield = bonus_dividend_yield = None
    cash_dividend_per_share = bonus_dividend_per_share = None
    cash_payout_ratio = bonus_payout_ratio = None
    dividend_date = None
    total_dividend = None
    if iy_row is not None:
        iy_pe  = _safe_float_tr(iy_row.get("criteria_28"))    # F/K
        iy_pb  = _safe_float_tr(iy_row.get("criteria_30"))    # PD/DD
        iy_roe = _safe_float_tr(iy_row.get("criteria_422"))   # ROE
        iy_mc  = _safe_float_tr(iy_row.get("criteria_59"))    # Piyasa Değeri (mn TL)
        iy_nk  = _safe_float_tr(iy_row.get("criteria_169"))   # Net Kar (mn TL)
        free_float    = _safe_float_tr(iy_row.get("criteria_11"))   # Halka Açıklık Oranı (%)
        foreign_rate  = _safe_float_tr(iy_row.get("criteria_40"))   # Cari Yabancı Oranı (%)
        ev_ebitda     = _safe_float_tr(iy_row.get("criteria_29"))   # Cari FD/FAVÖK
        net_margin    = _safe_float_tr(iy_row.get("criteria_119"))  # Net Kar Marjı (%)
        ebitda_margin = _safe_float_tr(iy_row.get("criteria_120"))  # FAVÖK Marjı (%)
        ev_sales                = _safe_float_tr(iy_row.get("criteria_31"))   # Cari FD/Satışlar
        return_1d               = _safe_float_tr(iy_row.get("criteria_21"))   # 1 Gün Rel. (%)
        return_1w               = _safe_float_tr(iy_row.get("criteria_22"))   # 1 Hafta Rel. (%)
        return_1m               = _safe_float_tr(iy_row.get("criteria_23"))   # 1 Ay Rel. (%)
        dividend_yield          = _safe_float_tr(iy_row.get("criteria_33"))   # 2024 Temettü Verimi (%)
        foreign_ratio_1w_change = _safe_float_tr(iy_row.get("criteria_44"))   # Yabancı Oranı 1 Haftalık Değişim
        foreign_ratio_1m_change = _safe_float_tr(iy_row.get("criteria_45"))   # Yabancı Oranı 1 Aylık Değişim
        pe_hist_avg             = _safe_float_tr(iy_row.get("criteria_126"))  # Tarihsel Ort. F/K
        ev_ebitda_hist_avg      = _safe_float_tr(iy_row.get("criteria_128"))  # Tarihsel Ort. FD/FAVÖK

        # Hedef fiyat — 166 (güncel) öncelikli, boşsa 51'e (eski/yedek) düş
        target_price      = _safe_float_tr(iy_row.get("criteria_166"))
        if target_price is None:
            target_price  = _safe_float_tr(iy_row.get("criteria_51"))
        upside_potential  = _safe_float_tr(iy_row.get("criteria_167"))
        prev_target_price = _safe_float_tr(iy_row.get("criteria_338"))
        last_reco_date    = iy_row.get("criteria_132") or None
        prev_reco_date    = iy_row.get("criteria_323") or None

        # Sektörel karşılaştırma — İş Yatırım'ın kendi hesapladığı iskonto yüzdeleri
        sector_pe         = _safe_float_tr(iy_row.get("criteria_364"))
        sector_ev_ebitda  = _safe_float_tr(iy_row.get("criteria_365"))
        sector_pb         = _safe_float_tr(iy_row.get("criteria_366"))
        sector_pe_discount        = _safe_float_tr(iy_row.get("criteria_368"))
        sector_pb_discount        = _safe_float_tr(iy_row.get("criteria_369"))
        sector_ev_ebitda_discount = _safe_float_tr(iy_row.get("criteria_371"))

        # Temettü detayı — VARSAYIM: ID2=Nakit, ID3=Bedelsiz (üretimde doğrula)
        cash_dividend_yield   = _safe_float_tr(iy_row.get("criteria_156"))
        bonus_dividend_yield  = _safe_float_tr(iy_row.get("criteria_157"))
        cash_dividend_per_share  = _safe_float_tr(iy_row.get("criteria_151"))
        bonus_dividend_per_share = _safe_float_tr(iy_row.get("criteria_152"))
        cash_payout_ratio  = _safe_float_tr(iy_row.get("criteria_161"))
        bonus_payout_ratio = _safe_float_tr(iy_row.get("criteria_162"))
        dividend_date      = iy_row.get("criteria_134") or None
        total_dividend     = _safe_float_tr(iy_row.get("criteria_326"))

        if iy_pe  is not None: pe_ratio   = iy_pe
        if iy_pb  is not None: pb_ratio   = iy_pb
        if iy_roe is not None: roe        = iy_roe
        if iy_mc  is not None: market_cap = iy_mc
        if iy_nk  is not None: net_kar    = iy_nk

    cur.execute(
        """
        INSERT INTO fundamentals_snapshots
          (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low,
           roe, total_debt, net_income_yoy_growth, revenue_yoy_growth,
           rsi, sma50, volume, avg_volume_10d, pivot_s1, pivot_r1, macd_line, macd_signal_line,
           free_float, foreign_ratio, ev_ebitda, net_margin, ebitda_margin,
           ev_sales, return_1d, return_1w, return_1m, dividend_yield,
           foreign_ratio_1w_change, foreign_ratio_1m_change, pe_hist_avg, ev_ebitda_hist_avg,
           target_price, upside_potential, prev_target_price, last_reco_date, prev_reco_date,
           sector_pe, sector_ev_ebitda, sector_pb,
           sector_pe_discount, sector_pb_discount, sector_ev_ebitda_discount,
           cash_dividend_yield, bonus_dividend_yield,
           cash_dividend_per_share, bonus_dividend_per_share,
           cash_payout_ratio, bonus_payout_ratio, dividend_date, total_dividend,
           updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (stock_id) DO UPDATE SET
          favok                  = EXCLUDED.favok,
          net_kar                = EXCLUDED.net_kar,
          pe_ratio               = EXCLUDED.pe_ratio,
          pb_ratio               = EXCLUDED.pb_ratio,
          market_cap             = EXCLUDED.market_cap,
          year_high              = EXCLUDED.year_high,
          year_low               = EXCLUDED.year_low,
          roe                    = EXCLUDED.roe,
          total_debt             = EXCLUDED.total_debt,
          net_income_yoy_growth  = EXCLUDED.net_income_yoy_growth,
          revenue_yoy_growth     = EXCLUDED.revenue_yoy_growth,
          rsi                    = EXCLUDED.rsi,
          sma50                  = EXCLUDED.sma50,
          volume                 = EXCLUDED.volume,
          avg_volume_10d         = EXCLUDED.avg_volume_10d,
          pivot_s1               = EXCLUDED.pivot_s1,
          pivot_r1               = EXCLUDED.pivot_r1,
          macd_line              = EXCLUDED.macd_line,
          macd_signal_line       = EXCLUDED.macd_signal_line,
          free_float             = EXCLUDED.free_float,
          foreign_ratio          = EXCLUDED.foreign_ratio,
          ev_ebitda              = EXCLUDED.ev_ebitda,
          net_margin             = EXCLUDED.net_margin,
          ebitda_margin          = EXCLUDED.ebitda_margin,
          ev_sales                 = EXCLUDED.ev_sales,
          return_1d                = EXCLUDED.return_1d,
          return_1w                = EXCLUDED.return_1w,
          return_1m                = EXCLUDED.return_1m,
          dividend_yield           = EXCLUDED.dividend_yield,
          foreign_ratio_1w_change  = EXCLUDED.foreign_ratio_1w_change,
          foreign_ratio_1m_change  = EXCLUDED.foreign_ratio_1m_change,
          pe_hist_avg              = EXCLUDED.pe_hist_avg,
          ev_ebitda_hist_avg       = EXCLUDED.ev_ebitda_hist_avg,
          target_price              = EXCLUDED.target_price,
          upside_potential           = EXCLUDED.upside_potential,
          prev_target_price          = EXCLUDED.prev_target_price,
          last_reco_date             = EXCLUDED.last_reco_date,
          prev_reco_date             = EXCLUDED.prev_reco_date,
          sector_pe                  = EXCLUDED.sector_pe,
          sector_ev_ebitda           = EXCLUDED.sector_ev_ebitda,
          sector_pb                  = EXCLUDED.sector_pb,
          sector_pe_discount         = EXCLUDED.sector_pe_discount,
          sector_pb_discount         = EXCLUDED.sector_pb_discount,
          sector_ev_ebitda_discount  = EXCLUDED.sector_ev_ebitda_discount,
          cash_dividend_yield        = EXCLUDED.cash_dividend_yield,
          bonus_dividend_yield       = EXCLUDED.bonus_dividend_yield,
          cash_dividend_per_share    = EXCLUDED.cash_dividend_per_share,
          bonus_dividend_per_share   = EXCLUDED.bonus_dividend_per_share,
          cash_payout_ratio          = EXCLUDED.cash_payout_ratio,
          bonus_payout_ratio         = EXCLUDED.bonus_payout_ratio,
          dividend_date              = EXCLUDED.dividend_date,
          total_dividend             = EXCLUDED.total_dividend,
          updated_at             = NOW()
        """,
        (stock_id, favok, net_kar, pe_ratio, pb_ratio, market_cap, year_high, year_low,
         roe, total_debt, ni_growth, rev_growth,
         rsi, sma50, volume, avg_vol10, pivot_s1, pivot_r1, macd_line, macd_sig,
         free_float, foreign_rate, ev_ebitda, net_margin, ebitda_margin,
         ev_sales, return_1d, return_1w, return_1m, dividend_yield,
         foreign_ratio_1w_change, foreign_ratio_1m_change, pe_hist_avg, ev_ebitda_hist_avg,
         target_price, upside_potential, prev_target_price, last_reco_date, prev_reco_date,
         sector_pe, sector_ev_ebitda, sector_pb,
         sector_pe_discount, sector_pb_discount, sector_ev_ebitda_discount,
         cash_dividend_yield, bonus_dividend_yield,
         cash_dividend_per_share, bonus_dividend_per_share,
         cash_payout_ratio, bonus_payout_ratio, dividend_date, total_dividend),
    )


def run_fetch_fundamentals():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, symbol FROM stocks WHERE is_active = TRUE ORDER BY symbol")
            stocks = cur.fetchall()
            symbol_to_id = {symbol: stock_id for stock_id, symbol in stocks}

            symbols = list(symbol_to_id.keys())

            print(f"📊 TradingView'dan {len(symbols)} hisse için temel+teknik veri çekiliyor...")
            df = fetch_all(symbols)
            print(f"   {len(df)} hisse için TradingView verisi döndü")

            print("📊 İş Yatırım Screener'dan PE/PB/ROE/Piyasa Değeri/Net Kar çekiliyor...")
            iy_data = fetch_isyatirim(symbols)
            print(f"   {len(iy_data)} hisse için İş Yatırım verisi döndü")

            saved, skipped = 0, 0
            for _, row in df.iterrows():
                symbol = row["name"]
                stock_id = symbol_to_id.get(symbol)
                if not stock_id:
                    skipped += 1
                    continue
                try:
                    cur.execute("SAVEPOINT sp_fundamentals")
                    save_fundamentals(cur, stock_id, row, iy_data.get(symbol))
                    cur.execute("RELEASE SAVEPOINT sp_fundamentals")
                    saved += 1
                except Exception as err:
                    cur.execute("ROLLBACK TO SAVEPOINT sp_fundamentals")
                    print(f"   ❌ {symbol}: {err}")

            conn.commit()

    missing = len(symbol_to_id) - saved - skipped
    print(f"\n✅ Tamamlandı: {saved} kaydedildi, {skipped} eşleşmedi, {missing} TradingView'da bulunamadı")
    return {"saved": saved, "skipped": skipped}


if __name__ == "__main__":
    run_fetch_fundamentals()
