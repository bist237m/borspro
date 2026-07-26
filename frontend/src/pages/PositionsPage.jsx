// src/pages/PositionsPage.jsx
import { useState } from "react";
import { useApi, useMutation } from "../hooks/useApi.js";
import { portfolios as portApi, stocks as stocksApi } from "../api/client.js";

// ── YARDIMCI ──────────────────────────────────────────────
const fmt  = (n, dec = 2) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtN = (n)          => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

function Pill({ value, prefix = "" }) {
  const v  = Number(value || 0);
  const up = v >= 0;
  return (
    <span style={{
      fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600,
      color: up ? "var(--green)" : "var(--red)",
      background: up ? "var(--green-bg)" : "var(--red-bg)",
      padding: "2px 8px", borderRadius: 20,
      border: `1px solid ${up ? "var(--green)" : "var(--red)"}`,
      whiteSpace: "nowrap",
    }}>
      {up ? "▲" : "▼"} {prefix}{Math.abs(v) < 0.01 ? "0.00" : fmt(Math.abs(v))}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 48, gap: 6 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: "50%", background: "var(--accent)",
          animation: `blink 1s ease ${i * 0.18}s infinite`,
        }}/>
      ))}
      <style>{`@keyframes blink{0%,100%{opacity:.25;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

function Card({ children, style = {}, delay = 0 }) {
  return (
    <div className="fade" style={{
      animationDelay: `${delay}ms`,
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--r)", ...style,
    }}>
      {children}
    </div>
  );
}

// ── RESPONSIVE STİLLER ─────────────────────────────────────
const POS_STYLES = `
  .pos-kpi-row { display:flex; gap:14px; flex-wrap:wrap; }
  .pos-kpi-row > * { flex: 1 1 210px; }
  .pos-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
  .pos-actions { display:flex; gap:8px; flex-wrap:wrap; }
`;

// ── KPI KARTI ──────────────────────────────────────────────
function KpiCard({ label, value, sub, up, icon, delay }) {
  return (
    <Card delay={delay} style={{ padding: "18px 22px", minWidth: 0, position: "relative", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: up === true
          ? "linear-gradient(90deg,var(--green),transparent)"
          : up === false
          ? "linear-gradient(90deg,var(--red),transparent)"
          : "linear-gradient(90deg,var(--accent),transparent)",
        opacity: 0.55,
      }}/>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-3)", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{
          width: 30, height: 30, borderRadius: 7, fontSize: 15,
          background: up === true ? "var(--green-bg)" : up === false ? "var(--red-bg)" : "var(--accent-bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>{icon}</span>
      </div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 24, color: "var(--text-1)", marginBottom: 6 }}>
        {value}
      </div>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px",
        borderRadius: 20, fontSize: 11, fontFamily: "var(--font-m)", fontWeight: 500,
        color: up === true ? "var(--green)" : up === false ? "var(--red)" : "var(--text-2)",
        background: up === true ? "var(--green-bg)" : up === false ? "var(--red-bg)" : "var(--bg)",
        border: `1px solid ${up === true ? "var(--green)" : up === false ? "var(--red)" : "var(--border)"}`,
      }}>
        {up === true && "▲ "}{up === false && "▼ "}{sub}
      </div>
    </Card>
  );
}

// ── NAKİT YATIR / ÇEK MODAL ─────────────────────────────────
function CashModal({ portfolioId, onClose, onSuccess }) {
  const [type,   setType]   = useState("deposit");
  const [amount, setAmount] = useState("");
  const [notes,  setNotes]  = useState("");
  const [error,  setError]  = useState("");

  const { mutate, loading } = useMutation((tx) => portApi.addCash(portfolioId, tx));

  async function handleSubmit() {
    if (!amount || Number(amount) <= 0) {
      setError("Geçerli bir tutar girin."); return;
    }
    setError("");
    try {
      await mutate({ type, amount: Number(amount), notes });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--overlay)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--surface)", borderRadius: 14, width: "100%", maxWidth: 400,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        animation: "popIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both",
      }}>
        <style>{`@keyframes popIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}`}</style>

        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 17 }}>Nakit İşlemi</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "var(--text-3)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          <div style={{ display: "flex", gap: 0, background: "var(--bg)", borderRadius: 8, padding: 3 }}>
            {["deposit","withdraw"].map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                flex: 1, padding: "8px", borderRadius: 6, border: "none",
                background: type === t ? "var(--surface)" : "transparent",
                color: type === t ? (t === "deposit" ? "var(--green)" : "var(--red)") : "var(--text-3)",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                boxShadow: type === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}>{t === "deposit" ? "▲ Nakit Yatır" : "▼ Nakit Çek"}</button>
            ))}
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              TUTAR ₺
            </label>
            <input type="number" min="0" step="0.01"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="0.00" autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)",
                fontSize: 15, fontFamily: "var(--font-m)", outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e  => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              NOT
            </label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="İsteğe bağlı not..."
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg)",
                fontSize: 13, fontFamily: "var(--font)", outline: "none",
              }}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e  => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid var(--red)", fontSize: 13, color: "var(--red)" }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            padding: "11px", borderRadius: 8, border: "none",
            background: loading ? "var(--bg)" : type === "deposit" ? "var(--green)" : "var(--red)",
            color: loading ? "var(--text-3)" : "#fff",
            fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
          }}>
            {loading ? "İşleniyor..." : type === "deposit" ? "▲ Yatır" : "▼ Çek"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ALIM/SATIM MODAL ───────────────────────────────────────
function TxModal({ portfolioId, stocks, cashBalance, initialSymbol, onClose, onSuccess }) {
  const [type,       setType]       = useState("buy");
  const [symbol,     setSymbol]     = useState(initialSymbol || "");
  const [stockSearch, setStockSearch] = useState("");
  const [quantity,   setQuantity]   = useState("");
  const [price,      setPrice]      = useState(() => {
    const s = stocks?.find(s => s.symbol === initialSymbol);
    return s?.price ? Number(s.price).toFixed(2) : "";
  });
  const [commission, setCommission] = useState("0");
  const [notes,      setNotes]      = useState("");
  const [error,      setError]      = useState("");

  const { mutate, loading } = useMutation(
    (tx) => portApi.addTransaction(portfolioId, tx)
  );

  const selectedStock = stocks?.find(s => s.symbol === symbol);
  const total = (Number(quantity || 0) * Number(price || 0) + Number(commission || 0));

  async function handleSubmit() {
    if (!symbol || !quantity || !price) {
      setError("Hisse, adet ve fiyat zorunludur."); return;
    }
    if (!selectedStock) { setError("Geçerli bir hisse seçin."); return; }
    if (type === "buy" && total > Number(cashBalance || 0) + 0.01) {
      setError(`Yetersiz nakit bakiyesi. Gerekli: ₺${fmtN(total)}, mevcut: ₺${fmtN(cashBalance)}`);
      return;
    }
    setError("");
    try {
      await mutate({
        stock_id:   selectedStock.id,
        type,
        quantity:   Number(quantity),
        price:      Number(price),
        commission: Number(commission || 0),
        notes,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--overlay)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--surface)", borderRadius: 14, width: "100%", maxWidth: 460,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        animation: "popIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both",
        maxHeight: "90vh", overflowY: "auto",
      }}>
        <style>{`@keyframes popIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}`}</style>

        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 17 }}>İşlem Ekle</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "var(--text-3)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "var(--bg)", borderRadius: 8, padding: "8px 12px",
          }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Kullanılabilir Nakit</span>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 600 }}>₺{fmtN(cashBalance)}</span>
          </div>

          <div style={{ display: "flex", gap: 0, background: "var(--bg)", borderRadius: 8, padding: 3 }}>
            {["buy","sell"].map(t => (
              <button key={t} onClick={() => setType(t)} style={{
                flex: 1, padding: "8px", borderRadius: 6, border: "none",
                background: type === t ? "var(--surface)" : "transparent",
                color: type === t ? (t === "buy" ? "var(--green)" : "var(--red)") : "var(--text-3)",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
                boxShadow: type === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.15s",
              }}>{t === "buy" ? "▲ Alım" : "▼ Satım"}</button>
            ))}
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              HİSSE
            </label>
            {symbol ? (
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{symbol} — {selectedStock?.name}</span>
                <button type="button" onClick={() => { setSymbol(""); setStockSearch(""); }} style={{
                  background: "none", border: "none", color: "var(--text-3)", fontSize: 12, cursor: "pointer",
                }}>Değiştir ✕</button>
              </div>
            ) : (
              <>
                <input
                  type="text" value={stockSearch} onChange={e => setStockSearch(e.target.value)}
                  placeholder="Hisse ara (kod ya da isim)..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--bg)",
                    fontSize: 13, color: "var(--text-1)", fontFamily: "var(--font)", outline: "none",
                  }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e  => e.target.style.borderColor = "var(--border)"}
                />
                {stockSearch && (
                  <div style={{
                    maxHeight: 180, overflowY: "auto", marginTop: 6,
                    border: "1px solid var(--border)", borderRadius: 8,
                  }}>
                    {(stocks || [])
                      .filter(s =>
                        s.symbol.toUpperCase().includes(stockSearch.toUpperCase()) ||
                        s.name.toLowerCase().includes(stockSearch.toLowerCase())
                      )
                      .slice(0, 30)
                      .map(s => (
                        <div key={s.id} onClick={() => {
                          setSymbol(s.symbol);
                          setStockSearch("");
                          if (s.price) setPrice(Number(s.price).toFixed(2));
                        }} style={{
                          padding: "9px 12px", cursor: "pointer", fontSize: 13,
                          borderBottom: "1px solid var(--border)",
                        }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <b>{s.symbol}</b> <span style={{ color: "var(--text-3)", fontSize: 12 }}>— {s.name}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
            {selectedStock?.price && (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, fontFamily: "var(--font-m)" }}>
                Anlık: ₺{fmt(selectedStock.price)}
                <span style={{ marginLeft: 6, color: Number(selectedStock.change_pct) >= 0 ? "var(--green)" : "var(--red)" }}>
                  {Number(selectedStock.change_pct) >= 0 ? "▲" : "▼"} {fmt(Math.abs(selectedStock.change_pct))}%
                </span>
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "ADET",    val: quantity,   set: setQuantity,   ph: "100",    step: "1"    },
              { label: "FİYAT ₺", val: price,      set: setPrice,      ph: "0.00",   step: "0.01" },
            ].map(f => (
              <div key={f.label}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                  {f.label}
                </label>
                <input type="number" min="0" step={f.step}
                  value={f.val} onChange={e => f.set(e.target.value)}
                  placeholder={f.ph}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    border: "1px solid var(--border)", background: "var(--bg)",
                    fontSize: 13, fontFamily: "var(--font-m)", outline: "none",
                  }}
                  onFocus={e  => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e   => e.target.style.borderColor = "var(--border)"}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                KOMİSYON ₺
              </label>
              <input type="number" min="0" step="0.01"
                value={commission} onChange={e => setCommission(e.target.value)}
                placeholder="0.00"
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg)",
                  fontSize: 13, fontFamily: "var(--font-m)", outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent)"}
                onBlur={e  => e.target.style.borderColor = "var(--border)"}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
                NOT
              </label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="İsteğe bağlı not..."
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg)",
                  fontSize: 13, fontFamily: "var(--font)", outline: "none",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent)"}
                onBlur={e  => e.target.style.borderColor = "var(--border)"}
              />
            </div>
          </div>

          {quantity && price && (
            <div style={{
              background: type === "buy" ? "var(--green-bg)" : "var(--red-bg)",
              border: `1px solid ${type === "buy" ? "var(--green)" : "var(--red)"}`,
              borderRadius: 8, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>Toplam Tutar</span>
              <span style={{
                fontFamily: "var(--font-d)", fontSize: 18,
                color: type === "buy" ? "var(--green)" : "var(--red)",
              }}>₺{fmtN(total)}</span>
            </div>
          )}

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid var(--red)", fontSize: 13, color: "var(--red)" }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            padding: "11px", borderRadius: 8, border: "none",
            background: loading ? "var(--bg)" : type === "buy" ? "var(--green)" : "var(--red)",
            color: loading ? "var(--text-3)" : "#fff",
            fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.15s",
          }}>
            {loading ? "İşleniyor..." : type === "buy" ? "▲ Alım Yap" : "▼ Satım Yap"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── İŞLEM GEÇMİŞİ SATIRI ─────────────────────────────────
function TxRow({ tx }) {
  const isBuy = tx.type === "buy";
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <td style={{ padding: "10px 16px" }}>
        <span style={{
          fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 700,
          color: isBuy ? "var(--green)" : "var(--red)",
          background: isBuy ? "var(--green-bg)" : "var(--red-bg)",
          padding: "2px 8px", borderRadius: 20,
          border: `1px solid ${isBuy ? "var(--green)" : "var(--red)"}`,
        }}>
          {isBuy ? "▲ ALIM" : "▼ SATIM"}
        </span>
      </td>
      <td style={{ padding: "10px 16px", fontWeight: 600, fontSize: 13 }}>{tx.symbol}</td>
      <td style={{ padding: "10px 16px", fontFamily: "var(--font-m)", fontSize: 12 }}>{fmtN(tx.quantity)}</td>
      <td style={{ padding: "10px 16px", fontFamily: "var(--font-m)", fontSize: 12 }}>₺{fmt(tx.price)}</td>
      <td style={{ padding: "10px 16px", fontFamily: "var(--font-m)", fontSize: 12 }}>₺{fmt(tx.commission)}</td>
      <td style={{ padding: "10px 16px", fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 600 }}>
        ₺{fmtN(tx.total_amount)}
      </td>
      <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-2)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {tx.notes || "—"}
      </td>
      <td style={{ padding: "10px 16px", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-m)", whiteSpace: "nowrap" }}>
        {new Date(tx.executed_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </td>
    </tr>
  );
}

// ── NAKİT İŞLEM SATIRI ────────────────────────────────────
function CashRow({ tx }) {
  const isDeposit = tx.type === "deposit";
  return (
    <tr style={{ borderBottom: "1px solid var(--border)" }}
      onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <td style={{ padding: "10px 16px" }}>
        <span style={{
          fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 700,
          color: isDeposit ? "var(--green)" : "var(--red)",
          background: isDeposit ? "var(--green-bg)" : "var(--red-bg)",
          padding: "2px 8px", borderRadius: 20,
          border: `1px solid ${isDeposit ? "var(--green)" : "var(--red)"}`,
        }}>
          {isDeposit ? "▲ YATIRMA" : "▼ ÇEKME"}
        </span>
      </td>
      <td style={{ padding: "10px 16px", fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 600 }}>
        ₺{fmtN(tx.amount)}
      </td>
      <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-2)" }}>{tx.notes || "—"}</td>
      <td style={{ padding: "10px 16px", fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-m)", whiteSpace: "nowrap" }}>
        {new Date(tx.executed_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
      </td>
    </tr>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function PositionsPage() {
  const [showTxModal,   setShowTxModal]   = useState(false);
  const [preselectSymbol, setPreselectSymbol] = useState("");
  const [showCashModal, setShowCashModal] = useState(false);
  const [tab, setTab] = useState("positions"); // positions | history | cash

  const { data: portList, loading: portLoading, refetch: refetchPort } = useApi(() => portApi.list(), []);
  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];
  const cashBalance = Number(defaultPort?.cash_balance || 0);

  const { data: positions, loading: posLoading, refetch: refetchPos } = useApi(
    () => defaultPort ? portApi.positions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  const { data: txHistory, loading: txLoading, refetch: refetchTx } = useApi(
    () => defaultPort ? portApi.transactions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  const { data: cashHistory, loading: cashLoading, refetch: refetchCash } = useApi(
    () => defaultPort ? portApi.cashTransactions(defaultPort.id) : Promise.resolve([]),
    [defaultPort?.id]
  );

  const { data: stockList } = useApi(() => stocksApi.list(), []);

  function handleTxSuccess() {
    refetchPos();
    refetchTx();
    refetchPort();
  }

  function handleCashSuccess() {
    refetchCash();
    refetchPort();
  }

  const stockValue     = positions?.reduce((s, p) => s + Number(p.current_price || 0) * Number(p.quantity), 0) || 0;
  const totalAssets     = stockValue + cashBalance;
  const totalCost       = positions?.reduce((s, p) => s + Number(p.avg_cost) * Number(p.quantity), 0) || 0;
  const unrealizedPnl   = stockValue - totalCost;
  const unrealizedPct   = totalCost > 0 ? (unrealizedPnl / totalCost) * 100 : 0;
  const realizedPnl     = positions?.reduce((s, p) => s + Number(p.realized_pnl || 0), 0) || 0;
  const totalPnl        = unrealizedPnl + realizedPnl;

  // "Yatırdığım para ne kadar büyüdü" — nakit yatır/çek geçmişine göre
  const netDeposited = cashHistory?.reduce((s, tx) =>
    s + (tx.type === "deposit" ? Number(tx.amount) : -Number(tx.amount)), 0) || 0;
  const netGrowth    = totalAssets - netDeposited;
  const netGrowthPct = netDeposited > 0 ? (netGrowth / netDeposited) * 100 : 0;
  const dailyPnl        = positions?.reduce((s, p) => s + Number(p.current_price || 0) * Number(p.quantity) * (Number(p.change_pct || 0) / 100), 0) || 0;

  const loading = portLoading || posLoading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{POS_STYLES}</style>

      <div className="pos-kpi-row">
        <KpiCard label="Toplam Varlık"        value={`₺${fmtN(totalAssets)}`}    sub="Nakit + Hisse"                       up={null}                icon="🏦" delay={0}   />
        <KpiCard label="Net Getiri"           value={`${netGrowth >= 0 ? "+" : ""}₺${fmtN(netGrowth)}`} sub={netDeposited > 0 ? `${netGrowthPct >= 0 ? "+" : ""}${fmt(netGrowthPct)}% (yatırılan nakite göre)` : "Henüz nakit yatırılmadı"} up={netGrowth >= 0} icon="💰" delay={20}  />
        <KpiCard label="Nakit Bakiyesi"       value={`₺${fmtN(cashBalance)}`}    sub={`${positions?.length || 0} pozisyon`} up={null}                icon="💵" delay={40}  />
        <KpiCard label="Gerçekleşmemiş K/Z"   value={`${unrealizedPnl >= 0 ? "+" : ""}₺${fmtN(unrealizedPnl)}`} sub={`${unrealizedPct >= 0 ? "+" : ""}${fmt(unrealizedPct)}%`} up={unrealizedPnl >= 0} icon="📊" delay={80}  />
        <KpiCard label="Gerçekleşmiş K/Z"     value={`${realizedPnl >= 0 ? "+" : ""}₺${fmtN(realizedPnl)}`}     sub="Tüm zamanlar"         up={realizedPnl >= 0}   icon="🎯" delay={120} />
        <KpiCard label="Günlük K/Z"           value={`${dailyPnl >= 0 ? "+" : ""}₺${fmtN(dailyPnl)}`}           sub="Bugün"                up={dailyPnl >= 0}      icon="📈" delay={160} />
      </div>

      <div className="pos-toolbar">
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[
            { id: "positions", label: "Açık Pozisyonlar" },
            { id: "history",   label: "İşlem Geçmişi" },
            { id: "cash",      label: "Nakit Geçmişi" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "7px 16px", borderRadius: 8,
              border: `1px solid ${tab === t.id ? "var(--accent)" : "var(--border)"}`,
              background: tab === t.id ? "var(--accent-bg)" : "var(--surface)",
              color: tab === t.id ? "var(--accent)" : "var(--text-2)",
              fontWeight: tab === t.id ? 600 : 400, fontSize: 13, cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>
        <div className="pos-actions">
          <button onClick={() => setShowCashModal(true)} style={{
            padding: "8px 18px", borderRadius: 8, border: "1px solid var(--accent)",
            background: "var(--accent-bg)", color: "var(--accent)",
            fontWeight: 600, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontSize: 16 }}>💵</span> Nakit Yatır/Çek
          </button>
          <button onClick={() => { setPreselectSymbol(""); setShowTxModal(true); }} style={{
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.87"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <span style={{ fontSize: 16 }}>+</span> İşlem Ekle
          </button>
        </div>
      </div>

      {tab === "positions" && (
        <Card>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Açık Pozisyonlar</span>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>
              {positions?.length || 0} hisse
            </span>
          </div>
          {loading ? <Spinner /> : !positions?.length ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 15, color: "var(--text-2)", marginBottom: 6 }}>Henüz pozisyon yok</div>
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Önce "Nakit Yatır" ile bakiye ekleyin, sonra "İşlem Ekle" ile alım yapın.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    {["Hisse","Adet","Ort. Maliyet","Güncel Fiyat","Piyasa Değeri","G. K/Z ₺","G. K/Z %","Günlük","Gerç. K/Z",""].map((h, i) => (
                      <th key={i} style={{
                        padding: "10px 14px", textAlign: "left",
                        fontSize: 10, fontWeight: 600, color: "var(--text-3)",
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map(p => {
                    const mktVal   = Number(p.current_price || 0) * Number(p.quantity);
                    const uPnl     = mktVal - Number(p.avg_cost) * Number(p.quantity);
                    const uPct     = Number(p.avg_cost) > 0 ? (uPnl / (Number(p.avg_cost) * Number(p.quantity))) * 100 : 0;
                    const dayPnl   = Number(p.current_price || 0) * Number(p.quantity) * (Number(p.change_pct || 0) / 100);
                    const portPct  = stockValue > 0 ? (mktVal / stockValue) * 100 : 0;

                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                              background: uPnl >= 0 ? "var(--green-bg)" : "var(--red-bg)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "var(--font-m)", fontSize: 9, fontWeight: 700,
                              color: uPnl >= 0 ? "var(--green)" : "var(--red)",
                            }}>{p.symbol?.slice(0,4)}</div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.symbol}</div>
                              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>{fmt(portPct)}% portföy</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-m)", fontSize: 13 }}>{fmtN(p.quantity)}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-m)", fontSize: 13 }}>₺{fmt(p.avg_cost)}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 600 }}>₺{fmt(p.current_price)}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-m)", fontSize: 13 }}>₺{fmtN(mktVal)}</td>
                        <td style={{ padding: "12px 14px" }}><Pill value={uPnl} prefix="₺" /></td>
                        <td style={{ padding: "12px 14px" }}><Pill value={uPct} /></td>
                        <td style={{ padding: "12px 14px" }}><Pill value={dayPnl} prefix="₺" /></td>
                        <td style={{ padding: "12px 14px" }}><Pill value={p.realized_pnl} prefix="₺" /></td>
                        <td style={{ padding: "12px 14px" }}>
                          <button onClick={() => { setPreselectSymbol(p.symbol); setShowTxModal(true); }} style={{
                            background: "none", border: "1px solid var(--border)",
                            borderRadius: 6, padding: "4px 10px", fontSize: 11,
                            color: "var(--text-2)", cursor: "pointer",
                          }}>+ İşlem</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: "var(--bg)", borderTop: "2px solid var(--border)" }}>
                    <td colSpan={4} style={{ padding: "11px 14px", fontWeight: 700, fontSize: 12, color: "var(--text-2)" }}>TOPLAM</td>
                    <td style={{ padding: "11px 14px", fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 700 }}>₺{fmtN(stockValue)}</td>
                    <td style={{ padding: "11px 14px" }}><Pill value={unrealizedPnl} prefix="₺" /></td>
                    <td style={{ padding: "11px 14px" }}><Pill value={unrealizedPct} /></td>
                    <td style={{ padding: "11px 14px" }}><Pill value={dailyPnl} prefix="₺" /></td>
                    <td style={{ padding: "11px 14px" }}><Pill value={realizedPnl} prefix="₺" /></td>
                    <td/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "history" && (
        <Card>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>İşlem Geçmişi</span>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>
              Son {txHistory?.length || 0} işlem
            </span>
          </div>
          {txLoading ? <Spinner /> : !txHistory?.length ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🗒️</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 15, color: "var(--text-2)" }}>İşlem geçmişi boş</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    {["Tür","Hisse","Adet","Fiyat","Komisyon","Toplam","Not","Tarih"].map((h, i) => (
                      <th key={i} style={{
                        padding: "10px 16px", textAlign: "left",
                        fontSize: 10, fontWeight: 600, color: "var(--text-3)",
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {txHistory.map(tx => <TxRow key={tx.id} tx={tx} />)}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "cash" && (
        <Card>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Nakit Geçmişi</span>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>
              Bakiye: ₺{fmtN(cashBalance)}
            </span>
          </div>
          {cashLoading ? <Spinner /> : !cashHistory?.length ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>💵</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 15, color: "var(--text-2)", marginBottom: 6 }}>Henüz nakit işlemi yok</div>
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>"Nakit Yatır/Çek" ile ilk yatırımınızı yapın.</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    {["Tür","Tutar","Not","Tarih"].map((h, i) => (
                      <th key={i} style={{
                        padding: "10px 16px", textAlign: "left",
                        fontSize: 10, fontWeight: 600, color: "var(--text-3)",
                        letterSpacing: "0.07em", textTransform: "uppercase",
                        borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cashHistory.map(tx => <CashRow key={tx.id} tx={tx} />)}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {showTxModal && (
        <TxModal
          portfolioId={defaultPort?.id}
          stocks={stockList}
          cashBalance={cashBalance}
          initialSymbol={preselectSymbol}
          onClose={() => setShowTxModal(false)}
          onSuccess={handleTxSuccess}
        />
      )}
      {showCashModal && (
        <CashModal
          portfolioId={defaultPort?.id}
          onClose={() => setShowCashModal(false)}
          onSuccess={handleCashSuccess}
        />
      )}
    </div>
  );
}
