// src/pages/WatchlistPage.jsx
import { useState } from "react";
import { useApi, useMutation } from "../hooks/useApi.js";
import { watchlists as wlApi } from "../api/client.js";

// ── SİNYAL BADGE ──────────────────────────────────────────
const SIGNAL_META = {
  RSI_OVERSOLD:      { label: "RSI Aşırı Satım",  color: "#059669", bg: "#ECFDF5", icon: "📉" },
  RSI_OVERBOUGHT:    { label: "RSI Aşırı Alım",   color: "#DC2626", bg: "#FEF2F2", icon: "📈" },
  MACD_BULLISH_CROSS:{ label: "MACD Bullish",     color: "#1D4ED8", bg: "#EEF2FF", icon: "⬆️" },
  MACD_BEARISH_CROSS:{ label: "MACD Bearish",     color: "#9333EA", bg: "#F5F3FF", icon: "⬇️" },
  GOLDEN_CROSS:      { label: "Golden Cross",     color: "#D97706", bg: "#FFFBEB", icon: "✨" },
  DEATH_CROSS:       { label: "Death Cross",      color: "#6B7280", bg: "#F9FAFB", icon: "💀" },
  IFT_OVERSOLD:      { label: "IFT Aşırı Satım",  color: "#0891B2", bg: "#ECFEFF", icon: "🔵" },
  IFT_OVERBOUGHT:    { label: "IFT Aşırı Alım",   color: "#BE185D", bg: "#FDF2F8", icon: "🔴" },
};

function SignalBadge({ type }) {
  const meta = SIGNAL_META[type] || { label: type, color: "#6B7280", bg: "#F9FAFB", icon: "⚡" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      background: meta.bg, color: meta.color,
      fontSize: 10, fontWeight: 600,
      fontFamily: "var(--font-m)", whiteSpace: "nowrap",
      border: `1px solid ${meta.color}30`,
    }}>
      {meta.icon} {meta.label}
    </span>
  );
}

// ── YÜKLEME / HATA ────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 40, gap: 6 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
          animation: `pulse 1s ease-in-out ${i*0.2}s infinite`,
        }}/>
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── TABLO SATIRI ──────────────────────────────────────────
function WatchlistRow({ item, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const signalTypes = item.auto_comment
    ? Object.keys(SIGNAL_META).filter(k => item.auto_comment.includes(k.replace(/_/g," ")))
    : [];

  const up      = Number(item.change_pct) >= 0;
  const pct     = Number(item.change_pct || 0).toFixed(2);
  const price   = Number(item.price || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
  const isAuto  = !!item.signal_id;  // otomatik sinyal ile eklendiyse

  return (
    <>
      <tr style={{ borderBottom: "1px solid var(--border)", transition: "background 0.12s" }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>

        {/* Hisse */}
        <td style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, flexShrink: 0,
              background: up ? "var(--green-bg)" : "var(--red-bg)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 700,
              color: up ? "var(--green)" : "var(--red)",
            }}>{item.symbol?.slice(0,3)}</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{item.symbol}</span>
                {isAuto && (
                  <span style={{
                    fontSize: 9, padding: "1px 5px", borderRadius: 4,
                    background: "#EEF2FF", color: "var(--accent)",
                    fontFamily: "var(--font-m)", fontWeight: 600, letterSpacing: "0.06em",
                  }}>OTO</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{item.name}</div>
            </div>
          </div>
        </td>

        {/* Fiyat */}
        <td style={{ padding: "12px 16px", fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 500 }}>
          ₺{price}
        </td>

        {/* Değişim */}
        <td style={{ padding: "12px 16px" }}>
          <span style={{
            fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600,
            color: up ? "var(--green)" : "var(--red)",
            background: up ? "var(--green-bg)" : "var(--red-bg)",
            padding: "2px 8px", borderRadius: 20,
          }}>
            {up ? "▲" : "▼"} {Math.abs(pct)}%
          </span>
        </td>

        {/* Sektör */}
        <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-2)" }}>
          {item.sector || "—"}
        </td>

        {/* Sinyal Badge'leri */}
        <td style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {item.signal_types
              ? item.signal_types.split(",").map(t => <SignalBadge key={t} type={t.trim()} />)
              : <span style={{ fontSize: 12, color: "var(--text-3)" }}>—</span>
            }
          </div>
        </td>

        {/* Yorum / Genişlet */}
        <td style={{ padding: "12px 16px", maxWidth: 260 }}>
          {item.auto_comment ? (
            <div>
              <div style={{
                fontSize: 12, color: "var(--text-2)", lineHeight: 1.5,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: expanded ? "unset" : 2,
                WebkitBoxOrient: "vertical",
              }}>
                {item.auto_comment}
              </div>
              {item.auto_comment.length > 80 && (
                <button onClick={() => setExpanded(!expanded)} style={{
                  background: "none", border: "none", fontSize: 11,
                  color: "var(--accent)", cursor: "pointer", marginTop: 2,
                  fontFamily: "var(--font)", padding: 0,
                }}>
                  {expanded ? "Küçült ↑" : "Devamı ↓"}
                </button>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Yorum yok</span>
          )}
        </td>

        {/* Eklenme */}
        <td style={{ padding: "12px 16px", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-m)", whiteSpace: "nowrap" }}>
          {item.added_at
            ? new Date(item.added_at).toLocaleDateString("tr-TR", { day:"2-digit", month:"short", year:"2-digit" })
            : "—"}
        </td>

        {/* Sil */}
        <td style={{ padding: "12px 16px", textAlign: "right" }}>
          <button onClick={() => onRemove(item.id)} style={{
            background: "none", border: "1px solid var(--border)",
            borderRadius: 6, padding: "4px 10px", fontSize: 12,
            color: "var(--text-3)", cursor: "pointer", transition: "all 0.15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--red)"; e.currentTarget.style.color = "var(--red)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-3)"; }}
          >Çıkar</button>
        </td>
      </tr>
    </>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function WatchlistPage() {
  const [filter, setFilter] = useState("all"); // all | bullish | bearish | auto

  // Watchlist'leri çek
  const { data: lists, loading: listsLoading } = useApi(
    () => wlApi.list(), []
  );

  const defaultList = lists?.find(l => l.is_default) || lists?.[0];

  // Varsayılan listenin hisselerini çek
  const { data: items, loading: itemsLoading, refetch } = useApi(
    () => defaultList ? wlApi.items(defaultList.id) : Promise.resolve([]),
    [defaultList?.id]
  );

  const { mutate: removeItem } = useMutation(
    (itemId) => wlApi.removeItem(defaultList?.id, itemId)
  );

  async function handleRemove(itemId) {
    if (!confirm("Bu hisseyi izleme listesinden çıkarmak istiyor musunuz?")) return;
    await removeItem(itemId);
    refetch();
  }

  // Filtre uygula
  const filtered = (items || []).filter(item => {
    if (filter === "bullish") return item.signal_types?.includes("BULLISH") || item.signal_types?.includes("OVERSOLD") || item.signal_types?.includes("GOLDEN");
    if (filter === "bearish") return item.signal_types?.includes("BEARISH") || item.signal_types?.includes("OVERBOUGHT") || item.signal_types?.includes("DEATH");
    if (filter === "auto")    return !!item.signal_id;
    return true;
  });

  const autoCount     = (items || []).filter(i => i.signal_id).length;
  const bullishCount  = (items || []).filter(i => i.signal_types?.match(/OVERSOLD|BULLISH|GOLDEN/)).length;
  const bearishCount  = (items || []).filter(i => i.signal_types?.match(/OVERBOUGHT|BEARISH|DEATH/)).length;

  const loading = listsLoading || itemsLoading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Üst Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Özet Kartları */}
          {[
            { label: "Toplam Hisse", value: items?.length || 0, color: "var(--accent)", bg: "var(--accent-bg)" },
            { label: "Otomatik Eklenen", value: autoCount, color: "#0891B2", bg: "#ECFEFF" },
            { label: "Alım Sinyali", value: bullishCount, color: "var(--green)", bg: "var(--green-bg)" },
            { label: "Satım Sinyali", value: bearishCount, color: "var(--red)", bg: "var(--red-bg)" },
          ].map((s, i) => (
            <div key={i} style={{
              background: "#fff", border: "1px solid var(--border)", borderRadius: 8,
              padding: "8px 16px", display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                fontFamily: "var(--font-d)", fontSize: 20, color: s.color,
                background: s.bg, width: 34, height: 34, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{s.value}</span>
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Filtre */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "all",     label: "Tümü" },
            { id: "auto",    label: "⚡ Otomatik" },
            { id: "bullish", label: "🟢 Alım" },
            { id: "bearish", label: "🔴 Satım" },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: "6px 12px", borderRadius: 7, border: "1px solid",
              borderColor: filter === f.id ? "var(--accent)" : "var(--border)",
              background: filter === f.id ? "var(--accent-bg)" : "#fff",
              color: filter === f.id ? "var(--accent)" : "var(--text-2)",
              fontSize: 12, fontWeight: filter === f.id ? 600 : 400, cursor: "pointer",
            }}>{f.label}</button>
          ))}
        </div>
      </div>

      {/* Tablo */}
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>

        {/* Tablo Başlığı */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>
              {defaultList?.name || "İzleme Listesi"}
            </span>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)", marginLeft: 10 }}>
              {filtered.length} hisse
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-m)" }}>
            Her gün 17:25'te otomatik güncellenir
          </div>
        </div>

        {loading ? <Spinner /> : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: 15, color: "var(--text-2)", marginBottom: 6 }}>
              {filter === "all" ? "İzleme listesi boş" : "Bu filtrede hisse yok"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)" }}>
              Sinyaller her gün 17:25'te otomatik eklenecek.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--bg)" }}>
                  {["Hisse","Fiyat","Değişim","Sektör","Sinyaller","Analiz Yorumu","Eklenme",""].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 16px", textAlign: "left", fontSize: 11,
                      fontWeight: 600, color: "var(--text-3)", letterSpacing: "0.07em",
                      textTransform: "uppercase", whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--border)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <WatchlistRow key={item.id} item={item} onRemove={handleRemove} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sinyal Açıklamaları */}
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 14, marginBottom: 14 }}>Sinyal Açıklamaları</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {Object.entries(SIGNAL_META).map(([type, meta]) => (
            <div key={type} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <SignalBadge type={type} />
              <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4, marginTop: 1 }}>
                {type === "RSI_OVERSOLD"       && "RSI 30 altında"}
                {type === "RSI_OVERBOUGHT"     && "RSI 70 üzerinde"}
                {type === "MACD_BULLISH_CROSS" && "MACD sinyal hattını yukarı kesti"}
                {type === "MACD_BEARISH_CROSS" && "MACD sinyal hattını aşağı kesti"}
                {type === "GOLDEN_CROSS"       && "50 GMA, 200 GMA'yı yukarı kesti"}
                {type === "DEATH_CROSS"        && "50 GMA, 200 GMA'yı aşağı kesti"}
                {type === "IFT_OVERSOLD"       && "IFT Avg < -0.5 (4 indikatör)"}
                {type === "IFT_OVERBOUGHT"     && "IFT Avg > +0.5 (4 indikatör)"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
