// src/components/TradingViewChart.jsx
// TradingView'ın ücretsiz "Advanced Chart" widget'ını gömer.
// API key gerekmiyor — sadece sembol adı (BIST:THYAO gibi) yeterli.

import { useEffect, useRef } from "react";

export default function TradingViewChart({ symbol, height = "100%" }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !symbol) return;

    // Sembol değişince widget'ı sıfırdan kur
    containerRef.current.innerHTML = "";

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
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
    });

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
