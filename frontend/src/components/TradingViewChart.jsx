// src/components/TradingViewChart.jsx
// ÖNEMLİ DEĞİŞİKLİK: TradingView'ın ücretsiz "Advanced Chart" widget'ı BIST verisi
// için veri lisansı kısıtlaması uyguluyordu ("Sembol sadece TradingView'de
// bulunabilir" hatası) — ücretsiz/anonim gömülü widget'larda bazı borsaların
// verisi gösterilemiyor. Bunun yerine TradingView'ın kendi AÇIK KAYNAKLI,
// ücretsiz grafik kütüphanesini (lightweight-charts) kullanıp, KENDİ
// price_history verimizi (borsapy üzerinden, TradingView'dan bağımsız)
// çiziyoruz. Hiçbir veri lisansı kısıtlaması yok, çünkü kendi verimizi
// gösteriyoruz — TradingView'ın sunucularına hiç istek atılmıyor.

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import { stocks as stocksApi } from "../api/client.js";

const PERIODS = [
  { id: "1m", label: "1A" },
  { id: "3m", label: "3A" },
  { id: "6m", label: "6A" },
  { id: "1y", label: "1Y" },
  { id: "all", label: "Tümü" },
];

// Uygulamanın kendi CSS değişkenlerini (tema açık/koyu ne olursa olsun) canvas
// üzerinde kullanabilmek için gerçek değerlerini çözüyoruz — canvas, var()
// referansını değil, çözümlenmiş rengi ister.
function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function toChartTime(dateValue) {
  const d = new Date(dateValue);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ChartCanvas({ symbol, period }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const green = cssVar("--green", "#059669");
    const red = cssVar("--red", "#DC2626");
    const borderColor = cssVar("--border", "#E2E5EA");
    const textColor = cssVar("--text-2", "#4B5563");

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor, fontFamily: "var(--font-m)" },
      grid: { vertLines: { color: borderColor }, horzLines: { color: borderColor } },
      rightPriceScale: { borderColor },
      timeScale: { borderColor, timeVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: green, downColor: red, borderVisible: false,
      wickUpColor: green, wickDownColor: red,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: borderColor,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    let cancelled = false;
    setLoading(true);
    setError(null);

    stocksApi.history(symbol, period)
      .then(rows => {
        if (cancelled) return;
        if (!rows?.length) {
          setError("Bu hisse için geçmiş fiyat verisi yok.");
          return;
        }
        const candles = rows.map(r => ({
          time: toChartTime(r.price_date),
          open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
        }));
        const volumes = rows.map(r => ({
          time: toChartTime(r.price_date),
          value: Number(r.volume || 0),
          color: Number(r.close) >= Number(r.open) ? `${green}55` : `${red}55`,
        }));
        candleSeries.setData(candles);
        volumeSeries.setData(volumes);
        chart.timeScale().fitContent();
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      chart.remove();
    };
  }, [symbol, period]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
      {loading && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, color: "var(--text-3)", background: "var(--surface)",
        }}>Yükleniyor...</div>
      )}
      {!loading && error && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, color: "var(--text-3)",
        }}>{error}</div>
      )}
    </div>
  );
}

export default function TradingViewChart({ symbol, height = "100%" }) {
  const [period, setPeriod] = useState("6m");
  if (!symbol) return null;

  return (
    <div style={{ height, width: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {PERIODS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)} style={{
            padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)",
            background: period === p.id ? "var(--accent)" : "var(--bg)",
            color: period === p.id ? "#fff" : "var(--text-2)",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>{p.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key={symbol}: sembol değişince tamamen sıfırdan mount edilsin */}
        <ChartCanvas key={symbol} symbol={symbol} period={period} />
      </div>
    </div>
  );
}
