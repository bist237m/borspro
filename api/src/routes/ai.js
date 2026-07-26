import { Router } from "express";
import { query } from "../db/pool.js";
import { authenticate } from "../middleware/authenticate.js";

const router = Router();

// Filtre kodlarının insan-okunur tanımları (prompt'a eklemek için)
const FILTER_DEFINITIONS = {
  HAFTALIK_1: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS negatif ya da son 3 mumda 0'ı yukarı kesmiş",
  HAFTALIK_2: "Haftalık INV1(9) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS 0'ı yukarı keser, CCI(20) 100'ü yukarı keser",
  HAFTALIK_3: "Haftalık INV1(9) 0.5'i yukarı keser, Fiyat EMA21'i yukarı keser, MACDAS 0'ı yukarı keser, CCI(20) > -100",
  GUNLUK_1:   "Günlük INV1(13) 0.5'i yukarı keser, EMA21 fiyatın altında, MACDAS > 0, CCI(20) 100'ü yukarı keser",
};

// Bir filtre kodunun geçmişte (tüm hisselerde) nasıl performans gösterdiğini hesaplar
async function getHistoricalStats(filterCode) {
  const { rows } = await query(
    `SELECT
       COUNT(*) AS total,
       ROUND(AVG(change_pct)::numeric, 2) AS avg_change_pct,
       COUNT(*) FILTER (WHERE change_pct > 0) AS winners,
       ROUND(AVG(EXTRACT(EPOCH FROM (milestone_5_at - entry_date)) / 86400)::numeric, 1)  AS avg_days_to_5,
       ROUND(AVG(EXTRACT(EPOCH FROM (milestone_10_at - entry_date)) / 86400)::numeric, 1) AS avg_days_to_10,
       COUNT(*) FILTER (WHERE milestone_5_at IS NOT NULL)  AS reached_5,
       COUNT(*) FILTER (WHERE milestone_10_at IS NOT NULL) AS reached_10
     FROM tracked_signals
     WHERE filter_types LIKE $1`,
    [`%${filterCode}%`]
  );
  return rows[0];
}

// POST /api/ai/stocks/:symbol/comment — OpenAI'den yorum al
router.post("/stocks/:symbol/comment", authenticate, async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Kullanıcının OpenAI key'i var mı?
    const { rows: userRows } = await query(
      "SELECT openai_api_key FROM users WHERE id = $1",
      [req.user.id]
    );
    const apiKey = userRows[0]?.openai_api_key;
    if (!apiKey) {
      return res.status(400).json({ error: "Önce Ayarlar sayfasından OpenAI API key girmelisin." });
    }

    // Hisse + gösterge + temel veri + haberleri topla
    const { rows: stockRows } = await query(
      `SELECT s.id, s.symbol, s.name, q.price, q.change_pct
       FROM stocks s LEFT JOIN stock_quotes q ON q.stock_id = s.id
       WHERE s.symbol = $1`,
      [symbol]
    );
    const stock = stockRows[0];
    if (!stock) return res.status(404).json({ error: "Hisse bulunamadı." });

    const { rows: filterRows } = await query(
      "SELECT * FROM indicator_snapshots WHERE stock_id = $1",
      [stock.id]
    );
    const filterData = filterRows[0] || {};

    const { rows: fundRows } = await query(
      "SELECT * FROM fundamentals_snapshots WHERE stock_id = $1",
      [stock.id]
    );
    const fund = fundRows[0] || {};

    const { rows: newsRows } = await query(
      "SELECT title FROM stock_news WHERE stock_id = $1 ORDER BY published_at DESC LIMIT 3",
      [stock.id]
    );

    // Tetiklenen filtrelerin geçmiş performansını hesapla
    const activeFilterCodes = [];
    if (filterData.haftalik_1) activeFilterCodes.push("HAFTALIK_1");
    if (filterData.haftalik_2) activeFilterCodes.push("HAFTALIK_2");
    if (filterData.haftalik_3) activeFilterCodes.push("HAFTALIK_3");
    if (filterData.gunluk_1)   activeFilterCodes.push("GUNLUK_1");

    const historicalStats = {};
    for (const code of activeFilterCodes) {
      historicalStats[code] = await getHistoricalStats(code);
    }

    // ── PROMPT ──────────────────────────────────────────────
    const prompt = `
Hisse: ${stock.symbol} (${stock.name})
Güncel fiyat: ₺${stock.price ?? "?"} (${stock.change_pct ?? "?"}%)

TEMEL VERİLER:
- FAVÖK: ${fund.favok ?? "veri yok"}
- Net Kar: ${fund.net_kar ?? "veri yok"}
- F/K: ${fund.pe_ratio ?? "veri yok"}
- PD/DD: ${fund.pb_ratio ?? "veri yok"}
- Piyasa Değeri: ${fund.market_cap ?? "veri yok"}
- 52 Hafta Yüksek/Düşük: ${fund.year_high ?? "?"} / ${fund.year_low ?? "?"}

TETİKLENEN TEKNİK FİLTRELER:
${activeFilterCodes.length
  ? activeFilterCodes.map(c => `- ${c}: ${FILTER_DEFINITIONS[c]}`).join("\n")
  : "- Şu an hiçbir filtre tetiklenmiyor."}

GEÇMİŞ PERFORMANS (bu filtrelerin tüm BIST hisselerinde bugüne kadarki sonuçları):
${activeFilterCodes.length
  ? activeFilterCodes.map(c => {
      const s = historicalStats[c];
      const winRate = s.total > 0 ? ((s.winners / s.total) * 100).toFixed(0) : "0";
      return `- ${c}: toplam ${s.total} örnek, ortalama getiri %${s.avg_change_pct ?? "?"}, kazanma oranı %${winRate}, ` +
             `%5 kazanca ortalama ${s.avg_days_to_5 ?? "?"} günde ulaşılmış, %10 kazanca ortalama ${s.avg_days_to_10 ?? "?"} günde ulaşılmış.`;
    }).join("\n")
  : "- Veri yok."}

SON KAP HABERLERİ:
${newsRows.length ? newsRows.map(n => `- ${n.title}`).join("\n") : "- Haber bulunamadı."}

GÖREV: Hissenin temel analizini genel hatlarıyla değerlendir. Teknik açıdan koşulların
şu an uygun olup olmadığını yorumla. Ayrıca yukarıdaki geçmiş performans verisine dayanarak,
bu tür koşulların geçmişte ne kadar sürede ve ne oranda kâr getirdiğini analizine kat.

SADECE aşağıdaki JSON formatında, başka hiçbir metin eklemeden cevap ver:
{
  "temel_degerlendirme": "...",
  "teknik_degerlendirme": "...",
  "gecmis_performans_analizi": "...",
  "genel_yorum": "...",
  "tavsiye": "AL" | "SAT" | "BEKLE",
  "risk_seviyesi": "Düşük" | "Orta" | "Yüksek"
}`.trim();

    // ── OPENAI ÇAĞRISI ──────────────────────────────────────
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

    // Geçmişe kaydet
    await query(
      "INSERT INTO ai_commentary (stock_id, user_id, question, response) VALUES ($1, $2, $3, $4)",
      [stock.id, req.user.id, prompt, responseText]
    );

    res.json({ symbol: stock.symbol, comment: JSON.parse(responseText) });
  } catch (err) {
    next(err);
  }
});

// GET /api/ai/stocks/:symbol/comment/history — bu hisse için geçmiş yorumlar
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

// GET /api/ai/commentary — TÜM AI yorum geçmişi (Raporlar sayfası için)
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
