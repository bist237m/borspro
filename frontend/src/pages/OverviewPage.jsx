// src/pages/OverviewPage.jsx
import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import { portfolios as portfoliosApi, stocks as stocksApi } from "../api/client.js";

// ── YARDIMCI BİLEŞENLER ────────────────────────────────────

function LoadingCard({ height = 120 }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #E2E5EA", borderRadius: 10,
      height, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ display: "flex", gap: 6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "#1D4ED8",
            animation: `pulse 1s ease-in-out ${i * 0.2}s infinite`,
          }}/>
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

function ErrorCard({ msg }) {
  return (
    <div style={{
      background: "#FEF2F2", border: "1px solid #FEE2E2", borderRadius: 10,
      padding: 20, fontSize: 13, color: "#DC2626",
    }}>⚠️ {msg}</div>
  );
}

function SectionTitle({ title, action, onAction }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <h2 style={{ fontFamily: "var(--font-d)", fontSize: 16, fontWeight: 400 }}>{title}</h2>
      {action && (
        <button onClick={onAction} style={{
          fontSize: 12, color: "var(--accent)", background: "none",
          border: "none", cursor: "pointer", fontWeight: 500,
        }}>{action} →</button>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, up, icon, delay }) {
  return (
    <div className="fade" style={{
      animationDelay: `${delay}ms`, flex: 1, minWidth: 0,
      background: "#fff", border: "1px solid #E2E5EA", borderRadius: 10,
      padding: "20px 22px", position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: up === true
          ? "linear-gradient(90deg,#059669,transparent)"
          : up === false
          ? "linear-gradient(90deg,#DC2626,transparent)"
          : "linear-gradient(90deg,#1D4ED8,transparent)",
        opacity: 0.5,
      }}/>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-3)", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{
          width: 32, height: 32, borderRadius: 8, fontSize: 16,
          background: up === true ? "var(--green-bg)" : up === false ? "var(--red-bg)" : "var(--accent-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{icon}</span>
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 26, color: "var(--text-1)", marginBottom: 8 }}>
        {value}
      </div>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        padding: "2px 8px", borderRadius: 20, fontSize: 11,
        fontFamily: "var(--font-m)", fontWeight: 500,
        color: up === true ? "var(--green)" : up === false ? "var(--red)" : "var(--text-2)",
        background: up === true ? "var(--green-bg)" : up === false ? "var(--red-bg)" : "var(--bg)",
        border: `1px solid ${up === true ? "#D1FAE5" : up === false ? "#FEE2E2" : "var(--border)"}`,
      }}>
        {up === true && "▲ "}{up === false && "▼ "}{sub}
      </div>
    </div>
  );
}

function PerfTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff", border: "1px solid #E2E5EA",
      borderRadius: 8, padding: "8px 14px",
    }}>
      <div style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>
        {payload[0]?.payload?.price_date
          ? new Date(payload[0].payload.price_date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
          : payload[0]?.payload?.date}
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 16, color: "var(--text-1)" }}>
        ₺{Number(payload[0].value).toLocaleString("tr-TR")}
      </div>
    </div>
  );
}

function PeriodSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {["1m","3m","6m","1y"].map(p => (
        <button key={p} onClick={() => onChange(p)} style={{
          padding: "3px 10px", borderRadius: 6,
          border: `1px solid ${value === p ? "var(--accent)" : "var(--border)"}`,
          background: value === p ? "var(--accent-bg)" : "transparent",
          color: value === p ? "var(--accent)" : "var(--text-3)",
          fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 500, cursor: "pointer",
        }}>{p.toUpperCase()}</button>
      ))}
    </div>
  );
}

const SECTOR_COLORS = ["#1D4ED8","#0EA5E9","#6366F1","#8B5CF6","#EC4899","#94A3B8","#F59E0B","#10B981"];

// ── ANA SAYFA ──────────────────────────────────────────────
export default function OverviewPage() {
  const [period,   setPeriod]   = useState("3m");
  const [activeSec, setActiveSec] = useState(null);

  // Portföyleri çek
  const { data: portList, loading: portLoading, error: portError } = useApi(
    () => portfoliosApi.list(), []
  );

  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];

  // Varsayılan portföyün pozisyonları
  const { data: positions, loading: posLoading } = useApi(
    () => defaultPort ? portfoliosApi.positions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  // Tüm aktif hisseler (kazanan/kaybeden için)
  const { data: stockList, loading: stocksLoading } = useApi(
    () => stocksApi.list(), []
  );

  // Birinci hissenin fiyat geçmişini performans grafiği için kullan
  const firstStock = positions?.[0]?.symbol;
  const { data: histData, loading: histLoading } = useApi(
    () => firstStock ? stocksApi.history(firstStock, period) : Promise.resolve([]),
    [firstStock, period]
  );

  // ── Hesaplamalar ──
  const totalValue   = positions?.reduce((s, p) => s + (Number(p.current_price) * Number(p.quantity)), 0) || 0;
  const totalCost    = positions?.reduce((s, p) => s + (Number(p.avg_cost) * Number(p.quantity)), 0) || 0;
  const unrealizedPnl = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? ((unrealizedPnl / totalCost) * 100).toFixed(2) : "0.00";
  const posCount     = positions?.length || 0;

  // Günlük K/Z (tüm pozisyonlarda change_pct ortalaması)
  const dailyPnl     = positions?.reduce((s, p) => s + (Number(p.current_price || 0) * Number(p.quantity) * (Number(p.change_pct || 0) / 100)), 0) || 0;
  const dailyPct     = totalValue > 0 ? ((dailyPnl / totalValue) * 100).toFixed(2) : "0.00";

  // Sektör dağılımı
  const sectorMap = {};
  positions?.forEach(p => {
    const sec = p.sector || "Diğer";
    sectorMap[sec] = (sectorMap[sec] || 0) + Number(p.current_price) * Number(p.quantity);
  });
  const sectorData = Object.entries(sectorMap).map(([name, val]) => ({
    name, value: totalValue > 0 ? Math.round((val / totalValue) * 100) : 0,
  }));

  // Kazanan / Kaybeden hisseler
  const sorted  = [...(stockList || [])].filter(s => s.change_pct != null);
  const gainers = [...sorted].sort((a, b) => b.change_pct - a.change_pct).slice(0, 5);
  const losers  = [...sorted].sort((a, b) => a.change_pct - b.change_pct).slice(0, 5);

  const fmt = (n) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (portError) return <ErrorCard msg={portError} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* KPI Satırı */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {portLoading || posLoading ? (
          [0,1,2,3].map(i => <LoadingCard key={i} height={110} />)
        ) : (
          <>
            <KpiCard label="Portföy Değeri"  value={`₺${fmt(totalValue)}`}    sub={`${posCount} pozisyon`}           up={null}              icon="💼" delay={0}   />
            <KpiCard label="Günlük K/Z"      value={`${dailyPnl >= 0 ? "+" : ""}₺${fmt(dailyPnl)}`} sub={`${dailyPct >= 0 ? "+" : ""}${dailyPct}%`} up={dailyPnl >= 0}  icon="📈" delay={80}  />
            <KpiCard label="Gerçekleşmemiş K/Z" value={`${unrealizedPnl >= 0 ? "+" : ""}₺${fmt(unrealizedPnl)}`} sub={`${unrealizedPct >= 0 ? "+" : ""}${unrealizedPct}%`} up={unrealizedPnl >= 0} icon="🎯" delay={160} />
            <KpiCard label="Açık Pozisyon"   value={String(posCount)}          sub={`${sectorData.length} sektör`}  up={null}              icon="📊" delay={240} />
          </>
        )}
      </div>

      {/* Grafik Satırı */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>

        {/* Performans Grafiği */}
        <div className="fade" style={{
          animationDelay: "320ms", background: "#fff",
          border: "1px solid #E2E5EA", borderRadius: 10, padding: "20px 22px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div>
              <SectionTitle title={`${firstStock || "Hisse"} Fiyat Geçmişi`} />
              {histData?.length > 0 && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: -8 }}>
                  <span style={{ fontFamily: "var(--font-d)", fontSize: 22 }}>
                    ₺{fmt(histData[histData.length - 1]?.close)}
                  </span>
                </div>
              )}
            </div>
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>
          {histLoading ? <LoadingCard height={200} /> : histData?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={histData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#059669" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#059669" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" vertical={false}/>
                <XAxis dataKey="price_date"
                  tickFormatter={d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"})}
                  tick={{ fontSize: 10, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
                  tickLine={false} axisLine={false}
                  interval={Math.floor((histData?.length || 1) / 6)}/>
                <YAxis tick={{ fontSize: 10, fill: "#9CA3AF", fontFamily: "var(--font-m)" }}
                  tickLine={false} axisLine={false}
                  tickFormatter={v => `₺${v}`} domain={["auto","auto"]}/>
                <Tooltip content={<PerfTooltip />}/>
                <Area type="monotone" dataKey="close"
                  stroke="#059669" strokeWidth={2}
                  fill="url(#grad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }}/>
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13 }}>
              Fiyat verisi bulunamadı. Portföyünüze hisse ekleyin.
            </div>
          )}
        </div>

        {/* Sektör Dağılımı */}
        <div className="fade" style={{
          animationDelay: "400ms", background: "#fff",
          border: "1px solid #E2E5EA", borderRadius: 10, padding: "20px 22px",
        }}>
          <SectionTitle title="Sektör Dağılımı" />
          {posLoading ? <LoadingCard height={140} /> : sectorData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={sectorData} cx="50%" cy="50%" innerRadius={40} outerRadius={62}
                    dataKey="value" paddingAngle={2}
                    onMouseEnter={(_, i) => setActiveSec(i)}
                    onMouseLeave={() => setActiveSec(null)}>
                    {sectorData.map((_, i) => (
                      <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                        opacity={activeSec === null || activeSec === i ? 1 : 0.3}
                        stroke="none"/>
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                {sectorData.map((s, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    opacity: activeSec === null || activeSec === i ? 1 : 0.35,
                    transition: "opacity 0.15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, display: "inline-block", background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}/>
                      <span style={{ fontSize: 12, color: "var(--text-2)" }}>{s.name}</span>
                    </div>
                    <span style={{ fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 500 }}>%{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13 }}>
              Portföyünüze hisse ekleyince sektör dağılımı görünecek.
            </div>
          )}
        </div>
      </div>

      {/* Kazanan / Kaybeden */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {[
          { title: "En Çok Kazanan", list: gainers, up: true  },
          { title: "En Çok Kaybeden", list: losers, up: false },
        ].map(({ title, list, up }) => (
          <div key={title} className="fade" style={{
            animationDelay: "480ms", background: "#fff",
            border: "1px solid #E2E5EA", borderRadius: 10, padding: "20px 22px",
          }}>
            <SectionTitle title={title} />
            {stocksLoading ? <LoadingCard height={180} /> : list.length > 0 ? list.map((s, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 0", borderBottom: i < list.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: up ? "var(--green-bg)" : "var(--red-bg)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 600,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>{s.symbol?.slice(0,3)}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.symbol}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{s.name}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 500 }}>
                    ₺{fmt(s.price)}
                  </div>
                  <div style={{
                    fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600, marginTop: 2,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>
                    {up ? "▲" : "▼"} {Math.abs(Number(s.change_pct)).toFixed(2)}%
                  </div>
                </div>
              </div>
            )) : (
              <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13 }}>
                Veri yok
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
