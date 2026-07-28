import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

const FILTER_DEFINITIONS = {
  HAFTALIK_1: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS negatif ya da son 3 mumda 0'ı yukarı kesmiş",
  HAFTALIK_2: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS 0'ı yukarı keser, CCI(20) 100'ü yukarı keser",
  HAFTALIK_3: "Haftalık INV1(9) 0.5'i yukarı keser, Fiyat EMA21'i yukarı keser, MACDAS 0'ı yukarı keser, CCI(20) > -100",
  GUNLUK_1:   "Günlük INV1(13) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS > 0, CCI(20) 100'ü yukarı keser",
  CCI100_HAFTALIK:  "Haftalık CCI(20) 100 seviyesini yukarı keser",
  CCI100_GUNLUK:    "Günlük CCI(20) 100 seviyesini yukarı keser",
  IFTCCI5_HAFTALIK: "Haftalık IFTCCI5 (CCI5 + WMA9 + Inverse Fisher) 0.5 seviyesini yukarı keser",
  IFTCCI5_GUNLUK:   "Günlük IFTCCI5 (CCI5 + WMA9 + Inverse Fisher) 0.5 seviyesini yukarı keser",
};

function fmt(v, d = 2) {
  return v == null ? "veri yok" : Number(v).toFixed(d);
}

// Bilanço satır adlarını (Toplam Varlıklar, Özkaynaklar vb.) tahmin etmiyoruz —
// borsapy'den gelen ham JSON'u, "TOPLAM"/"ÖZKAYNAK" geçen üst-kalem satırlarını
// öne çıkararak (token limiti için üst sınır koyup) olduğu gibi AI'ya veriyoruz.
function formatBalanceSheet(f) {
  const bs = f.balance_sheet_json;
  if (!bs || !bs.data || !Object.keys(bs.data).length) return null;

  const { data, prev_data, prev_period } = bs;
  const priorityKeys = Object.keys(data).filter(k => /toplam|özkaynak/i.test(k));
  const otherKeys = Object.keys(data).filter(k => !priorityKeys.includes(k));
  const orderedKeys = [...priorityKeys, ...otherKeys].slice(0, 25);

  const lines = orderedKeys.map(k => {
    const cur = data[k];
    const prev = prev_data ? prev_data[k] : null;
    const curStr = cur != null ? Number(cur).toLocaleString("tr-TR") : "veri yok";
    if (prev != null && cur != null && prev !== 0) {
      const changePct = (((cur - prev) / Math.abs(prev)) * 100).toFixed(1);
      return `- ${k}: ${curStr} TL (önceki döneme göre %${changePct})`;
    }
    return `- ${k}: ${curStr} TL`;
  });

  return {
    financialGroup: f.financial_group,
    period: f.balance_sheet_period,
    prevPeriod: prev_period,
    text: lines.join("\n"),
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

// BIST özelleştirmeli AI analiz rotası — sadece şemada var olan tablolar/kolonlar kullanılır:
// stocks, stock_quotes, stock_indices, fundamentals_snapshots, indicator_snapshots,
// stock_news, tracked_signals, corporate_actions
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
      `SELECT s.id, s.symbol, s.name, s.sector, s.industry,
              q.price, q.change_pct, q.day_high, q.day_low
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

    const { rows: indicatorRows } = await query("SELECT * FROM indicator_snapshots WHERE stock_id = $1", [stock.id]);
    const ind = indicatorRows[0] || {};

    const { rows: fundRows } = await query("SELECT * FROM fundamentals_snapshots WHERE stock_id = $1", [stock.id]);
    const f = fundRows[0] || {};

    const { rows: newsRows } = await query(
      "SELECT title, published_at FROM stock_news WHERE stock_id = $1 ORDER BY published_at DESC NULLS LAST LIMIT 4",
      [stock.id]
    );

    // Sermaye artırımı / temettü takvimi (son 5 kayıt)
    const { rows: corpRows } = await query(
      `SELECT event_date, bedelli_oran, bedelsiz_ic_oran, bedelsiz_tm_oran, nakit_tm_oran, ruchan_oran
       FROM corporate_actions
       WHERE stock_id = $1
       ORDER BY event_date DESC
       LIMIT 5`,
      [stock.id]
    );

    // Sektörel ortalamalar — aşırı uçları (outlier) törpüleyen filtrelerle
    let sectorData = null;
    if (stock.sector) {
      const { rows: sectorRows } = await query(
        `SELECT
           COUNT(*) AS n,
           AVG(f.pe_ratio)   FILTER (WHERE f.pe_ratio > 0 AND f.pe_ratio < 150)   AS avg_pe,
           AVG(f.pb_ratio)   FILTER (WHERE f.pb_ratio > 0 AND f.pb_ratio < 30)    AS avg_pb,
           AVG(f.ev_ebitda)  FILTER (WHERE f.ev_ebitda > 0 AND f.ev_ebitda < 100) AS avg_ev_ebitda,
           AVG(f.roe)        FILTER (WHERE f.roe > -100 AND f.roe < 200)          AS avg_roe,
           AVG(f.net_margin) FILTER (WHERE f.net_margin > -100 AND f.net_margin < 100) AS avg_net_margin,
           AVG(f.dividend_yield) FILTER (WHERE f.dividend_yield > 0)              AS avg_dividend_yield
         FROM stocks s
         JOIN fundamentals_snapshots f ON f.stock_id = s.id
         WHERE s.sector = $1`,
        [stock.sector]
      );
      sectorData = sectorRows[0];
    }

    const activeFilterCodes = [];
    if (ind.haftalik_1) activeFilterCodes.push("HAFTALIK_1");
    if (ind.haftalik_2) activeFilterCodes.push("HAFTALIK_2");
    if (ind.haftalik_3) activeFilterCodes.push("HAFTALIK_3");
    if (ind.gunluk_1)   activeFilterCodes.push("GUNLUK_1");
    if (ind.cci100_haftalik)  activeFilterCodes.push("CCI100_HAFTALIK");
    if (ind.cci100_gunluk)    activeFilterCodes.push("CCI100_GUNLUK");
    if (ind.iftcci5_haftalik) activeFilterCodes.push("IFTCCI5_HAFTALIK");
    if (ind.iftcci5_gunluk)   activeFilterCodes.push("IFTCCI5_GUNLUK");

    const historicalStats = {};
    for (const code of activeFilterCodes) {
      historicalStats[code] = await getHistoricalStats(code);
    }

    // ── Türetilmiş değerler ──
    const price = stock.price != null ? Number(stock.price) : null;
    const netDebtToEbitda = (f.total_debt != null && f.favok) ? (f.total_debt / f.favok) : null;
    const priceVsSma50 = (price != null && f.sma50 != null)
      ? (price > f.sma50 ? "üzerinde" : "altında") : null;
    const macdSignalRel = (f.macd_line != null && f.macd_signal_line != null)
      ? (f.macd_line > f.macd_signal_line ? "AL yönünde (MACD sinyalin üzerinde)" : "SAT yönünde (MACD sinyalin altında)")
      : null;
    const volumeStatus = (f.volume != null && f.avg_volume_10d) ?
      (((f.volume / f.avg_volume_10d) - 1) * 100) : null;
    // PEG = F/K / büyüme oranı — sadece büyüme pozitifse anlamlı bir çarpan verir
    const pegRatio = (f.pe_ratio != null && f.net_income_yoy_growth && f.net_income_yoy_growth > 0)
      ? (f.pe_ratio / f.net_income_yoy_growth) : null;
    // 52 hafta bandındaki konum
    const distFromHigh = (price != null && f.year_high) ? ((price - f.year_high) / f.year_high) * 100 : null;
    const distFromLow  = (price != null && f.year_low)  ? ((price - f.year_low)  / f.year_low)  * 100 : null;
    // Fiili dolaşımdaki piyasa değeri (likidite/oynaklık göstergesi)
    const floatMcap = (f.market_cap != null && f.free_float != null)
      ? (Number(f.market_cap) * Number(f.free_float) / 100) : null;
    const balanceSheet = formatBalanceSheet(f);

    // Sermaye artırımı/temettü satırları — YAKLAŞAN/geçmiş ayrımı önemli
    const corpActionsText = corpRows.map(ca => {
      const parts = [];
      if (Number(ca.bedelli_oran) > 0)     parts.push(`Bedelli sermaye artırımı %${fmt(ca.bedelli_oran)}`);
      if (Number(ca.bedelsiz_ic_oran) > 0) parts.push(`Bedelsiz (iç kaynak) %${fmt(ca.bedelsiz_ic_oran)}`);
      if (Number(ca.bedelsiz_tm_oran) > 0) parts.push(`Bedelsiz (temettü) %${fmt(ca.bedelsiz_tm_oran)}`);
      if (Number(ca.nakit_tm_oran) > 0)    parts.push(`Nakit temettü %${fmt(ca.nakit_tm_oran)}`);
      if (Number(ca.ruchan_oran) > 0)      parts.push(`Rüçhan hakkı %${fmt(ca.ruchan_oran)}`);
      const d = ca.event_date ? new Date(ca.event_date).toLocaleDateString("tr-TR") : "tarih yok";
      const isFuture = ca.event_date && new Date(ca.event_date) > new Date();
      return `- ${d}${isFuture ? " (YAKLAŞAN)" : " (geçmiş)"}: ${parts.length ? parts.join(", ") : "detay yok"}`;
    }).join("\n");

    const newsText = newsRows.map(n => {
      const d = n.published_at ? new Date(n.published_at).toLocaleDateString("tr-TR") : "";
      return `- ${d ? `[${d}] ` : ""}${n.title}`;
    }).join("\n");

    const prompt = `
Sen Borsa İstanbul (BIST) dinamiklerine tam hakim, kıdemli bir portföy yöneticisi ve analistsin. Aşağıda ${stock.symbol} (${stock.name}) hissesine ait güncel verileri paylaşıyorum. Bu verilerin DIŞINA ÇIKMADAN, veri odaklı, objektif ve profesyonel bir analiz yap. "veri yok" yazan alanlar hakkında tahmin yürütme, sadece mevcut verilerle konuş.

═══ 1. ŞİRKET KİMLİĞİ VE DEĞERLEME ═══
- Sektör: ${stock.sector ?? "bilinmiyor"} | Alt Sektör: ${stock.industry ?? "bilinmiyor"}
- Endeks Üyelikleri: ${indexMemberships.length ? indexMemberships.join(", ") : "yok / bilinmiyor"}
- Piyasa Değeri: ${f.market_cap != null ? Number(f.market_cap).toLocaleString("tr-TR") + " TL" : "veri yok"}
- Halka Açıklık: %${fmt(f.free_float, 1)} → Fiili Dolaşım Değeri: ${floatMcap != null ? Number(floatMcap.toFixed(0)).toLocaleString("tr-TR") + " TL" : "veri yok"} (düşükse likidite/oynaklık riski olarak değerlendir)
- F/K: ${fmt(f.pe_ratio)} | Şirketin Kendi Tarihsel F/K Ortalaması: ${fmt(f.pe_hist_avg)}
- FD/FAVÖK: ${fmt(f.ev_ebitda)} | Kendi Tarihsel FD/FAVÖK Ortalaması: ${fmt(f.ev_ebitda_hist_avg)}
- PD/DD: ${fmt(f.pb_ratio)} | FD/Satış: ${fmt(f.ev_sales)}
- PEG Rasyosu: ${pegRatio != null ? pegRatio.toFixed(2) : "veri yok (büyüme negatif/yok)"}

═══ 2. SEKTÖREL KARŞILAŞTIRMA (Sektör: ${stock.sector ?? "Bilinmiyor"}) ═══
${sectorData && Number(sectorData.n) > 1 ? `Sektördeki ${sectorData.n} şirketin ortalamaları (aşırı uçlar hariç):
- Ort. F/K: ${fmt(sectorData.avg_pe)} (Bu hisse: ${fmt(f.pe_ratio)})
- Ort. PD/DD: ${fmt(sectorData.avg_pb)} (Bu hisse: ${fmt(f.pb_ratio)})
- Ort. FD/FAVÖK: ${fmt(sectorData.avg_ev_ebitda)} (Bu hisse: ${fmt(f.ev_ebitda)})
- Ort. ROE: %${fmt(sectorData.avg_roe, 1)} (Bu hisse: %${fmt(f.roe, 1)})
- Ort. Net Marj: %${fmt(sectorData.avg_net_margin, 1)} (Bu hisse: %${fmt(f.net_margin, 1)})
- Ort. Temettü Verimi: %${fmt(sectorData.avg_dividend_yield)} (Bu hisse: %${fmt(f.dividend_yield)})` : "- Sektörel karşılaştırma verisi yetersiz."}

═══ 3. KÂRLILIK, BÜYÜME VE BORÇ ═══
- FAVÖK: ${f.favok != null ? Number(f.favok).toLocaleString("tr-TR") + " TL" : "veri yok"} | Net Kâr: ${f.net_kar != null ? Number(f.net_kar).toLocaleString("tr-TR") + " TL" : "veri yok"}
- ROE: %${fmt(f.roe, 1)} | Net Marj: %${fmt(f.net_margin, 1)} | FAVÖK Marjı: %${fmt(f.ebitda_margin, 1)}
- Yıllık Büyüme: Net kâr %${fmt(f.net_income_yoy_growth, 1)}, ciro %${fmt(f.revenue_yoy_growth, 1)}
- Borçluluk: Toplam Borç/FAVÖK ~ ${netDebtToEbitda != null ? netDebtToEbitda.toFixed(2) : "veri yok"}

═══ 4. TEMETTÜ, YABANCI TAKASI VE SERMAYE OLAYLARI (BIST Dinamikleri) ═══
- Temettü Verimi: %${fmt(f.dividend_yield)}
- Yabancı Takas Oranı: %${fmt(f.foreign_ratio, 1)} | Değişim: 1 haftada ${fmt(f.foreign_ratio_1w_change, 2)} puan, 1 ayda ${fmt(f.foreign_ratio_1m_change, 2)} puan (pozitif = yabancı para girişi)
- Getiri Momentumu: Günlük %${fmt(f.return_1d)}, Haftalık %${fmt(f.return_1w)}, Aylık %${fmt(f.return_1m)}

SERMAYE ARTIRIMI / TEMETTÜ TAKVİMİ (KAP kayıtları):
${corpActionsText || "- Kayıtlı sermaye artırımı/temettü olayı yok."}

═══ 5. TEKNİK GÖRÜNÜM ═══
- Güncel Fiyat: ${price ?? "?"} TL (günlük ${stock.change_pct ?? "?"}%) | Gün içi bant: ${fmt(stock.day_low)} – ${fmt(stock.day_high)}
- 52 Hafta Bandı: ${fmt(f.year_low)} – ${fmt(f.year_high)} TL → Fiyat, zirvenin %${distFromHigh != null ? Math.abs(distFromHigh).toFixed(1) : "?"} ${distFromHigh != null && distFromHigh < 0 ? "altında" : "üzerinde/yakınında"}, dipten %${distFromLow != null ? distFromLow.toFixed(1) : "?"} uzakta
- Destek/Direnç (Pivot): Yakın destek ~${fmt(f.pivot_s1)}, yakın direnç ~${fmt(f.pivot_r1)}
- RSI(14): ${fmt(f.rsi, 1)} | MACD: ${macdSignalRel ?? "veri yok"}
- 50 Günlük HO: Fiyat ortalamanın ${priceVsSma50 ?? "veri yok"} (HO: ${fmt(f.sma50)})
- Hacim: Güncel hacim, 10 günlük ortalamanın ${volumeStatus != null ? (volumeStatus >= 0 ? `%${volumeStatus.toFixed(0)} üzerinde` : `%${Math.abs(volumeStatus).toFixed(0)} altında`) : "veri yok"}
- Sistem Gösterge Anlık Değerleri → Haftalık: INV1(9)=${fmt(ind.inv1_9)}, EMA21=${fmt(ind.ema21_weekly)}, MACDAS=${fmt(ind.macdas_weekly)}, CCI(20)=${fmt(ind.cci20_weekly, 1)}, IFTCCI5=${fmt(ind.iftcci5_weekly_value)} | Günlük: INV1(13)=${fmt(ind.inv1_13)}, EMA21=${fmt(ind.ema21_daily)}, MACDAS=${fmt(ind.macdas_daily)}, CCI(20)=${fmt(ind.cci20_daily, 1)}, IFTCCI5=${fmt(ind.iftcci5_daily_value)}

TETİKLENEN ÖZEL TEKNİK FİLTRELER (kendi tarama sistemimiz, geçmiş performanslarıyla):
${activeFilterCodes.length ? activeFilterCodes.map(c => {
  const s = historicalStats[c];
  const winRate = s.total > 0 ? ((s.winners / s.total) * 100).toFixed(0) : "0";
  return `- ${c}: ${FILTER_DEFINITIONS[c]} | Geçmişte ${s.total} örnek, ortalama getiri %${s.avg_change_pct ?? "?"}, kazanma oranı %${winRate}, %10 kazanca ortalama ${s.avg_days_to_10 ?? "?"} günde ulaşılmış.`;
}).join("\n") : "- Şu an hiçbir özel filtre tetiklenmiyor."}

═══ 6. KAP HABERLERİ VE BİLANÇO ═══
${newsText || "- Güncel haber bulunamadı."}
${balanceSheet ? `
BİLANÇO (${balanceSheet.financialGroup === "UFRS" ? "bankacılık formatı" : "sanayi şirketi formatı"}, dönem: ${balanceSheet.period}${balanceSheet.prevPeriod ? `, karşılaştırma: ${balanceSheet.prevPeriod}` : ""}):
${balanceSheet.text}` : ""}

═══ SENDEN İSTEDİKLERİM ═══
1. "finansal_saglik": Çarpanları hem sektör ortalamalarıyla hem şirketin KENDİ tarihsel ortalamalarıyla (F/K ve FD/FAVÖK tarihsel ort.) kıyasla — ucuz mu pahalı mı, kârlılık ve borçluluk sağlıklı mı (2-4 cümle).
2. "temettu_ve_takas": Temettü verimini, sermaye takvimini (YAKLAŞAN bedelli varsa sulanma riskini, yaklaşan bedelsiz/nakit temettü varsa olası pozitif etkiyi MUTLAKA belirt) ve yabancı takas değişimini (para girişi/çıkışı) yorumla (2-3 cümle).
3. "teknik_temel_uyumu": 52 hafta bandındaki konum, momentum, hacim, RSI/MACD ve tetiklenen filtrelerin (geçmiş başarı oranlarını da tartarak) temel tabloyu destekleyip desteklemediğini açıkla (2-4 cümle).
4. "kap_etkisi": KAP haberlerinin kısa/orta vadede fiyatlamaya olası etkisi (2-3 cümle).
5. "bilanco_yorumu": Bilanço dönem aktivitesini ve finansal yapı için anlamını yorumla${balanceSheet ? "" : ' — veri yoksa "Bilanço verisi bulunmuyor" yaz'} (2-3 cümle).
6. "riskler" ve "firsatlar": Her biri için EN AZ 2, EN FAZLA 4 madde; genel geçer değil, yukarıdaki verilere dayalı somut maddeler yaz (halka açıklık düşükse likidite riskini, bedelli varsa sulanmayı, yabancı çıkışı varsa onu unutma).
7. "tavsiye" (AL/SAT/BEKLE) ve "risk_seviyesi" (Düşük/Orta/Yüksek): Yukarıdaki analizinle tutarlı, rasyonel bir sonuca bağla.

SADECE aşağıdaki JSON formatında, başka hiçbir metin eklemeden cevap ver:
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
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Sen deneyimli bir Borsa İstanbul (BIST) analistisin. Sana verilen verilerin dışına çıkmadan, nesnel ve profesyonel bir JSON çıktısı üretirsin. İçeriğin yatırım tavsiyesi niteliği taşımadığını unutma." },
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