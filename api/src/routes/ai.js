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
      `SELECT s.id, s.symbol, s.name, q.price, q.change_pct
       FROM stocks s LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE s.symbol = $1`,
      [symbol]
    );
    const stock = stockRows[0];
    if (!stock) return res.status(404).json({ error: "Hisse bulunamadı." });

    const { rows: filterRows } = await query("SELECT * FROM indicator_snapshots WHERE stock_id = $1", [stock.id]);
    const filterData = filterRows[0] || {};

    const { rows: fundRows } = await query("SELECT * FROM fundamentals_snapshots WHERE stock_id = $1", [stock.id]);
    const f = fundRows[0] || {};

    const { rows: newsRows } = await query(
      "SELECT title FROM stock_news WHERE stock_id = $1 ORDER BY published_at DESC LIMIT 3",
      [stock.id]
    );

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

    const prompt = `
Sen kıdemli bir finansal analistsin. Aşağıda temel, teknik ve haber (KAP) verilerini paylaştığım ${stock.symbol} (${stock.name}) hissesi için kapsamlı, objektif ve anlaşılır bir analiz yapmanı istiyorum.

1. TEMEL ANALİZ VERİLERİ:
- F/K Oranı: ${fmt(f.pe_ratio)}
- PD/DD Oranı: ${fmt(f.pb_ratio)}
- Özsermaye Karlılığı (ROE): %${fmt(f.roe, 1)}
- Son Çeyrek Finansalları: Net kâr geçen yıla göre %${fmt(f.net_income_yoy_growth, 1)} değişti, ciro %${fmt(f.revenue_yoy_growth, 1)} değişti
- Borç Durumu: Toplam Borç/FAVÖK oranı ~ ${netDebtToEbitda != null ? netDebtToEbitda.toFixed(2) : "veri yok"}

2. TEKNİK ANALİZ VERİLERİ:
- Güncel Fiyat: ${stock.price ?? "?"} TL (${stock.change_pct ?? "?"}%)
- Destek ve Direnç Seviyeleri: Yakın destek ~${fmt(f.pivot_s1)}, yakın direnç ~${fmt(f.pivot_r1)}
- RSI: ${fmt(f.rsi, 1)}
- MACD: ${macdSignalRel ?? "veri yok"}
- 50 Günlük Hareketli Ortalama: Fiyat, HO'nun ${priceVsSma50 ?? "veri yok"} (HO: ${fmt(f.sma50)})
- Hacim Durumu: Güncel hacim, 10 günlük ortalamanın ${volumeStatus != null ? (volumeStatus >= 0 ? `%${volumeStatus.toFixed(0)} üzerinde` : `%${Math.abs(volumeStatus).toFixed(0)} altında`) : "veri yok"}

TETİKLENEN ÖZEL TEKNİK FİLTRELER (kendi tarama sistemimiz):
${activeFilterCodes.length ? activeFilterCodes.map(c => {
  const s = historicalStats[c];
  const winRate = s.total > 0 ? ((s.winners / s.total) * 100).toFixed(0) : "0";
  return `- ${c}: ${FILTER_DEFINITIONS[c]} | Geçmişte ${s.total} örnek, ortalama getiri %${s.avg_change_pct ?? "?"}, kazanma oranı %${winRate}, %10 kazanca ortalama ${s.avg_days_to_10 ?? "?"} günde ulaşılmış.`;
}).join("\n") : "- Şu an hiçbir özel filtre tetiklenmiyor."}

3. KAP HABERLERİ / BEKLENTİLER:
${newsRows.length ? newsRows.map(n => `- ${n.title}`).join("\n") : "- Güncel haber bulunamadı."}

SENDEN İSTEDİKLERİM:
1. Bu verilerin ışığında şirketin mevcut finansal sağlığını ve çarpanlarını yorumla (ucuz mu pahalı mı görünüyor).
2. Teknik veriler ile temel verilerin birbiriyle uyumlu olup olmadığını değerlendir.
3. KAP haberlerinin kısa ve orta vadede piyasa fiyatlamasına olası etkilerini analiz et.
4. Bu hisse için potansiyel riskleri ve fırsatları ayrı ayrı listele.

SADECE aşağıdaki JSON formatında, başka hiçbir metin eklemeden cevap ver:
{
  "finansal_saglik": "Çarpanlar ve finansal sağlık değerlendirmesi (2-4 cümle)",
  "teknik_temel_uyumu": "Teknik ve temel verilerin uyumu değerlendirmesi (2-3 cümle)",
  "kap_etkisi": "KAP haberlerinin olası etkisi (2-3 cümle)",
  "riskler": ["risk maddesi 1", "risk maddesi 2", "risk maddesi 3"],
  "firsatlar": ["fırsat maddesi 1", "fırsat maddesi 2", "fırsat maddesi 3"],
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
          { role: "system", content: "Sen deneyimli bir Borsa İstanbul teknik ve temel analiz uzmanısın. Yatırım tavsiyesi niteliği taşımadığını unutma, sadece analiz sun." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(502).json({ error: `OpenAI hatası: ${errText}` });
    }

    const aiData = await aiRes.json();
    const responseText = aiData.choices[0].message.content;

    await query(
      "INSERT INTO ai_commentary (stock_id, user_id, question, response) VALUES ($1, $2, $3, $4)",
      [stock.id, req.user.id, prompt, responseText]
    );

    res.json({ symbol: stock.symbol, comment: JSON.parse(responseText) });
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

export default router;
