// src/pages/OverviewPage.jsx
import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useApi } from "../hooks/useApi.js";
import { portfolios as portfoliosApi, stocks as stocksApi } from "../api/client.js";
import TradingViewChart from "../components/TradingViewChart.jsx";

// ── SAYFAYA ÖZEL RESPONSIVE STİLLER ────────────────────────
const OVERVIEW_STYLES = `
  .kpi-row { display:grid; grid-template-columns: minmax(280px, 1.1fr) 2fr; gap:14px; }
  .stat-grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
  .chart-row { display:grid; grid-template-columns: 2fr 1fr; gap:16px; }
  .gainers-row { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
  @media (max-width: 900px) {
    .kpi-row { grid-template-columns: 1fr; }
  }
  @media (max-width: 780px) {
    .chart-row { grid-template-columns: 1fr; }
    .gainers-row { grid-template-columns: 1fr; }
  }
  @media (max-width: 420px) {
    .stat-grid { grid-template-columns: 1fr; }
  }
`;

// ── PARA BİRİMİ FORMATLAMA ──────────────────────────────────
const fmt = (n) => Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ₺ simgesini ayrı bir fontla (DM Mono) render ediyoruz —
// 'DM Serif Display' fontunda ₺ karakteri düzgün render olmuyor,
// yedek fontla üst üste binip "üstü çizili" gibi görünüyordu.
function Money({ value, size = 26, sign = false }) {
  const n = Number(value);
  const prefix = sign ? (n >= 0 ? "+" : "") : "";
  return (
    <span style={{ fontFamily: "var(--font-d)", fontSize: size }}>
      {prefix}
      <span style={{ fontFamily: "var(--font-m)" }}>₺</span>
      {fmt(n)}
    </span>
  );
}

// ── YARDIMCI BİLEŞENLER ────────────────────────────────────

function LoadingCard({ height = 120 }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      height, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ display: "flex", gap: 6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
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
      background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 10,
      padding: 20, fontSize: 13, color: "var(--red)",
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

// ── KAHRAMAN BLOK + SESSİZ İSTATİSTİKLER ────────────────────
// Sayfanın tek sorusu "param ne durumda?" — cevabı Net Getiri taşır,
// diğer metrikler onun etrafında sessiz bir şerit olarak durur.
function HeroCard({ netGrowth, netGrowthPct, netDeposited, totalAssets, loading }) {
  if (loading) return <LoadingCard height={170} />;
  const up = netGrowth >= 0;
  const hasDeposit = netDeposited > 0;
  return (
    <div className="fade" style={{
      minWidth: 0, background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "24px 26px", position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column", justifyContent: "center",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: up ? "linear-gradient(90deg,var(--green),transparent)" : "linear-gradient(90deg,var(--red),transparent)",
      }}/>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.09em", color: "var(--text-3)", textTransform: "uppercase", marginBottom: 10 }}>
        Net Getiri
      </div>
      <div style={{ color: up ? "var(--green)" : "var(--red)", lineHeight: 1.05, marginBottom: 10 }}>
        <Money value={netGrowth} sign size={38} />
      </div>
      {hasDeposit ? (
        <>
          <div style={{
            display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 4,
            padding: "3px 10px", borderRadius: 20, fontSize: 12, fontFamily: "var(--font-m)", fontWeight: 600,
            color: up ? "var(--green)" : "var(--red)",
            background: up ? "var(--green-bg)" : "var(--red-bg)",
            marginBottom: 12,
          }}>
            {up ? "▲" : "▼"} %{Math.abs(netGrowthPct).toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Yatırılan <b style={{ fontFamily: "var(--font-m)", color: "var(--text-2)" }}>₺{fmt(netDeposited)}</b>
            {" → "}toplam varlık <b style={{ fontFamily: "var(--font-m)", color: "var(--text-2)" }}>₺{fmt(totalAssets)}</b>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Getiri hesabı için önce Portföy sayfasından nakit yatırın.
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, sub, up, delay }) {
  return (
    <div className="fade" style={{
      animationDelay: `${delay}ms`, minWidth: 0,
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "16px 18px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-3)", textTransform: "uppercase", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ marginBottom: 4 }}>{value}</div>
      {sub && (
        <div style={{
          fontSize: 11, fontFamily: "var(--font-m)", fontWeight: 500,
          color: up === true ? "var(--green)" : up === false ? "var(--red)" : "var(--text-3)",
        }}>
          {up === true && "▲ "}{up === false && "▼ "}{sub}
        </div>
      )}
    </div>
  );
}

function PerfTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "8px 14px",
    }}>
      <div style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)", marginBottom: 2 }}>
        {payload[0]?.payload?.price_date
          ? new Date(payload[0].payload.price_date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })
          : payload[0]?.payload?.date}
      </div>
      <Money value={payload[0].value} size={16} />
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
  const [activeSec, setActiveSec] = useState(null);

  const { data: portList, loading: portLoading, error: portError } = useApi(
    () => portfoliosApi.list(), []
  );

  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];

  const { data: positions, loading: posLoading } = useApi(
    () => defaultPort ? portfoliosApi.positions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  const { data: stockList, loading: stocksLoading } = useApi(
    () => stocksApi.list(), []
  );

  const { data: cashHistory } = useApi(
    () => defaultPort ? portfoliosApi.cashTransactions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  const firstStock = positions?.[0]?.symbol;

  const totalValue   = positions?.reduce((s, p) => s + (Number(p.current_price) * Number(p.quantity)), 0) || 0;
  const cashBalance  = Number(defaultPort?.cash_balance || 0);
  const totalAssets  = totalValue + cashBalance;
  const totalCost    = positions?.reduce((s, p) => s + (Number(p.avg_cost) * Number(p.quantity)), 0) || 0;
  const unrealizedPnl = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? ((unrealizedPnl / totalCost) * 100).toFixed(2) : "0.00";
  const posCount     = positions?.length || 0;

  const dailyPnl     = positions?.reduce((s, p) => s + (Number(p.current_price || 0) * Number(p.quantity) * (Number(p.change_pct || 0) / 100)), 0) || 0;
  const dailyPct     = totalValue > 0 ? ((dailyPnl / totalValue) * 100).toFixed(2) : "0.00";

  // "Yatırdığım para ne kadar büyüdü" — nakit yatır/çek geçmişine göre
  const netDeposited = cashHistory?.reduce((s, tx) =>
    s + (tx.type === "deposit" ? Number(tx.amount) : -Number(tx.amount)), 0) || 0;
  const netGrowth    = totalAssets - netDeposited;
  const netGrowthPct = netDeposited > 0 ? (netGrowth / netDeposited) * 100 : 0;

  const sectorMap = {};
  positions?.forEach(p => {
    const sec = p.sector || "Diğer";
    sectorMap[sec] = (sectorMap[sec] || 0) + Number(p.current_price) * Number(p.quantity);
  });
  const sectorData = Object.entries(sectorMap).map(([name, val]) => ({
    name, value: totalValue > 0 ? Math.round((val / totalValue) * 100) : 0,
  }));

  const sorted  = [...(stockList || [])].filter(s => s.change_pct != null);
  const gainers = [...sorted].sort((a, b) => b.change_pct - a.change_pct).slice(0, 5);
  const losers  = [...sorted].sort((a, b) => a.change_pct - b.change_pct).slice(0, 5);

  if (portError) return <ErrorCard msg={portError} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{OVERVIEW_STYLES}</style>

      {/* Kahraman blok + sessiz istatistikler */}
      <div className="kpi-row">
        {portLoading || posLoading ? (
          <>
            <LoadingCard height={170} />
            <div className="stat-grid">{[0,1,2,3].map(i => <LoadingCard key={i} height={78} />)}</div>
          </>
        ) : (
          <>
            <HeroCard
              netGrowth={netGrowth} netGrowthPct={netGrowthPct}
              netDeposited={netDeposited} totalAssets={totalAssets}
            />
            <div className="stat-grid">
              <StatCell label="Portföy Değeri"     value={<Money value={totalValue} size={20} />}     sub={`${posCount} pozisyon · ${sectorData.length} sektör`} up={null}               delay={60}  />
              <StatCell label="Nakit Bakiye"       value={<Money value={cashBalance} size={20} />}    sub="alım gücü"                                            up={null}               delay={120} />
              <StatCell label="Günlük K/Z"         value={<Money value={dailyPnl} sign size={20} />}  sub={`%${Math.abs(Number(dailyPct)).toFixed(2)}`}          up={dailyPnl >= 0}      delay={180} />
              <StatCell label="Gerçekleşmemiş K/Z" value={<Money value={unrealizedPnl} sign size={20} />} sub={`%${Math.abs(Number(unrealizedPct)).toFixed(2)}`} up={unrealizedPnl >= 0} delay={240} />
            </div>
          </>
        )}
      </div>

      {/* Grafik Satırı */}
      <div className="chart-row">

        <div className="fade" style={{
          animationDelay: "320ms", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", minWidth: 0,
        }}>
          <div style={{ marginBottom: 12 }}>
            <SectionTitle title={`${firstStock || "Hisse"} Fiyat Geçmişi`} />
          </div>
          {!firstStock ? (
            <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)", fontSize: 13 }}>
              Fiyat grafiği için portföyünüze hisse ekleyin.
            </div>
          ) : (
            <div style={{ height: 260 }}>
              <TradingViewChart symbol={firstStock} height="100%" />
            </div>
          )}
        </div>

        <div className="fade" style={{
          animationDelay: "400ms", background: "var(--surface)",
          border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", minWidth: 0,
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
      <div className="gainers-row">
        {[
          { title: "Piyasada En Çok Kazanan", list: gainers, up: true  },
          { title: "Piyasada En Çok Kaybeden", list: losers, up: false },
        ].map(({ title, list, up }) => (
          <div key={title} className="fade" style={{
            animationDelay: "480ms", background: "var(--surface)",
            border: "1px solid var(--border)", borderRadius: 10, padding: "20px 22px", minWidth: 0,
          }}>
            <SectionTitle title={title} />
            {stocksLoading ? <LoadingCard height={180} /> : list.length > 0 ? list.map((s, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 0", borderBottom: i < list.length - 1 ? "1px solid var(--border)" : "none",
                gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: up ? "var(--green-bg)" : "var(--red-bg)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 600,
                    color: up ? "var(--green)" : "var(--red)",
                  }}>{s.symbol?.slice(0,3)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.symbol}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
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
