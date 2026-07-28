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

    // YENİ: Sektörel Ortalamaları Dinamik Hesaplama
    // Sektördeki aşırı uçları (outliers) törpülemek için basit filtreler (PE < 100 vb.) kullanıyoruz.
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
  return `- ${c}: ${FILTER_DEFINITIONS[c]} | Geçmişte ${s.total} örnek, ort. getiri %${s.avg_change_pct ?? "?"}, başarı %${winRate}.`;
}).join("\n") : "- Şu an hiçbir özel filtre tetiklenmiyor."}

5. KAP HABERLERİ VE BİLANÇO:
${newsRows.length ? newsRows.map(n => `- ${n.title}`).join("\n") : "- Güncel haber bulunamadı."}
${balanceSheet ? `\nBİLANÇO YAPISI (${balanceSheet.financialGroup} formatı, Dönem: ${balanceSheet.period}):\n${balanceSheet.text}` : ""}

SENDEN İSTEDİKLERİM (Aşağıdaki JSON şemasına kesinlikle sadık kal):
1. "genel_degerlendirme": Verilerin birleştirilmiş 1-2 cümlelik özeti.
2. "temel_ve_sektorel": Sektör ortalamaları ve kendi tarihsel ortalamalarına (pe_hist_avg) göre şirketin ucuz/pahalı olup olmadığını, kârlılığını yorumla.
3. "temettu_ve_takas": Temettü verimini ve BIST için önemli olan "Yabancı Takas Oranı"ndaki son değişimi (para girişi/çıkışı) yorumla.
4. "teknik_temel_uyumu": Fiyat momentumu, hacim, yabancı ilgisi ve teknik filtrelerin temel tabloyu destekleyip desteklemediğini açıkla.
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