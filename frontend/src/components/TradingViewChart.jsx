// src/components/TradingViewChart.jsx
// TradingView'ın ücretsiz "Advanced Chart" widget'ını gömer.
//
// DÜZELTME: Önceden container her sembol değişiminde innerHTML ile temizlenip
// yeniden dolduruluyordu — ama React'in kendi re-render'ı ile TradingView'ın
// asenkron script'inin container'ı okuma anı arasında bir yarış durumu oluşup
// widget bazen kendi varsayılan sembolüne (NASDAQ:AAPL) düşüyordu.
// Şimdi `key={symbol}` ile React'e, sembol her değiştiğinde DOM node'un
// TAMAMINI yok edip sıfırdan kurmasını söylüyoruz — TradingView script'i
// böylece her zaman gerçekten temiz, hiç dokunulmamış bir container buluyor.

import { useEffect, useRef } from "react";

function ChartWidget({ symbol, height }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";

    const config = {
      autosize: true,
      symbol: `BIST:${symbol}`,
      interval: "D",
      timezone: "Europe/Istanbul",
      theme: isDark ? "dark" : "light",
      style: "1",
      locale: "tr",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      support_host: "https://www.tradingview.com",
    };

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    // ÖNEMLİ: innerHTML yerine textNode kullanıyoruz — script etiketlerinde
    // innerHTML ile içerik atamak bazı tarayıcılarda widget'ın ayarları
    // okumasını engelliyordu (varsayılan sembole düşüyordu).
    script.appendChild(document.createTextNode(JSON.stringify(config)));

    containerRef.current.appendChild(widgetDiv);
    containerRef.current.appendChild(script);

    // Bu component `key={symbol}` ile her sembolde yeniden mount edildiği için
    // burada ekstra bir temizlik/cleanup gerekmiyor — eski node zaten React
    // tarafından tamamen kaldırılıyor.
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{ height, width: "100%" }}
    />
  );
}

export default function TradingViewChart({ symbol, height = "100%" }) {
  if (!symbol) return null;
  // key={symbol}: sembol değiştiğinde React'e component'i unmount edip
  // sıfırdan mount ettiriyoruz — TradingView script'inin eski/yarım kalmış
  // bir container'a yazma riskini tamamen ortadan kaldırıyor.
  return <ChartWidget key={symbol} symbol={symbol} height={height} />;
}
