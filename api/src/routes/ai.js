import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

const FILTER_DEFINITIONS = {
  HAFTALIK_1: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS negatif ya da son 3 mumda 0'ı yukarı kesmiş",
  HAFTALIK_2: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS 0'ı yukarı keser, CCI(20) 100'ü yukarı keser",
  HAFTALIK_3: "Haftalık INV1(9) 0.5'i yukarı keser, Fiyat EMA21'i yukarı keser, MACDAS 0'ı yukarı keser, CCI(20) > -100",
  GUNLUK_1:   "Günlük INV1(13) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS > 0, CCI(20) 100'ü yukarı keser",
};

function fmt(v, d = 2) {
  return v == null ? "veri yok" : Number(v).toFixed(d);
}

// DİKKAT: Bilanço kaynağı değişti — artık mali_tablolar.py, sirket-karti.aspx'i
// scrape ederek Bilanço + Gelir Tablosu + Nakit Akım Tablosu'nu TEK JSON'da
// yazıyor: {periods:[...], sections:{"Bilanço":{...}, "Gelir Tablosu":{...},
// "Nakit Akım Tablosu":{...}}}. Eski {data,prev_data} yapısı artık gelmiyor —
// bu fonksiyon o yüzden yeniden yazıldı.
function formatBalanceSheet(f) {
  const bs = f.balance_sheet_json;
  if (!bs || !bs.sections || !bs.periods?.length) return null;

  const { periods, sections } = bs;
  const financialGroup = f.financial_group || null;

  const formatSection = (sectionName, maxRows) => {
    const rows = sections[sectionName];
    if (!rows) return null;
    // Öncelik: "TOPLAM"/"ÖZKAYNAK"/"NET" geçen üst kalemler, token limiti için üst sınır
    const keys = Object.keys(rows);
    const priority = keys.filter(k => /toplam|özkaynak|net kar|net kâr/i.test(k));
    const rest = keys.filter(k => !priority.includes(k));
    const ordered = [...priority, ...rest].slice(0, maxRows);

    return ordered.map(label => {
      const vals = rows[label] || [];
      const curStr = vals[0] != null ? Number(vals[0]).toLocaleString("tr-TR") : "veri yok";
      if (vals[1] != null && vals[0] != null && vals[1] !== 0) {
        const changePct = (((vals[0] - vals[1]) / Math.abs(vals[1])) * 100).toFixed(1);
        return `- ${label}: ${curStr} (önceki döneme göre %${changePct})`;
      }
      return `- ${label}: ${curStr}`;
    }).join("\n");
  };

  const bilanco = formatSection("Bilanço", 20);
  const gelirTablosu = formatSection("Gelir Tablosu", 15);
  const nakitAkim = formatSection("Nakit Akım Tablosu", 10);

  if (!bilanco && !gelirTablosu && !nakitAkim) return null;

  return {
    financialGroup,
    period: periods[0],
    prevPeriod: periods[1] || null,
    text: [
      bilanco ? `BİLANÇO:\n${bilanco}` : null,
      gelirTablosu ? `GELİR TABLOSU:\n${gelirTablosu}` : null,
      nakitAkim ? `NAKİT AKIM TABLOSU (özet):\n${nakitAkim}` : null,
    ].filter(Boolean).join("\n\n"),
  };
}

async function getHistoricalStats(filterCode) {
  const { rows } = await query(
    `SELECT
       COUNT(*) AS total,
       ROUND(AVG(change_pct)::numeric, 2) AS avg_change_pct,
       COUNT(*) FILTER (WHERE change_pct > 0) AS winners,
       ROUND(AVG(EXTRACT(EPOCH FROM (milestone_10_at - entry_date)) / 86400)::numeric, 1) AS avg_days_to_10
     FROM tracked_signals
     WHERE filter_types LIKE $1`,
    [`%${filterCode}%`]
  );
  return rows[0];
}

// BIST Özelleştirmeli, Sektörel ve Tarihsel Çarpan Destekli AI Analiz Rotası
router.post("/stocks/:symbol/comment", authenticate, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    const { rows: userRows } = await query(
      "SELECT plan, openai_api_key FROM users WHERE id = $1",
      [req.user.id]
    );
    const currentUser = userRows[0];
    if (currentUser?.plan !== "pro") {
      return res.status(403).json({ error: "AI yorum özelliği sadece Pro üyeler için kullanılabilir." });
    }
    const apiKey = currentUser?.openai_api_key;
    if (!apiKey) {
      return res.status(400).json({ error: "Önce Ayarlar sayfasından OpenAI API key girmelisin." });
    }

    const { rows: stockRows } = await query(
      `SELECT s.id, s.symbol, s.name, s.sector, q.price, q.change_pct
       FROM stocks s LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE s.symbol = $1`,
      [symbol]
    );
    const stock = stockRows[0];
    if (!stock) return res.status(404).json({ error: "Hisse bulunamadı." });

    const { rows: indexRows } = await query(
      "SELECT index_code FROM stock_indices WHERE stock_id = $1 ORDER BY index_code",
      [stock.id]
    );
    const indexMemberships = indexRows.map(r => r.index_code);

    const { rows: filterRows } = await query("SELECT * FROM indicator_snapshots WHERE stock_id = $1", [stock.id]);
    const filterData = filterRows[0] || {};

    const { rows: fundRows } = await query("SELECT * FROM fundamentals_snapshots WHERE stock_id = $1", [stock.id]);
    const f = fundRows[0] || {};

    // KAP haberleri — SON 14 GÜN.
    // Eskiden sadece "LIMIT 3" vardı, tarih filtresi yoktu: çok bildirim yapan
    // hisselerde 3 haber tek güne sığıyor (eksik resim), hiç bildirim yapmayan
    // hisselerde ise aylar önceki haberler "güncel" gibi AI'ya gidiyordu
    // (yanıltıcı). Şimdi sabit bir zaman penceresi var; adet tavanı da
    // prompt'un şişmemesi için yüksek tutuldu.
    const NEWS_WINDOW_DAYS = 14;
    const { rows: newsRows } = await query(
      `SELECT title, published_at
       FROM stock_news
       WHERE stock_id = $1
         AND published_at >= NOW() - ($2 || ' days')::interval
       ORDER BY published_at DESC
       LIMIT 15`,
      [stock.id, NEWS_WINDOW_DAYS]
    );

    // Sektörel Ortalamaları Dinamik Hesaplama
    // Sektördeki aşırı uçları (outliers) törpülemek için basit filtreler (PE < 150 vb.) kullanıyoruz.
    let sectorData = null;
    if (stock.sector) {
      const { rows: sectorRows } = await query(
        `SELECT 
           AVG(f.pe_ratio) FILTER (WHERE f.pe_ratio > 0 AND f.pe_ratio < 150) as avg_pe,
           AVG(f.pb_ratio) FILTER (WHERE f.pb_ratio > 0 AND f.pb_ratio < 30) as avg_pb,
           AVG(f.ev_ebitda) FILTER (WHERE f.ev_ebitda > 0 AND f.ev_ebitda < 100) as avg_ev_ebitda,
           AVG(f.roe) as avg_roe,
           AVG(f.dividend_yield) FILTER (WHERE f.dividend_yield > 0) as avg_dividend_yield
         FROM stocks s
         JOIN fundamentals_snapshots f ON f.stock_id = s.id
         WHERE s.sector = $1`,
        [stock.sector]
      );
      sectorData = sectorRows[0];
    }

    const activeFilterCodes = [];
    if (filterData.haftalik_1) activeFilterCodes.push("HAFTALIK_1");
    if (filterData.haftalik_2) activeFilterCodes.push("HAFTALIK_2");
    if (filterData.haftalik_3) activeFilterCodes.push("HAFTALIK_3");
    if (filterData.gunluk_1)   activeFilterCodes.push("GUNLUK_1");

    const historicalStats = {};
    for (const code of activeFilterCodes) {
      historicalStats[code] = await getHistoricalStats(code);
    }

    // ── Türetilmiş değerler ──
    const netDebtToEbitda = (f.total_debt != null && f.favok) ? (f.total_debt / f.favok) : null;
    const priceVsSma50 = (stock.price != null && f.sma50 != null)
      ? (Number(stock.price) > f.sma50 ? "üzerinde" : "altında") : null;
    const macdSignalRel = (f.macd_line != null && f.macd_signal_line != null)
      ? (f.macd_line > f.macd_signal_line ? "AL yönünde (MACD sinyalin üzerinde)" : "SAT yönünde (MACD sinyalin altında)")
      : null;
    const volumeStatus = (f.volume != null && f.avg_volume_10d) ?
      (((f.volume / f.avg_volume_10d) - 1) * 100) : null;
    const pegRatio = (f.pe_ratio != null && f.net_income_yoy_growth && f.net_income_yoy_growth > 0)
      ? (f.pe_ratio / f.net_income_yoy_growth) : null;
    const balanceSheet = formatBalanceSheet(f);

    // Hedef fiyat / analist önerisi — doğal olarak seyrek (sadece analist
    // takibi olan hisselerde veri var), "veri yok" çıkması normal.
    const targetPriceText = (f.target_price != null)
      ? `Analist Hedef Fiyatı: ${fmt(f.target_price)} TL (Getiri Potansiyeli: %${fmt(f.upside_potential)})` +
        (f.prev_target_price != null ? ` | Önceki Hedef: ${fmt(f.prev_target_price)} TL` : "") +
        (f.last_reco_date ? ` | Son Öneri Tarihi: ${f.last_reco_date}` : "")
      : "Analist hedef fiyatı verisi yok (bu hisse için yayınlanmış bir kurum tahmini bulunmuyor olabilir).";

    // Temettü detayı — DİKKAT: {ID2}/{ID3} kriterlerinin "nakit/bedelsiz" mi
    // yoksa "brüt/net oran" mı olduğu kesinleşmedi (bkz. sirket-karti.aspx'te
    // görülen Brüt/Net Oran kolonları). Bu yüzden kesin bir etiket iddia
    // etmiyoruz, iki oranı da nötr şekilde sunuyoruz.
    const dividendDetailText = (f.cash_dividend_yield != null || f.cash_dividend_per_share != null)
      ? `Temettü Verimi Oranları: %${fmt(f.cash_dividend_yield)} / %${fmt(f.bonus_dividend_yield)}` +
        (f.cash_dividend_per_share != null ? ` | Hisse Başı Temettü: ${fmt(f.cash_dividend_per_share)} TL` : "")
      : null;

    const prompt = `
Sen Borsa İstanbul (BIST) dinamiklerine tam hakim, deneyimli bir kıdemli portföy yöneticisi ve analistsin. Aşağıda temel, sektörel, temettü, teknik ve haber (KAP) verilerini paylaştığım ${stock.symbol} (${stock.name}) hissesi için profesyonel, veri odaklı ve objektif bir analiz yapmanı istiyorum.

1. ŞİRKET VE TEMEL BÜYÜME VERİLERİ:
- Sektör: ${stock.sector ?? "bilinmiyor"}
- Endeks Üyelikleri: ${indexMemberships.length ? indexMemberships.join(", ") : "yok / bilinmiyor"}
- Piyasa Değeri (Market Cap): ${f.market_cap ? Number(f.market_cap).toLocaleString("tr-TR") + " TL" : "veri yok"}
- F/K Oranı: ${fmt(f.pe_ratio)} | Kendi Tarihsel F/K Ortalaması: ${fmt(f.pe_hist_avg)}
- FD/FAVÖK: ${fmt(f.ev_ebitda)} | Kendi Tarihsel FD/FAVÖK Ort: ${fmt(f.ev_ebitda_hist_avg)}
- PD/DD Oranı: ${fmt(f.pb_ratio)}
- PEG Rasyosu: ${pegRatio != null ? pegRatio.toFixed(2) : "veri yok (büyüme negatif/yok)"}
- Özsermaye Karlılığı (ROE): %${fmt(f.roe, 1)}
- Kâr Marjları: Net Marj %${fmt(f.net_margin, 1)}, FAVÖK Marjı %${fmt(f.ebitda_margin, 1)}
- Son Çeyrek Finansalları: Net kâr yıllık %${fmt(f.net_income_yoy_growth, 1)}, ciro %${fmt(f.revenue_yoy_growth, 1)} değişti.
- Borç Durumu: Toplam Borç/FAVÖK oranı ~ ${netDebtToEbitda != null ? netDebtToEbitda.toFixed(2) : "veri yok"}
- ${targetPriceText}

2. SEKTÖREL KARŞILAŞTIRMA (Sektör: ${stock.sector ?? "Bilinmiyor"}):
${sectorData ? `
- Sektör Ortalama F/K: ${fmt(sectorData.avg_pe)} (Hisse: ${fmt(f.pe_ratio)})
- Sektör Ortalama PD/DD: ${fmt(sectorData.avg_pb)} (Hisse: ${fmt(f.pb_ratio)})
- Sektör Ortalama FD/FAVÖK: ${fmt(sectorData.avg_ev_ebitda)} (Hisse: ${fmt(f.ev_ebitda)})
- Sektör Ortalama ROE: %${fmt(sectorData.avg_roe, 1)} (Hisse: %${fmt(f.roe, 1)})
- Sektör Ortalama Temettü Verimi: %${fmt(sectorData.avg_dividend_yield)} (Hisse: %${fmt(f.dividend_yield)})
` : "- Sektörel ortalama verisi hesaplanamadı."}

3. TEMETTÜ, YABANCI TAKASI VE MOMENTUM (BIST Dinamikleri):
- Temettü Verimi: %${fmt(f.dividend_yield)}
- Yabancı Takas Oranı: %${fmt(f.foreign_ratio, 1)}
- Yabancı Takası Değişimi: Son 1 haftada %${fmt(f.foreign_ratio_1w_change, 2)}, son 1 ayda %${fmt(f.foreign_ratio_1m_change, 2)}
- Hisse Getirisi: Günlük %${fmt(f.return_1d)}, Haftalık %${fmt(f.return_1w)}, Aylık %${fmt(f.return_1m)}
${dividendDetailText ? `- ${dividendDetailText}` : ""}

4. TEKNİK ANALİZ VERİLERİ:
- Güncel Fiyat: ${stock.price ?? "?"} TL (${stock.change_pct ?? "?"}%)
- Destek / Direnç: Yakın destek ~${fmt(f.pivot_s1)}, yakın direnç ~${fmt(f.pivot_r1)}
- RSI: ${fmt(f.rsi, 1)}
- MACD: ${macdSignalRel ?? "veri yok"}
- 50 Günlük HO: Fiyat HO'nun ${priceVsSma50 ?? "veri yok"} (HO: ${fmt(f.sma50)})
- Hacim: Güncel hacim, 10 günlük ortalamanın ${volumeStatus != null ? (volumeStatus >= 0 ? `%${volumeStatus.toFixed(0)} üzerinde` : `%${Math.abs(volumeStatus).toFixed(0)} altında`) : "veri yok"}

TETİKLENEN ÖZEL TEKNİK FİLTRELER (Algoritmamız):
${activeFilterCodes.length ? activeFilterCodes.map(c => {
  const s = historicalStats[c];
  const winRate = s.total > 0 ? ((s.winners / s.total) * 100).toFixed(0) : "0";
  return `- ${c}: ${FILTER_DEFINITIONS[c]} | Geçmişte ${s.total} örnek, ortalama getiri %${s.avg_change_pct ?? "?"}, kazanma oranı %${winRate}, %10 kazanca ortalama ${s.avg_days_to_10 ?? "?"} günde ulaşılmış.`;
}).join("\n") : "- Şu an hiçbir özel filtre tetiklenmiyor."}

5. KAP HABERLERİ VE BİLANÇO:
KAP bildirimleri (son ${NEWS_WINDOW_DAYS} gün):
${newsRows.length
  ? newsRows.map(n => `- [${new Date(n.published_at).toLocaleDateString("tr-TR")}] ${n.title}`).join("\n")
  : `- Son ${NEWS_WINDOW_DAYS} günde KAP bildirimi yok. (Haber yokluğu olumsuz bir sinyal DEĞİLDİR — çoğu şirket her hafta bildirim yapmaz.)`}
${balanceSheet ? `\nBİLANÇO YAPISI (${balanceSheet.financialGroup} formatı, Dönem: ${balanceSheet.period}${balanceSheet.prevPeriod ? `, karşılaştırma dönemi: ${balanceSheet.prevPeriod}` : ""}):\n${balanceSheet.text}` : ""}

SENDEN İSTEDİKLERİM (Aşağıdaki JSON şemasına kesinlikle sadık kal):
1. "finansal_saglik": Çarpanları hem sektör ortalamalarıyla hem şirketin kendi tarihsel ortalamalarıyla kıyasla, kârlılığı ve borçluluğu yorumla (2-4 cümle).
2. "temettu_ve_takas": Temettü verimini, varsa hedef fiyat/analist önerisini ve yabancı takas değişimini yorumla (2-3 cümle).
3. "teknik_temel_uyumu": Fiyat momentumu, hacim, yabancı ilgisi ve teknik filtrelerin (geçmiş başarı oranlarını da tartarak) temel tabloyu destekleyip desteklemediğini açıkla (2-4 cümle).
4. "kap_etkisi": KAP haberlerinin kısa/orta vadede fiyatlamaya olası etkisi (2-3 cümle, haber yoksa "Güncel KAP haberi bulunmuyor" yaz).
5. "bilanco_yorumu": Bilanço/gelir tablosu/nakit akım dönem aktivitesini yorumla${balanceSheet ? "" : " — veri yoksa \"Bilanço verisi bulunmuyor\" yaz"} (2-3 cümle).
6. "riskler" ve "firsatlar": Her biri en az 2 madde, somut verilere dayalı.
7. "tavsiye" (AL/SAT/BEKLE) ve "risk_seviyesi" (Düşük/Orta/Yüksek): Analizinle tutarlı bir sonuca bağla.

SADECE AŞAĞIDAKİ JSON FORMATINDA CEVAP VER:
{
  "finansal_saglik": "...",
  "temettu_ve_takas": "...",
  "teknik_temel_uyumu": "...",
  "kap_etkisi": "...",
  "bilanco_yorumu": "...",
  "riskler": ["...", "..."],
  "firsatlar": ["...", "..."],
  "tavsiye": "AL" | "SAT" | "BEKLE",
  "risk_seviyesi": "Düşük" | "Orta" | "Yüksek"
}`.trim();

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // Veya ihtiyaca göre gpt-4o
        messages: [
          { role: "system", content: "Sen deneyimli bir Borsa İstanbul (BIST) analistisin. Verileri sentezleyerek nesnel, profesyonel bir JSON çıktısı üretirsin. Yatırım tavsiyesi niteliği taşımadığını unutma." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 1500,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(502).json({ error: `OpenAI hatası: ${errText}` });
    }

    const aiData = await aiRes.json();
    const responseText = aiData.choices[0].message.content;

    // Tavsiyeyi (AL/SAT/BEKLE) ve o anki fiyatı ayrı kolonlarda saklıyoruz —
    // böylece daha sonra "bu tavsiye doğru çıktı mı" diye ölçebiliyoruz.
    let parsedComment = null;
    try {
      parsedComment = JSON.parse(responseText);
    } catch {
      parsedComment = null;
    }
    const tavsiye = parsedComment?.tavsiye ?? null;
    const entryPrice = stock.price ?? null;

    await query(
      "INSERT INTO ai_commentary (stock_id, user_id, question, response, tavsiye, entry_price) VALUES ($1, $2, $3, $4, $5, $6)",
      [stock.id, req.user.id, prompt, responseText, tavsiye, entryPrice]
    );

    res.json({ symbol: stock.symbol, comment: parsedComment ?? responseText });
  } catch (err) {
    next(err);
  }
});

router.get("/stocks/:symbol/comment/history", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ac.id, ac.response, ac.created_at
       FROM ai_commentary ac
       JOIN stocks s ON s.id = ac.stock_id
       WHERE s.symbol = $1 AND ac.user_id = $2
       ORDER BY ac.created_at DESC
       LIMIT 10`,
      [req.params.symbol.toUpperCase(), req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/commentary", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ac.id, ac.response, ac.created_at, s.symbol, s.name
       FROM ai_commentary ac
       JOIN stocks s ON s.id = ac.stock_id
       WHERE ac.user_id = $1
       ORDER BY ac.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/performance — AL/SAT/BEKLE tavsiyelerinin isabet oranı raporu
// (tavsiyeden bu yana fiyat gerçekten doğru yönde hareket etti mi)
router.get("/performance", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ac.id, ac.tavsiye, ac.entry_price, ac.created_at, s.symbol, s.name, q.price AS current_price
       FROM ai_commentary ac
       JOIN stocks s ON s.id = ac.stock_id
       LEFT JOIN stock_quotes q ON q.stock_id = ac.stock_id
       WHERE ac.user_id = $1 AND ac.tavsiye IS NOT NULL AND ac.entry_price IS NOT NULL
       ORDER BY ac.created_at DESC`,
      [req.user.id]
    );

    // entry_price/tavsiye olmayan (eski) kayıtlar ya da güncel fiyatı henüz
    // gelmemiş hisseler isabet hesabına dahil edilemez.
    const withChange = rows
      .filter(r => r.current_price != null)
      .map(r => ({
        ...r,
        change_pct: ((Number(r.current_price) - Number(r.entry_price)) / Number(r.entry_price)) * 100,
      }));

    const grouped = { AL: [], SAT: [], BEKLE: [] };
    for (const r of withChange) {
      if (grouped[r.tavsiye]) grouped[r.tavsiye].push(r);
    }

    const summarize = (items, tavsiye) => {
      const total = items.length;
      if (total === 0) return { tavsiye, total: 0, avg_change_pct: null, win_rate: null, items: [] };

      const avgChange = items.reduce((sum, i) => sum + i.change_pct, 0) / total;

      // "İsabet" tanımı: AL sonrası fiyat yükseldiyse, SAT sonrası düştüyse doğru sayılır.
      // BEKLE için net bir doğru/yanlış tanımı olmadığından win_rate hesaplanmaz.
      let winners = null;
      if (tavsiye === "AL") winners = items.filter(i => i.change_pct > 0).length;
      else if (tavsiye === "SAT") winners = items.filter(i => i.change_pct < 0).length;

      return {
        tavsiye,
        total,
        avg_change_pct: Math.round(avgChange * 100) / 100,
        win_rate: winners != null ? Math.round((winners / total) * 100) : null,
        items: items
          .map(i => ({
            symbol: i.symbol,
            name: i.name,
            entry_price: Number(i.entry_price),
            current_price: Number(i.current_price),
            change_pct: Math.round(i.change_pct * 100) / 100,
            created_at: i.created_at,
          }))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      };
    };

    const result = ["AL", "SAT", "BEKLE"].map(t => summarize(grouped[t], t));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;