// src/pages/TechnicalsPage.jsx
import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { stocks as stocksApi } from "../api/client.js";
import { FILTER_LABELS, FILTER_DEFINITIONS } from "../constants/filterDefinitions.js";
import TradingViewChart from "../components/TradingViewChart.jsx";

// ── FORMAT ────────────────────────────────────────────────
const fmt = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const dateStr = (d) => new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });

const RESPONSIVE_STYLES = `
  .ta-layout { display:flex; gap:16px; min-height:600px; }
  .ta-grid { display:grid; grid-template-columns: 1fr 300px; gap:14px; align-items:start; }
  @media (max-width: 900px) {
    .ta-layout { flex-direction:column; }
    .ta-grid { grid-template-columns: 1fr; }
  }
`;

function PanelHeader({ title, badge, badgeColor }) {
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
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
        <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: `bl 1s ease ${i*0.18}s infinite` }}/>
      ))}
      <style>{`@keyframes bl{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── FİLTRE DURUMU KARTI ─────────────────────────────────────
function FilterCard({ label, active, definition }) {
  return (
    <div style={{
      background: active ? "var(--green-bg)" : "var(--bg)",
      border: `1px solid ${active ? "var(--green)" : "var(--border)"}`,
      borderRadius: 8, padding: "10px 14px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--green)" : "var(--text-3)", display: "flex", alignItems: "center", gap: 5 }}>
        {label}
        <span title={definition} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 14, height: 14, borderRadius: "50%", fontSize: 9, fontWeight: 700,
          color: "var(--text-3)", border: "1px solid var(--border)", cursor: "help", flexShrink: 0,
        }}>ⓘ</span>
      </span>
      <span style={{
        fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 700,
        color: active ? "var(--green)" : "var(--text-3)",
      }}>{active ? "✓ AKTİF" : "— pasif"}</span>
    </div>
  );
}

// ── GÖSTERGE DEĞERİ SATIRI ──────────────────────────────────
function IndicatorRow({ label, value, decimals = 3, highlight }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 14px", borderBottom: "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600, color: highlight || "var(--text-1)" }}>
        {fmt(value, decimals)}
      </span>
    </div>
  );
}

function SimpleTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>
      <div style={{ fontFamily: "var(--font-m)", color: "var(--text-3)", marginBottom: 4 }}>{dateStr(label)}</div>
      <div style={{ fontFamily: "var(--font-m)", fontWeight: 600 }}>₺{fmt(payload[0].value)}</div>
    </div>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function TechnicalsPage() {
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");

  const { data: stockList } = useApi(() => stocksApi.list(), []);
  const { data: stockDetail } = useApi(() => symbol ? stocksApi.get(symbol) : Promise.resolve(null), [symbol]);
  const { data: filterData, loading: filterLoading } = useApi(
    () => symbol ? stocksApi.filters(symbol) : Promise.resolve(null),
    [symbol]
  );

  const filtered = (stockList || []).filter(s =>
    !search || s.symbol.toUpperCase().includes(search.toUpperCase()) || s.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 40);

  const up = stockDetail ? Number(stockDetail.change_pct) >= 0 : true;

  return (
    <div className="ta-layout">
      <style>{RESPONSIVE_STYLES}</style>

      {/* Sol panel — hisse seçici */}
      <div style={{
        width: 210, flexShrink: 0,
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: "var(--r)", display: "flex", flexDirection: "column",
        overflow: "hidden", alignSelf: "flex-start", maxHeight: "calc(100vh - 140px)",
      }}>
        <div style={{ padding: "12px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Hisse ara..."
              style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: "var(--text-1)", width: "100%", fontFamily: "var(--font)" }} />
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
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
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
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", height: 300,
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
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", padding: "12px 18px",
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
            </div>

            <div className="ta-grid">
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* ── FİYAT GRAFİĞİ (TradingView) ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
                  <PanelHeader title="Fiyat Geçmişi" />
                  <div style={{ height: 380 }}>
                    <TradingViewChart symbol={symbol} height="100%" />
                  </div>
                </div>

                {/* ── FİLTRE DURUMU ── */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
                  <PanelHeader title="Filtre Durumu"
                    badge={filterData ? `Son güncelleme: ${new Date(filterData.updated_at).toLocaleDateString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}` : null} />
                  {filterLoading ? <Spinner /> : !filterData ? (
                    <div style={{ padding: 30, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
                      Bu hisse için henüz gösterge verisi yok. Bir tarama çalıştırılmalı.
                    </div>
                  ) : (
                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                      {Object.entries(FILTER_LABELS).map(([key, label]) => (
                        <FilterCard key={key} label={label} active={!!filterData[key]} definition={FILTER_DEFINITIONS[key]} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Sağ kolon — Gösterge değerleri */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
                  <PanelHeader title="Haftalık Göstergeler" />
                  {filterLoading ? <Spinner /> : !filterData ? (
                    <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>Veri yok</div>
                  ) : (
                    <div style={{ padding: "8px 0" }}>
                      <IndicatorRow label="INV1 (CCI 9)" value={filterData.inv1_9}
                        highlight={filterData.inv1_9 > 0.5 ? "var(--red)" : filterData.inv1_9 < -0.5 ? "var(--green)" : undefined} />
                      <IndicatorRow label="EMA21 (haftalık)" value={filterData.ema21_weekly} decimals={2} />
                      <IndicatorRow label="MACDAS (haftalık)" value={filterData.macdas_weekly}
                        highlight={filterData.macdas_weekly > 0 ? "var(--green)" : "var(--red)"} />
                      <IndicatorRow label="CCI 20 (haftalık)" value={filterData.cci20_weekly} decimals={1}
                        highlight={filterData.cci20_weekly > 100 ? "var(--red)" : filterData.cci20_weekly < -100 ? "var(--green)" : undefined} />
                      <IndicatorRow label="Fiyat (haftalık kapanış)" value={filterData.price_weekly} decimals={2} />
                    </div>
                  )}
                </div>

                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
                  <PanelHeader title="Günlük Göstergeler" />
                  {filterLoading ? <Spinner /> : !filterData ? (
                    <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>Veri yok</div>
                  ) : (
                    <div style={{ padding: "8px 0" }}>
                      <IndicatorRow label="INV1 (CCI 13)" value={filterData.inv1_13}
                        highlight={filterData.inv1_13 > 0.5 ? "var(--red)" : filterData.inv1_13 < -0.5 ? "var(--green)" : undefined} />
                      <IndicatorRow label="EMA21 (günlük)" value={filterData.ema21_daily} decimals={2} />
                      <IndicatorRow label="MACDAS (günlük)" value={filterData.macdas_daily}
                        highlight={filterData.macdas_daily > 0 ? "var(--green)" : "var(--red)"} />
                      <IndicatorRow label="CCI 20 (günlük)" value={filterData.cci20_daily} decimals={1}
                        highlight={filterData.cci20_daily > 100 ? "var(--red)" : filterData.cci20_daily < -100 ? "var(--green)" : undefined} />
                      <IndicatorRow label="Fiyat (günlük kapanış)" value={filterData.price_daily} decimals={2} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
