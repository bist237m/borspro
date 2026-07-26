// src/pages/ChartsPage.jsx
import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi.js";
import { stocks as stocksApi } from "../api/client.js";
import TradingViewChart from "../components/TradingViewChart.jsx";

const fmt = (n, d = 2) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

export default function ChartsPage() {
  const [symbol, setSymbol] = useState("");
  const [search, setSearch] = useState("");

  const { data: stockList } = useApi(() => stocksApi.list(), []);
  const { data: stockDetail } = useApi(
    () => symbol ? stocksApi.get(symbol) : Promise.resolve(null),
    [symbol]
  );

  const filtered = useMemo(() =>
    (stockList || []).filter(s =>
      !search ||
      s.symbol.toUpperCase().includes(search.toUpperCase()) ||
      s.name.toLowerCase().includes(search.toLowerCase())
    ).slice(0, 30),
    [stockList, search]
  );

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
            </div>

            {/* TradingView Grafiği */}
            <div style={{
              flex: 1, background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--r)", overflow: "hidden", minHeight: 0,
            }}>
              <TradingViewChart symbol={symbol} height="100%" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
