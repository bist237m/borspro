// src/pages/ChartsPage.jsx
import { useState, useMemo } from "react";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import { stocks as stocksApi } from "../api/client.js";

// ── YARDIMCI ──────────────────────────────────────────────
const fmt  = (n, d = 2) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtK = (n) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n/1_000).toFixed(0)}K` : String(n);
const dateLabel = (d, period) => {
  const dt = new Date(d);
  if (period === "1m") return dt.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  if (period === "1y" || period === "all") return dt.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
  return dt.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
};

function Spinner() {
  return (
    <div style={{ height: 400, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "var(--accent)",
          animation: `bl 1s ease ${i*0.18}s infinite`,
        }}/>
      ))}
      <style>{`@keyframes bl{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── MUM GRAFİĞİ TOOLTIP ───────────────────────────────────
function CandleTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const up = Number(d.close) >= Number(d.open);
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "12px 16px", minWidth: 160,
      boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
    }}>
      <div style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>
        {new Date(d.price_date).toLocaleDateString("tr-TR", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })}
      </div>
      {[
        ["Açılış",  d.open,  "var(--text-2)"],
        ["En Yüksek", d.high, "var(--green)"],
        ["En Düşük",  d.low,  "var(--red)"],
        ["Kapanış",  d.close, up ? "var(--green)" : "var(--red)"],
      ].map(([label, val, color]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600, color }}>₺{fmt(val)}</span>
        </div>
      ))}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Hacim</span>
        <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-2)" }}>{fmtK(d.volume)}</span>
      </div>
      {d.change_pct != null && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Değişim</span>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600, color: up ? "var(--green)" : "var(--red)" }}>
            {up ? "▲" : "▼"} {fmt(Math.abs(d.change_pct))}%
          </span>
        </div>
      )}
    </div>
  );
}

// ── MUM ŞEKLİ (özel SVG bar) ──────────────────────────────
// Recharts'ta gerçek mum grafiği için custom shape kullanıyoruz
function CandleShape(props) {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;

  const open  = Number(payload.open);
  const close = Number(payload.close);
  const high  = Number(payload.high);
  const low   = Number(payload.low);
  const up    = close >= open;

  // Y ekseninin domain'ini props'tan al
  const { yDomain } = props;
  if (!yDomain || yDomain[0] == null) return null;

  const [minY, maxY] = yDomain;
  const range = maxY - minY;
  if (range === 0) return null;

  // Grafik yüksekliği ve konumunu hesapla
  const chartH = props.chartHeight || 300;
  const toY = (val) => ((maxY - val) / range) * chartH;

  const openY   = toY(open);
  const closeY  = toY(close);
  const highY   = toY(high);
  const lowY    = toY(low);

  const bodyTop    = Math.min(openY, closeY);
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1);
  const centerX    = x + width / 2;
  const color      = up ? "#059669" : "#DC2626";
  const fillColor  = up ? "#059669" : "#DC2626";

  return (
    <g>
      {/* Üst fitil */}
      <line x1={centerX} y1={highY} x2={centerX} y2={bodyTop} stroke={color} strokeWidth={1} />
      {/* Gövde */}
      <rect
        x={x + 1} y={bodyTop}
        width={Math.max(width - 2, 1)} height={bodyHeight}
        fill={up ? fillColor : fillColor}
        fillOpacity={up ? 0.85 : 0.85}
        stroke={color} strokeWidth={0.5}
      />
      {/* Alt fitil */}
      <line x1={centerX} y1={bodyTop + bodyHeight} x2={centerX} y2={lowY} stroke={color} strokeWidth={1} />
    </g>
  );
}

// ── ÖZET İSTATİSTİK KARTI ─────────────────────────────────
function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "12px 16px", flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 18, color: color || "var(--text-1)" }}>
        {value}
      </div>
    </div>
  );
}

// ── DÖNEM SEÇİCİ ──────────────────────────────────────────
function PeriodBtn({ label, value, active, onClick }) {
  return (
    <button onClick={() => onClick(value)} style={{
      padding: "5px 12px", borderRadius: 6, border: "1px solid",
      borderColor: active ? "var(--accent)" : "var(--border)",
      background: active ? "var(--accent-bg)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-3)",
      fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 500,
      cursor: "pointer", transition: "all 0.15s",
    }}>{label}</button>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function ChartsPage() {
  const [symbol, setSymbol] = useState("");
  const [period, setPeriod] = useState("3m");
  const [search, setSearch] = useState("");

  // Hisse listesi
  const { data: stockList } = useApi(() => stocksApi.list(), []);

  // Seçili hissenin anlık verileri
  const { data: stockDetail } = useApi(
    () => symbol ? stocksApi.get(symbol) : Promise.resolve(null),
    [symbol]
  );

  // Fiyat geçmişi
  const { data: history, loading: histLoading } = useApi(
    () => symbol ? stocksApi.history(symbol, period) : Promise.resolve([]),
    [symbol, period]
  );

  // Filtrelenmiş hisse listesi (arama)
  const filtered = useMemo(() =>
    (stockList || []).filter(s =>
      !search ||
      s.symbol.toUpperCase().includes(search.toUpperCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 30),
    [stockList, search]
  );

  // Grafik verisi + değişim yüzdesi hesapla
  const chartData = useMemo(() => {
    if (!history?.length) return [];
    return history.map((bar, i) => {
      const prev = history[i - 1];
      const change_pct = prev
        ? ((Number(bar.close) - Number(prev.close)) / Number(prev.close)) * 100
        : 0;
      return { ...bar, change_pct };
    });
  }, [history]);

  // Y ekseni domain (padding ile)
  const yDomain = useMemo(() => {
    if (!chartData.length) return [0, 100];
    const lows   = chartData.map(d => Number(d.low));
    const highs  = chartData.map(d => Number(d.high));
    const minVal = Math.min(...lows);
    const maxVal = Math.max(...highs);
    const pad    = (maxVal - minVal) * 0.05;
    return [minVal - pad, maxVal + pad];
  }, [chartData]);

  // Özet istatistikler
  const stats = useMemo(() => {
    if (!chartData.length) return null;
    const last  = chartData[chartData.length - 1];
    const first = chartData[0];
    const highs = chartData.map(d => Number(d.high));
    const lows  = chartData.map(d => Number(d.low));
    const periodReturn = ((Number(last.close) - Number(first.open)) / Number(first.open)) * 100;
    return {
      last, first,
      periodHigh: Math.max(...highs),
      periodLow:  Math.min(...lows),
      periodReturn,
      avgVolume:  chartData.reduce((s, d) => s + Number(d.volume || 0), 0) / chartData.length,
    };
  }, [chartData]);

  const up = stockDetail ? Number(stockDetail.change_pct) >= 0 : true;

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 160px)", minHeight: 600 }}>

      {/* Sol panel — hisse listesi */}
      <div style={{
        width: 220, flexShrink: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--r)", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 7, padding: "7px 10px",
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Hisse ara..."
              style={{
                background: "none", border: "none", outline: "none",
                fontSize: 12, color: "var(--text-1)", width: "100%",
                fontFamily: "var(--font)",
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map(s => {
            const isActive = symbol === s.symbol;
            const sUp = Number(s.change_pct || 0) >= 0;
            return (
              <div key={s.id} onClick={() => setSymbol(s.symbol)} style={{
                padding: "10px 14px", cursor: "pointer",
                background: isActive ? "var(--accent-bg)" : "transparent",
                borderLeft: `3px solid ${isActive ? "var(--accent)" : "transparent"}`,
                borderBottom: "1px solid var(--border)",
                transition: "all 0.12s",
              }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12, color: isActive ? "var(--accent)" : "var(--text-1)" }}>
                      {s.symbol}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 }}>
                      {s.name}
                    </div>
                  </div>
                  {s.price && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600, color: "var(--text-1)" }}>
                        ₺{fmt(s.price)}
                      </div>
                      <div style={{ fontFamily: "var(--font-m)", fontSize: 10, color: sUp ? "var(--green)" : "var(--red)", marginTop: 1 }}>
                        {sUp ? "▲" : "▼"}{fmt(Math.abs(s.change_pct))}%
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!filtered.length && (
            <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
              Hisse bulunamadı
            </div>
          )}
        </div>
      </div>

      {/* Sağ panel — grafik */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>

        {!symbol ? (
          <div style={{
            flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--r)", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <div style={{ fontSize: 40, opacity: 0.2 }}>📊</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: 16, color: "var(--text-2)" }}>
              Grafik görüntülemek için hisse seçin
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>
              Soldan bir hisse seçin veya arama yapın
            </div>
          </div>
        ) : (
          <>
            {/* Başlık */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--r)", padding: "14px 20px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              flexWrap: "wrap", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  background: up ? "var(--green-bg)" : "var(--red-bg)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 700,
                  color: up ? "var(--green)" : "var(--red)", flexShrink: 0,
                }}>{symbol.slice(0,4)}</div>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontFamily: "var(--font-d)", fontSize: 22, color: "var(--text-1)" }}>
                      {symbol}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                      {stockDetail?.name}
                    </span>
                  </div>
                  {stockDetail?.price && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                      <span style={{ fontFamily: "var(--font-m)", fontSize: 20, fontWeight: 600, color: "var(--text-1)" }}>
                        ₺{fmt(stockDetail.price)}
                      </span>
                      <span style={{
                        fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600,
                        color: up ? "var(--green)" : "var(--red)",
                        background: up ? "var(--green-bg)" : "var(--red-bg)",
                        padding: "2px 8px", borderRadius: 20,
                      }}>
                        {up ? "▲" : "▼"} {fmt(Math.abs(stockDetail.change_pct))}%
                        &nbsp;₺{fmt(Math.abs(stockDetail.change_abs))}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dönem seçici */}
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { label: "1A",  value: "1m"  },
                  { label: "3A",  value: "3m"  },
                  { label: "6A",  value: "6m"  },
                  { label: "1Y",  value: "1y"  },
                  { label: "Tüm", value: "all" },
                ].map(p => (
                  <PeriodBtn key={p.value} {...p} active={period === p.value} onClick={setPeriod} />
                ))}
              </div>
            </div>

            {/* Özet istatistikler */}
            {stats && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <StatCard label="Dönem Açılış"    value={`₺${fmt(stats.first.open)}`} />
                <StatCard label="Dönem Kapanış"   value={`₺${fmt(stats.last.close)}`} />
                <StatCard label="Dönem Yüksek"    value={`₺${fmt(stats.periodHigh)}`} color="var(--green)" />
                <StatCard label="Dönem Düşük"     value={`₺${fmt(stats.periodLow)}`}  color="var(--red)"   />
                <StatCard
                  label="Dönem Getiri"
                  value={`${stats.periodReturn >= 0 ? "+" : ""}${fmt(stats.periodReturn)}%`}
                  color={stats.periodReturn >= 0 ? "var(--green)" : "var(--red)"}
                />
                <StatCard label="Ort. Hacim" value={fmtK(stats.avgVolume)} />
              </div>
            )}

            {/* Mum Grafiği */}
            <div style={{
              flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--r)", padding: "20px 16px 12px",
              display: "flex", flexDirection: "column", gap: 0, minHeight: 0,
            }}>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 14, marginBottom: 12, paddingLeft: 4 }}>
                Fiyat Grafiği (OHLC)
              </div>

              {histLoading ? <Spinner /> : chartData.length === 0 ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 28, opacity: 0.2 }}>📭</div>
                  <div style={{ fontSize: 13, color: "var(--text-3)" }}>Bu dönem için fiyat verisi bulunamadı</div>
                </div>
              ) : (
                <>
                  {/* Fiyat grafiği */}
                  <div style={{ flex: 1, minHeight: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
                        barCategoryGap="15%"
                      >
                        <CartesianGrid strokeDasharray="2 4" stroke="#F0F2F5" vertical={false} />
                        <XAxis
                          dataKey="price_date"
                          tickFormatter={d => dateLabel(d, period)}
                          tick={{ fontSize: 10, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
                          tickLine={false} axisLine={false}
                          interval={Math.max(Math.floor(chartData.length / 8) - 1, 0)}
                        />
                        <YAxis
                          domain={yDomain}
                          tick={{ fontSize: 10, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
                          tickLine={false} axisLine={false}
                          tickFormatter={v => `₺${fmt(v, 0)}`}
                          width={64}
                        />
                        <Tooltip content={<CandleTooltip />} />

                        {/* Mum gövdeleri — Bar olarak render ediyoruz, custom shape ile */}
                        <Bar dataKey="close" shape={(props) => {
                          const { x, y, width, payload } = props;
                          const open  = Number(payload.open);
                          const close = Number(payload.close);
                          const high  = Number(payload.high);
                          const low   = Number(payload.low);
                          const up    = close >= open;
                          const color = up ? "#059669" : "#DC2626";

                          // Recharts'ın verdiği koordinatları kullan
                          const centerX = x + width / 2;

                          // Gövde yüksekliği ve konumu Recharts'ın y/height'ından hesaplanır
                          // Bunun yerine doğrudan yAxis scale'i kullanmak daha doğru
                          // Burada props.background ile toplam grafik alanı erişilebilir
                          const bg = props.background;
                          if (!bg) return null;

                          const chartHeight = bg.height;
                          const chartY      = bg.y;
                          const [yMin, yMax] = yDomain;
                          const yRange = yMax - yMin;
                          if (yRange === 0) return null;

                          const toPixel = (val) =>
                            chartY + chartHeight - ((val - yMin) / yRange) * chartHeight;

                          const openPx  = toPixel(open);
                          const closePx = toPixel(close);
                          const highPx  = toPixel(high);
                          const lowPx   = toPixel(low);

                          const bodyTop = Math.min(openPx, closePx);
                          const bodyH   = Math.max(Math.abs(closePx - openPx), 1.5);

                          return (
                            <g key={`candle-${payload.price_date}`}>
                              {/* Fitil */}
                              <line x1={centerX} y1={highPx} x2={centerX} y2={bodyTop}
                                stroke={color} strokeWidth={1.2} />
                              <line x1={centerX} y1={bodyTop + bodyH} x2={centerX} y2={lowPx}
                                stroke={color} strokeWidth={1.2} />
                              {/* Gövde */}
                              <rect
                                x={x + 1} y={bodyTop}
                                width={Math.max(width - 2, 2)} height={bodyH}
                                fill={up ? "#059669" : "#DC2626"}
                                fillOpacity={0.85}
                                stroke={color} strokeWidth={0.5}
                                rx={1}
                              />
                            </g>
                          );
                        }}>
                          {chartData.map((_, i) => <Cell key={i} />)}
                        </Bar>

                        {/* Güncel fiyat referans çizgisi */}
                        {stockDetail?.price && (
                          <ReferenceLine
                            y={Number(stockDetail.price)}
                            stroke={up ? "#059669" : "#DC2626"}
                            strokeDasharray="4 3"
                            strokeWidth={1}
                            label={{
                              value: `₺${fmt(stockDetail.price)}`,
                              position: "right",
                              fontSize: 10,
                              fill: up ? "#059669" : "#DC2626",
                              fontFamily: "var(--font-m)",
                            }}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Hacim grafiği */}
                  <div style={{ height: 72, marginTop: 4 }}>
                    <div style={{ fontFamily: "var(--font-m)", fontSize: 9, color: "var(--text-3)", letterSpacing: "0.08em", marginBottom: 4, paddingLeft: 4 }}>
                      HACİM
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 0, right: 8, left: -8, bottom: 0 }}
                        barCategoryGap="15%"
                      >
                        <XAxis dataKey="price_date" hide />
                        <YAxis
                          tickFormatter={fmtK}
                          tick={{ fontSize: 9, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
                          tickLine={false} axisLine={false}
                          width={64} tickCount={2}
                        />
                        <Bar dataKey="volume" radius={[2,2,0,0]}>
                          {chartData.map((d, i) => (
                            <Cell
                              key={i}
                              fill={Number(d.close) >= Number(d.open) ? "#059669" : "#DC2626"}
                              fillOpacity={0.5}
                            />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
