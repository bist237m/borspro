// src/pages/SectorsPage.jsx
// Sektör rotasyonu görünümü: hangi sektöre para giriyor, hangisinden çıkıyor?
// Tamamı mevcut tarama verisinden beslenir (yeni worker işi gerektirmez).

import { useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { sectors as sectorsApi } from "../api/client.js";

const fmt  = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtB = (n) => {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e12) return `${(v/1e12).toFixed(1)}Tr`;
  if (v >= 1e9)  return `${(v/1e9).toFixed(1)}Mr`;
  if (v >= 1e6)  return `${(v/1e6).toFixed(0)}M`;
  return String(v);
};

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

// Günlük değişime göre kutu rengi: yeşil/kırmızı tonu değişimin şiddetiyle koyulaşır.
function heatStyle(pct) {
  if (pct == null) return { background: "var(--surface)" };
  const p = Number(pct);
  const alpha = Math.min(Math.abs(p) / 3, 1) * 0.22 + 0.04; // %3+ değişim = en koyu ton
  return {
    background: p >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`,
    borderColor: p >= 0 ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
  };
}

function SectorDetail({ sector }) {
  const { data: stocks, loading } = useApi(() => sectorsApi.stocks(sector), [sector]);
  const th = { padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-m)" };

  return loading ? <Spinner /> : !stocks?.length ? (
    <div style={{ padding: 16, fontSize: 13, color: "var(--text-3)" }}>Bu sektörde hisse bulunamadı.</div>
  ) : (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Hisse</th><th style={th}>Fiyat</th><th style={th}>Günlük</th>
            <th style={th}>1 Hafta</th><th style={th}>1 Ay</th><th style={th}>F/K</th>
            <th style={th}>Yabancı %</th><th style={th}>Yab. 1H Δ</th><th style={th}>Piy. Değ.</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map(s => {
            const up = Number(s.change_pct) >= 0;
            const fUp = Number(s.foreign_ratio_1w_change) >= 0;
            return (
              <tr key={s.symbol} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontFamily: "var(--font)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.symbol}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>{s.name}</div>
                </td>
                <td style={td}>{s.price != null ? `₺${fmt(s.price)}` : "—"}</td>
                <td style={{ ...td, fontWeight: 600, color: s.change_pct == null ? "var(--text-3)" : up ? "var(--green)" : "var(--red)" }}>
                  {s.change_pct == null ? "—" : `${up ? "▲" : "▼"} ${fmt(Math.abs(s.change_pct))}%`}
                </td>
                <td style={{ ...td, color: Number(s.return_1w) >= 0 ? "var(--green)" : "var(--red)" }}>{s.return_1w != null ? `${Number(s.return_1w) >= 0 ? "+" : ""}${fmt(s.return_1w, 1)}%` : "—"}</td>
                <td style={{ ...td, color: Number(s.return_1m) >= 0 ? "var(--green)" : "var(--red)" }}>{s.return_1m != null ? `${Number(s.return_1m) >= 0 ? "+" : ""}${fmt(s.return_1m, 1)}%` : "—"}</td>
                <td style={td}>{fmt(s.pe_ratio, 1)}</td>
                <td style={td}>{s.foreign_ratio != null ? `%${fmt(s.foreign_ratio, 1)}` : "—"}</td>
                <td style={{ ...td, color: s.foreign_ratio_1w_change == null ? "var(--text-3)" : fUp ? "var(--green)" : "var(--red)" }}>
                  {s.foreign_ratio_1w_change == null ? "—" : `${fUp ? "+" : ""}${fmt(s.foreign_ratio_1w_change, 2)}`}
                </td>
                <td style={td}>{s.market_cap != null ? `₺${fmtB(s.market_cap)}` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SectorsPage() {
  const { data: sectors, loading } = useApi(() => sectorsApi.overview(), []);
  const [selected, setSelected] = useState(null);

  const best  = sectors?.[0];
  const worst = sectors?.length ? sectors[sectors.length - 1] : null;
  const inflow = sectors?.length
    ? [...sectors].sort((a, b) => Number(b.avg_foreign_1w_change || 0) - Number(a.avg_foreign_1w_change || 0))[0]
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Günün özeti */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Günün Güçlüsü",  s: best,   val: best  ? `${best.sector} (+${fmt(best.avg_change_pct)}%)`  : "—", color: "var(--green)" },
          { label: "Günün Zayıfı",   s: worst,  val: worst ? `${worst.sector} (${fmt(worst.avg_change_pct)}%)` : "—", color: "var(--red)" },
          { label: "Yabancı Girişi (1H)", s: inflow, val: inflow ? `${inflow.sector} (${Number(inflow.avg_foreign_1w_change) >= 0 ? "+" : ""}${fmt(inflow.avg_foreign_1w_change, 2)} puan)` : "—", color: "var(--accent)" },
        ].map(x => (
          <div key={x.label} style={{ flex: "1 1 220px", minWidth: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>{x.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: x.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loading ? "…" : x.val}</div>
          </div>
        ))}
      </div>

      {/* Isı haritası */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Sektör Isı Haritası</span>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-m)" }}>{sectors?.length || 0} sektör · günlük ort. değişime göre</span>
        </div>
        {loading ? <Spinner /> : (
          <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
            {sectors?.map(sec => {
              const up = Number(sec.avg_change_pct) >= 0;
              const isSel = selected === sec.sector;
              return (
                <div key={sec.sector}
                  onClick={() => setSelected(isSel ? null : sec.sector)}
                  style={{
                    ...heatStyle(sec.avg_change_pct),
                    border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 8, padding: "12px 14px", cursor: "pointer", minWidth: 0,
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sec.sector}</span>
                    <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, flexShrink: 0, color: sec.avg_change_pct == null ? "var(--text-3)" : up ? "var(--green)" : "var(--red)" }}>
                      {sec.avg_change_pct == null ? "—" : `${up ? "+" : ""}${fmt(sec.avg_change_pct)}%`}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-m)", display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span>{sec.stock_count} hisse</span>
                    <span>₺{fmtB(sec.total_market_cap)}</span>
                  </div>
                  {sec.top_symbol && (
                    <div style={{ fontSize: 10, marginTop: 6, display: "flex", justifyContent: "space-between", gap: 6, fontFamily: "var(--font-m)" }}>
                      <span style={{ color: "var(--green)" }}>▲ {sec.top_symbol}</span>
                      <span style={{ color: "var(--red)" }}>▼ {sec.worst_symbol}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Seçili sektör detayı */}
      {selected && (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>{selected} — Hisseler</span>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: 12, cursor: "pointer" }}>✕ Kapat</button>
          </div>
          <SectorDetail sector={selected} />
        </div>
      )}
    </div>
  );
}
