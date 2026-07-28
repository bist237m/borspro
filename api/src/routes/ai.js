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

    const { rows: newsRows } = await query(
      "SELECT title FROM stock_news WHERE stock_id = $1 ORDER BY published_at DESC LIMIT 3",
      [stock.id]
    );

    // YENİ: Sermaye Artırımı / Temettü Takvimi
    // DİKKAT: Tablo adını stocks.js'teki corporateActions endpoint'iyle aynı yap.
    const { rows: corpRows } = await query(
      `SELECT event_date, bedelli_oran, bedelsiz_ic_oran, bedelsiz_tm_oran, nakit_tm_oran, ruchan_oran
       FROM corporate_actions
       WHERE stock_id = $1
       ORDER BY event_date DESC
       LIMIT 5`,
      [stock.id]
    );

    // YENİ: Ek filtre sonuçları (IFT5-EMA-MACD, EMA120)
    // DİKKAT: Tablo adını stocks.js'teki extraFilters endpoint'iyle aynı yap.
    const { rows: extraFilterRows } = await query(
      "SELECT filter_code, timeframe, result FROM extra_filters WHERE stock_id = $1",
      [stock.id]
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

    // Sermaye artırımı/temettü satırlarını prompt için metne çevir
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

    // Ek filtre sonuçlarını prompt için metne çevir
    const extraFiltersText = extraFilterRows.map(ef => {
      const label = ef.filter_code === "IFT5_EMA_MACD" ? "IFT5-EMA-MACD" : ef.filter_code;
      return `- ${label} (${ef.timeframe}): ${ef.result ? "POZİTİF ✓" : "negatif"}`;
    }).join("\n");

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

SERMAYE ARTIRIMI / TEMETTÜ TAKVİMİ (KAP kayıtları):
${corpActionsText || "- Kayıtlı sermaye artırımı/temettü olayı yok."}

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

EK TEKNİK FİLTRELER (destekleyici göstergeler):
${extraFiltersText || "- Ek filtre verisi yok."}

5. KAP HABERLERİ VE BİLANÇO:
${newsRows.length ? newsRows.map(n => `- ${n.title}`).join("\n") : "- Güncel haber bulunamadı."}
${balanceSheet ? `\nBİLANÇO YAPISI (${balanceSheet.financialGroup} formatı, Dönem: ${balanceSheet.period}${balanceSheet.prevPeriod ? `, karşılaştırma dönemi: ${balanceSheet.prevPeriod}` : ""}):\n${balanceSheet.text}` : ""}

SENDEN İSTEDİKLERİM (Aşağıdaki JSON şemasına kesinlikle sadık kal):
1. "genel_degerlendirme": Verilerin birleştirilmiş 1-2 cümlelik özeti.
2. "temel_ve_sektorel": Sektör ortalamaları ve kendi tarihsel ortalamalarına göre şirketin ucuz/pahalı olup olmadığını, kârlılığını yorumla.
3. "temettu_ve_takas": Temettü verimini, sermaye artırımı/temettü takvimini (YAKLAŞAN bedelli varsa sulanma riskini, yaklaşan bedelsiz/nakit temettü varsa olası pozitif etkiyi mutlaka belirt) ve BIST için önemli olan "Yabancı Takas Oranı"ndaki son değişimi (para girişi/çıkışı) yorumla.
4. "teknik_temel_uyumu": Fiyat momentumu, hacim, yabancı ilgisi ile ana ve ek teknik filtrelerin (IFT5-EMA-MACD, EMA120 dahil) temel tabloyu destekleyip desteklemediğini açıkla.
5. "kap_ve_bilanco": Haberlerin ve bilanço dönem aktivitesinin kısa vade beklentilere etkisini belirt.
6. "riskler" ve "firsatlar": En az ikişer madde yaz.
7. "tavsiye" ve "risk_seviyesi" alanlarını rasyonel şekilde doldur.

SADECE AŞAĞIDAKİ JSON FORMATINDA CEVAP VER:
{
  "genel_degerlendirme": "...",
  "temel_ve_sektorel": "...",
  "temettu_ve_takas": "...",
  "teknik_temel_uyumu": "...",
  "kap_ve_bilanco": "...",
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