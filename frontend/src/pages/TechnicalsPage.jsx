// src/pages/TechnicalsPage.jsx
import { useState, useMemo } from "react";
import {
  ComposedChart, LineChart, Line, Bar, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Area, AreaChart,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import { stocks as stocksApi } from "../api/client.js";

// ── İNDİKATÖR HESAPLAMALARI (frontend) ───────────────────
// Scanner'daki indicators.js'in hafif versiyonu
// Grafik gösterimi için her bar'ın değeri hesaplanır

function calcEmaArray(closes, len) {
  const k = 2 / (len + 1);
  const result = new Array(closes.length).fill(null);
  if (closes.length < len) return result;
  let val = closes.slice(0, len).reduce((a, b) => a + b, 0) / len;
  result[len - 1] = val;
  for (let i = len; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
    result[i] = val;
  }
  return result;
}

function calcSmaArray(closes, len) {
  return closes.map((_, i) => {
    if (i < len - 1) return null;
    return closes.slice(i - len + 1, i + 1).reduce((a, b) => a + b, 0) / len;
  });
}

function calcRsiArray(closes, len = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < len + 1) return result;
  const changes = closes.map((c, i) => i === 0 ? 0 : c - closes[i - 1]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= len; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= len; avgLoss /= len;
  result[len] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = len + 1; i < closes.length; i++) {
    const g = changes[i] > 0 ? changes[i] : 0;
    const l = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (len - 1) + g) / len;
    avgLoss = (avgLoss * (len - 1) + l) / len;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcMacdArray(closes) {
  const fast12   = calcEmaArray(closes, 12);
  const slow26   = calcEmaArray(closes, 26);
  const macdLine = closes.map((_, i) =>
    fast12[i] !== null && slow26[i] !== null ? fast12[i] - slow26[i] : null
  );
  const validIdx = macdLine.map((v, i) => v !== null ? i : -1).filter(i => i >= 0);
  const validVals = validIdx.map(i => macdLine[i]);
  const signalRaw = calcEmaArray(validVals, 9);
  const signalLine = new Array(closes.length).fill(null);
  validIdx.forEach((origIdx, j) => { signalLine[origIdx] = signalRaw[j]; });
  return closes.map((_, i) => ({
    macd:      macdLine[i],
    signal:    signalLine[i],
    histogram: macdLine[i] !== null && signalLine[i] !== null ? macdLine[i] - signalLine[i] : null,
  }));
}

function calcWmaArray(arr, len) {
  return arr.map((_, i) => {
    if (i < len - 1) return null;
    const slice = arr.slice(i - len + 1, i + 1);
    let num = 0, den = 0;
    for (let j = 0; j < len; j++) {
      if (slice[j] === null) return null;
      num += slice[j] * (j + 1); den += (j + 1);
    }
    return num / den;
  });
}

function ift(x) {
  return (Math.exp(2 * x) - 1) / (Math.exp(2 * x) + 1);
}

function calcIftArray(closes, highs, lows, volumes) {
  const cciLen = 5, rsiLen = 5, stochLen = 5, mfiLen = 5, wmaLen = 9;

  // CCI serisi
  const cciRaw = closes.map((_, i) => {
    if (i < cciLen - 1) return null;
    const tp = closes.slice(i - cciLen + 1, i + 1).map((c, j) =>
      (c + highs[i - cciLen + 1 + j] + lows[i - cciLen + 1 + j]) / 3
    );
    const mean = tp.reduce((a, b) => a + b, 0) / cciLen;
    const mad  = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / cciLen;
    const last = (highs[i] + lows[i] + closes[i]) / 3;
    return mad === 0 ? 0 : 0.1 * ((last - mean) / (0.015 * mad)) / 4;
  });

  // RSI serisi
  const rsiRaw = calcRsiArray(closes, rsiLen).map(v => v !== null ? 0.1 * (v - 50) : null);

  // Stoch serisi
  const stochRaw = closes.map((_, i) => {
    if (i < stochLen - 1) return null;
    const hh = Math.max(...highs.slice(i - stochLen + 1, i + 1));
    const ll = Math.min(...lows.slice(i - stochLen + 1, i + 1));
    return hh === ll ? 0 : 0.1 * (((closes[i] - ll) / (hh - ll)) * 100 - 50);
  });

  // MFI serisi
  const hlc3   = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mfiRaw = closes.map((_, i) => {
    if (i < mfiLen) return null;
    let pos = 0, neg = 0;
    for (let j = i - mfiLen + 1; j <= i; j++) {
      const ch = hlc3[j] - hlc3[j - 1];
      if (ch > 0) pos += (volumes[j] || 1) * hlc3[j];
      else if (ch < 0) neg += (volumes[j] || 1) * hlc3[j];
    }
    return neg === 0 ? 0.1 * (100 - 50) : 0.1 * (100 - 100 / (1 + pos / neg) - 50);
  });

  // WMA uygula
  const wCCI   = calcWmaArray(cciRaw,   wmaLen);
  const wRSI   = calcWmaArray(rsiRaw,   wmaLen);
  const wSTOCH = calcWmaArray(stochRaw, wmaLen);
  const wMFI   = calcWmaArray(mfiRaw,   wmaLen);

  return closes.map((_, i) => {
    const cci   = wCCI[i]   !== null ? ift(wCCI[i])   : null;
    const rsi   = wRSI[i]   !== null ? ift(wRSI[i])   : null;
    const stoch = wSTOCH[i] !== null ? ift(wSTOCH[i]) : null;
    const mfi   = wMFI[i]   !== null ? ift(wMFI[i])   : null;
    const vals  = [cci, rsi, stoch, mfi].filter(v => v !== null);
    const avg   = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { cci, rsi, stoch, mfi, avg };
  });
}

// ── FORMAT ────────────────────────────────────────────────
const fmt = (n, d = 2) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dateStr = (d) => new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });

// ── TOOLTIP ───────────────────────────────────────────────
function SimpleTooltip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "8px 12px", fontSize: 11,
      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
    }}>
      <div style={{ fontFamily: "var(--font-m)", color: "var(--text-3)", marginBottom: 4 }}>{dateStr(label)}</div>
      {payload.map((p, i) => p.value !== null && (
        <div key={i} style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <span style={{ color: p.color || "var(--text-2)" }}>{p.name}</span>
          <span style={{ fontFamily: "var(--font-m)", fontWeight: 600, color: p.color || "var(--text-1)" }}>
            {typeof p.value === "number" ? fmt(p.value, 3) : p.value}{unit}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── SİNYAL KARTLARI ───────────────────────────────────────
const SIGNAL_CFG = {
  RSI_OVERSOLD:       { label: "RSI Aşırı Satım",   dir: "bullish", color: "#059669", bg: "#ECFDF5" },
  RSI_OVERBOUGHT:     { label: "RSI Aşırı Alım",    dir: "bearish", color: "#DC2626", bg: "#FEF2F2" },
  MACD_BULLISH_CROSS: { label: "MACD Bullish Cross", dir: "bullish", color: "#1D4ED8", bg: "#EEF2FF" },
  MACD_BEARISH_CROSS: { label: "MACD Bearish Cross", dir: "bearish", color: "#9333EA", bg: "#F5F3FF" },
  GOLDEN_CROSS:       { label: "Golden Cross",       dir: "bullish", color: "#D97706", bg: "#FFFBEB" },
  DEATH_CROSS:        { label: "Death Cross",        dir: "bearish", color: "#6B7280", bg: "#F3F4F6" },
  IFT_OVERSOLD:       { label: "IFT Aşırı Satım",   dir: "bullish", color: "#0891B2", bg: "#ECFEFF" },
  IFT_OVERBOUGHT:     { label: "IFT Aşırı Alım",    dir: "bearish", color: "#BE185D", bg: "#FDF2F8" },
};

function SignalCard({ type, value }) {
  const cfg = SIGNAL_CFG[type];
  if (!cfg) return null;
  return (
    <div style={{
      background: cfg.bg, border: `1px solid ${cfg.color}25`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: 8, padding: "10px 14px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2, fontFamily: "var(--font-m)" }}>
          {cfg.dir === "bullish" ? "▲ Alım Sinyali" : "▼ Satım Sinyali"}
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 18, color: cfg.color }}>
        {fmt(value, 2)}
      </div>
    </div>
  );
}

// ── PANEL BAŞLIĞI ─────────────────────────────────────────
function PanelHeader({ title, badge, badgeColor }) {
  return (
    <div style={{
      padding: "12px 16px", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ fontFamily: "var(--font-d)", fontSize: 14, color: "var(--text-1)" }}>{title}</span>
      {badge && (
        <span style={{
          fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 600,
          padding: "2px 7px", borderRadius: 20,
          color: badgeColor || "var(--accent)",
          background: `${badgeColor || "var(--accent)"}18`,
          border: `1px solid ${badgeColor || "var(--accent)"}30`,
        }}>{badge}</span>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ height: 140, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
          animation: `bl 1s ease ${i*0.18}s infinite`,
        }}/>
      ))}
      <style>{`@keyframes bl{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function TechnicalsPage() {
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("6m");

  const { data: stockList } = useApi(() => stocksApi.list(), []);
  const { data: stockDetail } = useApi(
    () => symbol ? stocksApi.get(symbol) : Promise.resolve(null),
    [symbol]
  );
  const { data: history, loading } = useApi(
    () => symbol ? stocksApi.history(symbol, period) : Promise.resolve([]),
    [symbol, period]
  );

  const filtered = (stockList || []).filter(s =>
    !search ||
    s.symbol.toUpperCase().includes(search.toUpperCase()) ||
    s.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 40);

  // Hesaplamalar
  const techData = useMemo(() => {
    if (!history?.length) return [];
    const closes  = history.map(b => Number(b.close));
    const highs   = history.map(b => Number(b.high));
    const lows    = history.map(b => Number(b.low));
    const volumes = history.map(b => Number(b.volume || 1));

    const rsiArr   = calcRsiArray(closes, 14);
    const macdArr  = calcMacdArray(closes);
    const ma20     = calcEmaArray(closes, 20);
    const ma50     = calcSmaArray(closes, 50);
    const ma200    = calcSmaArray(closes, 200);
    const iftArr   = calcIftArray(closes, highs, lows, volumes);

    return history.map((bar, i) => ({
      price_date: bar.price_date,
      close:      Number(bar.close),
      rsi:        rsiArr[i],
      macd:       macdArr[i].macd,
      macdSig:    macdArr[i].signal,
      macdHist:   macdArr[i].histogram,
      ma20:       ma20[i],
      ma50:       ma50[i],
      ma200:      ma200[i],
      iftCCI:     iftArr[i].cci,
      iftRSI:     iftArr[i].rsi,
      iftSTOCH:   iftArr[i].stoch,
      iftMFI:     iftArr[i].mfi,
      iftAVG:     iftArr[i].avg,
    }));
  }, [history]);

  // Son değerler
  const last = techData[techData.length - 1] || {};

  // Sinyal tespiti
  const signals = useMemo(() => {
    if (!techData.length) return [];
    const prev = techData[techData.length - 2] || {};
    const sigs = [];
    if (last.rsi !== null) {
      if (last.rsi < 30) sigs.push({ type: "RSI_OVERSOLD",  value: last.rsi });
      if (last.rsi > 70) sigs.push({ type: "RSI_OVERBOUGHT", value: last.rsi });
    }
    if (last.macd !== null && last.macdSig !== null) {
      if (prev.macd <= prev.macdSig && last.macd > last.macdSig)
        sigs.push({ type: "MACD_BULLISH_CROSS", value: last.macd });
      if (prev.macd >= prev.macdSig && last.macd < last.macdSig)
        sigs.push({ type: "MACD_BEARISH_CROSS", value: last.macd });
    }
    if (last.ma50 && last.ma200 && prev.ma50 && prev.ma200) {
      if (prev.ma50 <= prev.ma200 && last.ma50 > last.ma200)
        sigs.push({ type: "GOLDEN_CROSS", value: last.ma50 });
      if (prev.ma50 >= prev.ma200 && last.ma50 < last.ma200)
        sigs.push({ type: "DEATH_CROSS",  value: last.ma50 });
    }
    if (last.iftAVG !== null) {
      if (last.iftAVG < -0.5) sigs.push({ type: "IFT_OVERSOLD",   value: last.iftAVG });
      if (last.iftAVG >  0.5) sigs.push({ type: "IFT_OVERBOUGHT", value: last.iftAVG });
    }
    return sigs;
  }, [techData, last]);

  const up = stockDetail ? Number(stockDetail.change_pct) >= 0 : true;

  const PERIODS = [
    { label: "3A", value: "3m" },
    { label: "6A", value: "6m" },
    { label: "1Y", value: "1y" },
    { label: "Tüm", value: "all" },
  ];

  const CHART_PROPS = {
    margin: { top: 4, right: 8, left: -8, bottom: 0 },
  };

  const XAXIS = (
    <XAxis dataKey="price_date" tickFormatter={dateStr}
      tick={{ fontSize: 9, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
      tickLine={false} axisLine={false}
      interval={Math.max(Math.floor(techData.length / 7) - 1, 0)}
    />
  );

  const YAXIS = (extra = {}) => (
    <YAxis tick={{ fontSize: 9, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
      tickLine={false} axisLine={false} width={52} {...extra} />
  );

  const GRID = <CartesianGrid strokeDasharray="2 4" stroke="#F0F2F5" vertical={false} />;

  return (
    <div style={{ display: "flex", gap: 16, minHeight: 600 }}>

      {/* Sol panel — hisse seçici */}
      <div style={{
        width: 210, flexShrink: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--r)", display: "flex", flexDirection: "column",
        overflow: "hidden", alignSelf: "flex-start",
        position: "sticky", top: 0, maxHeight: "calc(100vh - 140px)",
      }}>
        <div style={{ padding: "12px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 7, padding: "6px 10px",
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Hisse ara..."
              style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: "var(--text-1)", width: "100%", fontFamily: "var(--font)" }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map(s => {
            const active = symbol === s.symbol;
            return (
              <div key={s.id} onClick={() => setSymbol(s.symbol)} style={{
                padding: "9px 12px", cursor: "pointer",
                background: active ? "var(--accent-bg)" : "transparent",
                borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
                borderBottom: "1px solid var(--border)", transition: "all 0.12s",
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: active ? "var(--accent)" : "var(--text-1)" }}>{s.symbol}</div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  </div>
                  {s.price && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 600 }}>₺{fmt(s.price)}</div>
                      <div style={{ fontFamily: "var(--font-m)", fontSize: 9, color: Number(s.change_pct) >= 0 ? "var(--green)" : "var(--red)", marginTop: 1 }}>
                        {Number(s.change_pct) >= 0 ? "▲" : "▼"}{fmt(Math.abs(s.change_pct))}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sağ alan */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        {!symbol ? (
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--r)", height: 400,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <div style={{ fontSize: 40, opacity: 0.2 }}>📡</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: 16, color: "var(--text-2)" }}>Teknik analiz için hisse seçin</div>
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>Soldan bir hisse seçin</div>
          </div>
        ) : (
          <>
            {/* Başlık Çubuğu */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--r)", padding: "12px 18px",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 9,
                  background: up ? "var(--green-bg)" : "var(--red-bg)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 700,
                  color: up ? "var(--green)" : "var(--red)",
                }}>{symbol.slice(0,4)}</div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-d)", fontSize: 18 }}>{symbol}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>{stockDetail?.name}</span>
                  </div>
                  {stockDetail?.price && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                      <span style={{ fontFamily: "var(--font-m)", fontSize: 16, fontWeight: 600 }}>₺{fmt(stockDetail.price)}</span>
                      <span style={{
                        fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600,
                        color: up ? "var(--green)" : "var(--red)",
                        background: up ? "var(--green-bg)" : "var(--red-bg)",
                        padding: "1px 7px", borderRadius: 20,
                      }}>{up ? "▲" : "▼"} {fmt(Math.abs(stockDetail.change_pct))}%</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {PERIODS.map(p => (
                  <button key={p.value} onClick={() => setPeriod(p.value)} style={{
                    padding: "4px 11px", borderRadius: 6, border: "1px solid",
                    borderColor: period === p.value ? "var(--accent)" : "var(--border)",
                    background: period === p.value ? "var(--accent-bg)" : "transparent",
                    color: period === p.value ? "var(--accent)" : "var(--text-3)",
                    fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 500, cursor: "pointer",
                  }}>{p.label}</button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── FİYAT + MA ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                  <PanelHeader title="Fiyat & Hareketli Ortalamalar" badge="MA20 · MA50 · MA200" />
                  {loading ? <Spinner /> : (
                    <div style={{ padding: "12px 8px 8px" }}>
                      <ResponsiveContainer width="100%" height={180}>
                        <ComposedChart data={techData} {...CHART_PROPS}>
                          {GRID}{XAXIS}
                          {YAXIS({ tickFormatter: v => `₺${fmt(v, 0)}` })}
                          <Tooltip content={<SimpleTooltip />} />
                          <Line type="monotone" dataKey="close"   name="Fiyat" stroke="#374151" strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="ma20"    name="MA20"  stroke="#1D4ED8" strokeWidth={1}   dot={false} strokeDasharray="3 2" />
                          <Line type="monotone" dataKey="ma50"    name="MA50"  stroke="#D97706" strokeWidth={1}   dot={false} />
                          <Line type="monotone" dataKey="ma200"   name="MA200" stroke="#DC2626" strokeWidth={1.2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: 14, padding: "6px 8px 0", flexWrap: "wrap" }}>
                        {[
                          { label: "Fiyat",  val: last.close,  color: "#374151" },
                          { label: "MA20",   val: last.ma20,   color: "#1D4ED8" },
                          { label: "MA50",   val: last.ma50,   color: "#D97706" },
                          { label: "MA200",  val: last.ma200,  color: "#DC2626" },
                        ].map(m => m.val && (
                          <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: 12, height: 2, background: m.color, display: "inline-block", borderRadius: 1 }}/>
                            <span style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--text-3)" }}>{m.label}</span>
                            <span style={{ fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 600, color: m.color }}>₺{fmt(m.val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── RSI ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                  <PanelHeader title="RSI (14)"
                    badge={last.rsi != null ? (last.rsi > 70 ? "Aşırı Alım" : last.rsi < 30 ? "Aşırı Satım" : fmt(last.rsi)) : "—"}
                    badgeColor={last.rsi > 70 ? "#DC2626" : last.rsi < 30 ? "#059669" : "var(--accent)"}
                  />
                  {loading ? <Spinner /> : (
                    <div style={{ padding: "12px 8px 8px" }}>
                      <ResponsiveContainer width="100%" height={120}>
                        <ComposedChart data={techData} {...CHART_PROPS}>
                          {GRID}{XAXIS}
                          {YAXIS({ domain: [0, 100], tickCount: 3, tickFormatter: v => `${v}` })}
                          <Tooltip content={<SimpleTooltip />} />
                          <ReferenceLine y={70} stroke="#DC2626" strokeDasharray="3 2" strokeWidth={1} />
                          <ReferenceLine y={30} stroke="#059669" strokeDasharray="3 2" strokeWidth={1} />
                          <ReferenceLine y={50} stroke="#E5E7EB" strokeWidth={1} />
                          <Area type="monotone" dataKey="rsi" name="RSI"
                            stroke="#6366F1" strokeWidth={1.5} fill="#6366F115" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* ── MACD ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                  <PanelHeader title="MACD (12, 26, 9)"
                    badge={last.macd != null ? (last.macd > 0 ? "Pozitif" : "Negatif") : "—"}
                    badgeColor={last.macd > 0 ? "#059669" : "#DC2626"}
                  />
                  {loading ? <Spinner /> : (
                    <div style={{ padding: "12px 8px 8px" }}>
                      <ResponsiveContainer width="100%" height={130}>
                        <ComposedChart data={techData} {...CHART_PROPS}>
                          {GRID}{XAXIS}
                          {YAXIS({ tickFormatter: v => fmt(v, 2) })}
                          <Tooltip content={<SimpleTooltip />} />
                          <ReferenceLine y={0} stroke="#E5E7EB" strokeWidth={1} />
                          <Bar dataKey="macdHist" name="Histogram" radius={[1,1,0,0]}>
                            {techData.map((d, i) => (
                              <Cell key={i} fill={Number(d.macdHist) >= 0 ? "#05966950" : "#DC262650"} />
                            ))}
                          </Bar>
                          <Line type="monotone" dataKey="macd"    name="MACD"   stroke="#1D4ED8" strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="macdSig" name="Sinyal" stroke="#DC2626" strokeWidth={1}   dot={false} strokeDasharray="3 2" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* ── IFT COMBO ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                  <PanelHeader title="Inverse Fisher Transform COMBO"
                    badge={last.iftAVG != null
                      ? (last.iftAVG > 0.5 ? "Aşırı Alım" : last.iftAVG < -0.5 ? "Aşırı Satım" : fmt(last.iftAVG, 3))
                      : "—"}
                    badgeColor={last.iftAVG > 0.5 ? "#DC2626" : last.iftAVG < -0.5 ? "#059669" : "var(--accent)"}
                  />
                  {loading ? <Spinner /> : (
                    <div style={{ padding: "12px 8px 8px" }}>
                      <ResponsiveContainer width="100%" height={140}>
                        <ComposedChart data={techData} {...CHART_PROPS}>
                          {GRID}{XAXIS}
                          {YAXIS({ domain: [-1, 1], tickCount: 5, tickFormatter: v => fmt(v, 1) })}
                          <Tooltip content={<SimpleTooltip />} />
                          <ReferenceLine y={0.5}  stroke="#DC2626" strokeDasharray="3 2" strokeWidth={1} label={{ value: "+0.5", position: "right", fontSize: 9, fill: "#DC2626", fontFamily: "var(--font-m)" }} />
                          <ReferenceLine y={-0.5} stroke="#059669" strokeDasharray="3 2" strokeWidth={1} label={{ value: "-0.5", position: "right", fontSize: 9, fill: "#059669", fontFamily: "var(--font-m)" }} />
                          <ReferenceLine y={0}    stroke="#E5E7EB" strokeWidth={1} />
                          <Line type="monotone" dataKey="iftCCI"   name="IFT-CCI"   stroke="#DC2626" strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="iftRSI"   name="IFT-RSI"   stroke="#374151" strokeWidth={1.2} dot={false} />
                          <Line type="monotone" dataKey="iftSTOCH" name="IFT-STOCH" stroke="#1D4ED8" strokeWidth={1}   dot={false} strokeDasharray="2 2" />
                          <Line type="monotone" dataKey="iftMFI"   name="IFT-MFI"   stroke="#9333EA" strokeWidth={1}   dot={false} strokeDasharray="2 2" />
                          <Line type="monotone" dataKey="iftAVG"   name="IFT-AVG"   stroke="#6366F1" strokeWidth={2.5} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <div style={{ display: "flex", gap: 12, padding: "6px 8px 0", flexWrap: "wrap" }}>
                        {[
                          { label: "AVG",   val: last.iftAVG,   color: "#6366F1", bold: true },
                          { label: "CCI",   val: last.iftCCI,   color: "#DC2626" },
                          { label: "RSI",   val: last.iftRSI,   color: "#374151" },
                          { label: "STOCH", val: last.iftSTOCH, color: "#1D4ED8" },
                          { label: "MFI",   val: last.iftMFI,   color: "#9333EA" },
                        ].map(m => m.val != null && (
                          <div key={m.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ width: m.bold ? 14 : 10, height: m.bold ? 3 : 2, background: m.color, display: "inline-block", borderRadius: 1 }}/>
                            <span style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--text-3)" }}>{m.label}</span>
                            <span style={{ fontFamily: "var(--font-m)", fontSize: 10, fontWeight: m.bold ? 700 : 500, color: m.color }}>
                              {fmt(m.val, 3)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sağ kolon — Sinyal paneli */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Aktif Sinyaller */}
                <div style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "var(--r)", overflow: "hidden",
                }}>
                  <PanelHeader title="Aktif Sinyaller" />
                  <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {signals.length === 0 ? (
                      <div style={{ padding: "20px 0", textAlign: "center" }}>
                        <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>⚡</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Aktif sinyal yok</div>
                      </div>
                    ) : signals.map((s, i) => (
                      <SignalCard key={i} type={s.type} value={s.value} />
                    ))}
                  </div>
                </div>

                {/* Son Değerler */}
                <div style={{
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "var(--r)", overflow: "hidden",
                }}>
                  <PanelHeader title="Son Değerler" />
                  <div style={{ padding: "8px 0" }}>
                    {[
                      { label: "RSI (14)",     val: last.rsi,     unit: "",    color: last.rsi > 70 ? "#DC2626" : last.rsi < 30 ? "#059669" : "var(--text-1)" },
                      { label: "MACD",         val: last.macd,    unit: "",    color: last.macd > 0 ? "#059669" : "#DC2626" },
                      { label: "MACD Signal",  val: last.macdSig, unit: "",    color: "var(--text-2)" },
                      { label: "Histogram",    val: last.macdHist,unit: "",    color: last.macdHist > 0 ? "#059669" : "#DC2626" },
                      { label: "MA20",         val: last.ma20,    unit: " ₺",  color: "var(--text-1)" },
                      { label: "MA50",         val: last.ma50,    unit: " ₺",  color: "var(--text-1)" },
                      { label: "MA200",        val: last.ma200,   unit: " ₺",  color: "var(--text-1)" },
                      { label: "IFT AVG",      val: last.iftAVG,  unit: "",    color: last.iftAVG > 0.5 ? "#DC2626" : last.iftAVG < -0.5 ? "#059669" : "var(--text-1)" },
                      { label: "IFT CCI",      val: last.iftCCI,  unit: "",    color: "var(--text-2)" },
                      { label: "IFT RSI",      val: last.iftRSI,  unit: "",    color: "var(--text-2)" },
                    ].map((row, i) => row.val != null && (
                      <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "7px 14px", borderBottom: "1px solid var(--border)",
                      }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{row.label}</span>
                        <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600, color: row.color }}>
                          {fmt(row.val, 3)}{row.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
