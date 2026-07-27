// src/components/TradingViewChart.jsx
// TradingView'ın ücretsiz "Advanced Chart" widget'ını gömer.

import { useEffect, useRef } from "react";

export default function TradingViewChart({ symbol, height = "100%" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    containerRef.current.innerHTML = "";

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
  }, [symbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container"
      style={{ height, width: "100%" }}
    />
  );
}
