// src/pages/ReportsPage.jsx
import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import { portfolios as portApi, signals as signalsApi, reports as reportsApi, ai as aiApi } from "../api/client.js";
import { FILTER_LABELS, FILTER_DEFINITIONS } from "../constants/filterDefinitions.js";

const fmt  = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Kronoloji yardımcıları — sinyal listeleri en yeni girişten eskiye sıralanır ──
const byEntryDateDesc = (a, b) => new Date(b.entry_date || 0) - new Date(a.entry_date || 0);
const daysAgo = (d) => {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  return Math.round((today - day) / 86400000);
};
const isNewEntry = (d) => { const n = daysAgo(d); return n != null && n <= 1; };
const NewBadge = () => (
  <span style={{
    fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
    padding: "1px 6px", borderRadius: 4, marginLeft: 6, verticalAlign: "middle",
    background: "var(--accent)", color: "#fff",
  }}>YENİ</span>
);

// ── Filtre kartı görselleştirmeleri ─────────────────────────
function WinRateBar({ rate }) {
  const pct = Math.max(0, Math.min(100, Number(rate) || 0));
  return (
    <div title={`Kazanma oranı: %${pct}`} style={{ height: 5, borderRadius: 3, background: "var(--red-bg)", overflow: "hidden", margin: "2px 0 10px" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: "var(--green)", borderRadius: 3 }} />
    </div>
  );
}

// %5 → %10 → %20 → %30 kilometre taşlarına ulaşan hisse sayısı.
// %5 ve %10 sayıları item listesinden türetilir (API ayrıca vermiyor),
// %20 ve %30 API'nin hazır alanlarından gelir.
function MilestoneFunnel({ s }) {
  const total = Number(s.total) || 0;
  if (!total) return null;
  const fromItems = (key) => (s.items?.length ? s.items.filter(i => i[key] != null).length : null);
  const steps = [
    { label: "+%5",  n: fromItems("days_to_5") },
    { label: "+%10", n: fromItems("days_to_10") },
    { label: "+%20", n: s.reached_20 ?? fromItems("days_to_20") },
    { label: "+%30", n: s.reached_30 ?? fromItems("days_to_30") },
  ];
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      {steps.map(st => {
        const n = st.n == null ? null : Number(st.n);
        const pct = n == null ? 0 : Math.round((n / total) * 100);
        return (
          <div key={st.label} style={{ flex: "1 1 90px", minWidth: 80 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 3 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{st.label}</span>
              <span style={{ fontFamily: "var(--font-m)", color: "var(--text-2)" }}>{n == null ? "—" : `${n}/${total}`}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
            </div>
          </div>
        );
      })}
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

function Card({ title, action, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>{title}</span>
        {action}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th style={{
      padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 600,
      color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase",
      borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
    }}>{children}</th>
  );
}
function Td({ children, style = {} }) {
  return <td style={{ padding: "8px 12px", fontSize: 12, fontFamily: "var(--font-m)", ...style }}>{children}</td>;
}

// CSV oluşturup indirir — kütüphane gerekmiyor
function downloadCsv(filename, rows, columns) {
  const header = columns.map(c => c.label).join(",");
  const lines = rows.map(row =>
    columns.map(c => {
      const val = row[c.key] ?? "";
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(",")
  );
  const csv = [header, ...lines].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 1. PORTFÖY PERFORMANS RAPORU ────────────────────────────
function PortfolioPerformanceSection({ portfolioId }) {
  const { data: positions, loading } = useApi(
    () => portfolioId ? portApi.positions(portfolioId) : Promise.resolve([]),
    [portfolioId]
  );

  const totalValue = positions?.reduce((s, p) => s + Number(p.current_price || 0) * Number(p.quantity), 0) || 0;
  const totalCost  = positions?.reduce((s, p) => s + Number(p.avg_cost) * Number(p.quantity), 0) || 0;
  const totalPnl   = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <Card title="Portföy Performans Raporu">
      {loading ? <Spinner /> : !positions?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>Açık pozisyon yok.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Toplam Değer</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 20 }}>₺{fmt(totalValue)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Toplam Maliyet</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 20 }}>₺{fmt(totalCost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Toplam Getiri</div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 20, color: totalPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                {totalPnl >= 0 ? "+" : ""}₺{fmt(totalPnl)} ({totalPct >= 0 ? "+" : ""}{fmt(totalPct)}%)
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><Th>Hisse</Th><Th>Adet</Th><Th>Maliyet</Th><Th>Güncel</Th><Th>K/Z</Th><Th>K/Z %</Th></tr></thead>
              <tbody>
                {positions.map(p => {
                  const val = Number(p.current_price || 0) * Number(p.quantity);
                  const cost = Number(p.avg_cost) * Number(p.quantity);
                  const pnl = val - cost;
                  const pct = cost > 0 ? (pnl / cost) * 100 : 0;
                  return (
                    <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{p.symbol}</Td>
                      <Td>{fmt(p.quantity, 0)}</Td>
                      <Td>₺{fmt(p.avg_cost)}</Td>
                      <Td>₺{fmt(p.current_price)}</Td>
                      <Td style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>{pnl >= 0 ? "+" : ""}₺{fmt(pnl)}</Td>
                      <Td style={{ color: pct >= 0 ? "var(--green)" : "var(--red)" }}>{pct >= 0 ? "+" : ""}{fmt(pct)}%</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── 2. İŞLEM GEÇMİŞİ (CSV) ──────────────────────────────────
function TransactionHistorySection({ portfolioId }) {
  const { data: txs, loading } = useApi(
    () => portfolioId ? portApi.transactions(portfolioId) : Promise.resolve([]),
    [portfolioId]
  );

  function handleExport() {
    downloadCsv("islem_gecmisi.csv", txs || [], [
      { key: "executed_at", label: "Tarih" },
      { key: "type",        label: "Tür" },
      { key: "symbol",      label: "Hisse" },
      { key: "quantity",    label: "Adet" },
      { key: "price",       label: "Fiyat" },
      { key: "commission",  label: "Komisyon" },
      { key: "total_amount",label: "Toplam" },
      { key: "realized_pnl",label: "Gerçekleşen K/Z" },
      { key: "notes",       label: "Not" },
    ]);
  }

  return (
    <Card title="İşlem Geçmişi" action={
      <button onClick={handleExport} disabled={!txs?.length} style={{
        padding: "6px 14px", borderRadius: 7, border: "1px solid var(--border)",
        background: "var(--bg)", color: "var(--text-2)", fontSize: 12, fontWeight: 600,
        cursor: txs?.length ? "pointer" : "not-allowed",
      }}>⬇ CSV İndir</button>
    }>
      {loading ? <Spinner /> : !txs?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>İşlem geçmişi boş.</div>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><Th>Tarih</Th><Th>Tür</Th><Th>Hisse</Th><Th>Adet</Th><Th>Fiyat</Th><Th>Toplam</Th></tr></thead>
            <tbody>
              {txs.map(tx => (
                <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <Td>{fmtDate(tx.executed_at)}</Td>
                  <Td style={{ color: tx.type === "buy" ? "var(--green)" : "var(--red)" }}>{tx.type === "buy" ? "ALIM" : "SATIM"}</Td>
                  <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{tx.symbol}</Td>
                  <Td>{fmt(tx.quantity, 0)}</Td>
                  <Td>₺{fmt(tx.price)}</Td>
                  <Td>₺{fmt(tx.total_amount)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── 3. NAKİT AKIŞI RAPORU ───────────────────────────────────
function CashFlowSection({ portfolioId }) {
  const { data: cashTxs, loading } = useApi(
    () => portfolioId ? portApi.cashTransactions(portfolioId) : Promise.resolve([]),
    [portfolioId]
  );

  // Kronolojik sırayla (eskiden yeniye) birikimli bakiye hesapla
  const chronological = [...(cashTxs || [])].reverse();
  let running = 0;
  const chartData = chronological.map(tx => {
    running += tx.type === "deposit" ? Number(tx.amount) : -Number(tx.amount);
    return { date: tx.executed_at, balance: running };
  });

  return (
    <Card title="Nakit Akışı Raporu">
      {loading ? <Spinner /> : !cashTxs?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>Henüz nakit işlemi yok.</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--text-3)" }} tickLine={false} axisLine={false} tickFormatter={v => `₺${fmt(v,0)}`} />
              <Tooltip formatter={(v) => `₺${fmt(v)}`} labelFormatter={fmtDate} />
              <Line type="monotone" dataKey="balance" stroke="var(--accent)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><Th>Tarih</Th><Th>Tür</Th><Th>Tutar</Th><Th>Not</Th></tr></thead>
              <tbody>
                {cashTxs.map(tx => (
                  <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <Td>{fmtDate(tx.executed_at)}</Td>
                    <Td style={{ color: tx.type === "deposit" ? "var(--green)" : "var(--red)" }}>{tx.type === "deposit" ? "YATIRMA" : "ÇEKME"}</Td>
                    <Td>₺{fmt(tx.amount)}</Td>
                    <Td style={{ fontFamily: "var(--font)" }}>{tx.notes || "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

// ── 4. FİLTRE PERFORMANS RAPORU ─────────────────────────────
function FilterPerformanceSection() {
  const { data: stats, loading } = useApi(() => signalsApi.performance(), []);
  const [expanded, setExpanded] = useState(null); // hangi filtre kartı açık

  return (
    <Card title="Filtre Performans Raporu (İsabet Oranı)">
      {loading ? <Spinner /> : !stats?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>Henüz yeterli veri yok.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.map(s => {
            const isOpen = expanded === s.filter_code;
            return (
              <div key={s.filter_code} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div onClick={() => setExpanded(isOpen ? null : s.filter_code)} style={{ padding: 14, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {isOpen ? "▾" : "▸"} {FILTER_LABELS[s.filter_code] || FILTER_LABELS[s.filter_code.toLowerCase()] || s.filter_code}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: s.win_rate >= 50 ? "var(--green-bg)" : "var(--red-bg)",
                      color: s.win_rate >= 50 ? "var(--green)" : "var(--red)",
                    }}>%{s.win_rate} kazanma oranı</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10 }}>{FILTER_DEFINITIONS[s.filter_code]}</div>
                  <WinRateBar rate={s.win_rate} />
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12 }}>
                    <div><span style={{ color: "var(--text-3)" }}>Toplam örnek: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.total}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>Ort. getiri: </span><b style={{ fontFamily: "var(--font-m)", color: s.avg_change_pct >= 0 ? "var(--green)" : "var(--red)" }}>{s.avg_change_pct >= 0 ? "+" : ""}{fmt(s.avg_change_pct)}%</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%5'e ort. gün: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.avg_days_to_5 != null ? fmt(s.avg_days_to_5, 1) : "—"}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%10'a ort. gün: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.avg_days_to_10 != null ? fmt(s.avg_days_to_10, 1) : "—"}</b></div>
                  </div>
                  <MilestoneFunnel s={s} />
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "10px 14px", overflowX: "auto" }}>
                    {!s.items?.length ? (
                      <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>Hisse detayı bulunamadı.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <Th>Hisse</Th><Th>Giriş Tarihi</Th><Th>Güncel Değişim</Th>
                            <Th>%5'e gün</Th><Th>%10'a gün</Th><Th>%20'ye gün</Th><Th>%30'a gün</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...s.items].sort(byEntryDateDesc).map((it, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{it.symbol}{isNewEntry(it.entry_date) && <NewBadge />}</Td>
                              <Td>{fmtDate(it.entry_date)}</Td>
                              <Td style={{ color: Number(it.change_pct) >= 0 ? "var(--green)" : "var(--red)" }}>
                                {Number(it.change_pct) >= 0 ? "+" : ""}{fmt(it.change_pct)}%
                              </Td>
                              <Td>{it.days_to_5  ?? "—"}</Td>
                              <Td>{it.days_to_10 ?? "—"}</Td>
                              <Td>{it.days_to_20 ?? "—"}</Td>
                              <Td>{it.days_to_30 ?? "—"}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 4b. EK FİLTRELER — ANLIK YAKALANANLAR (Filtre 5 & 6) ────
// extra_filter_results tablosu timeframe'i küçük harfle tutuyor (4h, 1d, 1wk, 2h, 30m),
// filterDefinitions.js ise "IFT5_EMA_MACD_4H" gibi birleşik-büyük-harf key kullanıyor —
// bu yüzden ikisini birleştirip doğru key'i burada kuruyoruz.
const EXTRA_TF_SUFFIX = { "4h": "4H", "1d": "1D", "1wk": "1WK", "2h": "2H", "30m": "30M" };

function ExtraFilterTrackingSection() {
  const { data: groups, loading } = useApi(() => signalsApi.extraTracked(), []);
  const [expanded, setExpanded] = useState(null); // hangi kart açık

  return (
    <Card title="Ek Filtreler — Anlık Yakalananlar (Filtre 5 & 6)">
      {loading ? <Spinner /> : !groups?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>
          Şu an hiçbir hissede ek filtre tetiklenmiş değil.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groups.map(g => {
            const groupKey = `${g.filter_code}|${g.timeframe}`;
            const combinedCode = `${g.filter_code}_${EXTRA_TF_SUFFIX[g.timeframe] || g.timeframe.toUpperCase()}`;
            const isOpen = expanded === groupKey;
            return (
              <div key={groupKey} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div onClick={() => setExpanded(isOpen ? null : groupKey)} style={{ padding: 14, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {isOpen ? "▾" : "▸"} {FILTER_LABELS[combinedCode] || combinedCode}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: "var(--green-bg)", color: "var(--green)",
                    }}>{g.stocks.length} hisse</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>{FILTER_DEFINITIONS[combinedCode] || ""}</div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "10px 14px", overflowX: "auto" }}>
                    {!g.stocks?.length ? (
                      <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>Hisse bulunamadı.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <Th>Hisse</Th><Th>Giriş Tarihi</Th><Th>Güncel Değişim</Th>
                            <Th>%5'e gün</Th><Th>%10'a gün</Th><Th>%20'ye gün</Th><Th>%30'a gün</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...g.stocks].sort(byEntryDateDesc).map((s, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{s.symbol}{isNewEntry(s.entry_date) && <NewBadge />}</Td>
                              <Td>{s.entry_date ? fmtDate(s.entry_date) : "—"}</Td>
                              <Td style={{ color: s.change_pct == null ? "var(--text-3)" : Number(s.change_pct) >= 0 ? "var(--green)" : "var(--red)" }}>
                                {s.change_pct == null ? "—" : `${Number(s.change_pct) >= 0 ? "+" : ""}${fmt(s.change_pct)}%`}
                              </Td>
                              <Td>{s.days_to_5  ?? "—"}</Td>
                              <Td>{s.days_to_10 ?? "—"}</Td>
                              <Td>{s.days_to_20 ?? "—"}</Td>
                              <Td>{s.days_to_30 ?? "—"}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── 5. VERGİ / GERÇEKLEŞEN K/Z ÖZETİ ────────────────────────
function TaxSummarySection() {
  const { data: summary, loading } = useApi(() => reportsApi.taxSummary(), []);

  return (
    <Card title="Vergi / Gerçekleşen K/Z Özeti" action={
      <span style={{ fontSize: 11, color: "var(--text-3)" }}>Yıl bazında satış işlemleri</span>
    }>
      {loading ? <Spinner /> : !summary?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>Henüz satış işlemi yok.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Yıl</Th><Th>Satış Sayısı</Th><Th>Toplam Gerçekleşen K/Z</Th></tr></thead>
          <tbody>
            {summary.map(row => (
              <tr key={row.year} style={{ borderBottom: "1px solid var(--border)" }}>
                <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{row.year}</Td>
                <Td>{row.sell_count}</Td>
                <Td style={{ color: Number(row.total_realized_pnl) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                  {Number(row.total_realized_pnl) >= 0 ? "+" : ""}₺{fmt(row.total_realized_pnl)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── 6. AI YORUM GEÇMİŞİ ─────────────────────────────────────
// ── 5b. AI TAVSİYE PERFORMANSI (İsabet Oranı) ───────────────
function AiPerformanceSection() {
  const { data: stats, loading } = useApi(() => aiApi.performance(), []);
  const [expanded, setExpanded] = useState(null);

  return (
    <Card title="AI Tavsiye Performansı (İsabet Oranı)">
      {loading ? <Spinner /> : !stats?.some(s => s.total > 0) ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>
          Henüz ölçülebilir veri yok — AI yorumu istedikçe (ve zaman geçtikçe) burada dolacak.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {stats.filter(s => s.total > 0).map(s => {
            const isOpen = expanded === s.tavsiye;
            const badgeColor = s.win_rate == null ? null : s.win_rate >= 50;
            return (
              <div key={s.tavsiye} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div onClick={() => setExpanded(isOpen ? null : s.tavsiye)} style={{ padding: 14, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{isOpen ? "▾" : "▸"} {s.tavsiye}</span>
                    {s.win_rate != null ? (
                      <span style={{
                        fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                        background: badgeColor ? "var(--green-bg)" : "var(--red-bg)",
                        color: badgeColor ? "var(--green)" : "var(--red)",
                      }}>%{s.win_rate} isabet</span>
                    ) : (
                      <span style={{
                        fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                        background: "var(--bg)", color: "var(--text-3)", border: "1px solid var(--border)",
                      }}>isabet ölçülmez</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10 }}>
                    {s.tavsiye === "AL" && "Tavsiyeden bu yana fiyat yükseldiyse isabetli sayılır."}
                    {s.tavsiye === "SAT" && "Tavsiyeden bu yana fiyat düştüyse isabetli sayılır."}
                    {s.tavsiye === "BEKLE" && "BEKLE için net bir doğru/yanlış tanımı yok, sadece ortalama değişim gösterilir."}
                  </div>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12 }}>
                    <div><span style={{ color: "var(--text-3)" }}>Toplam örnek: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.total}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>Ort. değişim: </span><b style={{ fontFamily: "var(--font-m)", color: s.avg_change_pct >= 0 ? "var(--green)" : "var(--red)" }}>{s.avg_change_pct >= 0 ? "+" : ""}{fmt(s.avg_change_pct)}%</b></div>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: "10px 14px", overflowX: "auto" }}>
                    {!s.items?.length ? (
                      <div style={{ fontSize: 12, color: "var(--text-3)", padding: "8px 0" }}>Hisse detayı bulunamadı.</div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr><Th>Hisse</Th><Th>Tavsiye Tarihi</Th><Th>Tavsiye Fiyatı</Th><Th>Güncel Fiyat</Th><Th>Değişim</Th></tr>
                        </thead>
                        <tbody>
                          {s.items.map((it, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{it.symbol}</Td>
                              <Td>{fmtDate(it.created_at)}</Td>
                              <Td>₺{fmt(it.entry_price)}</Td>
                              <Td>₺{fmt(it.current_price)}</Td>
                              <Td style={{ color: it.change_pct >= 0 ? "var(--green)" : "var(--red)" }}>
                                {it.change_pct >= 0 ? "+" : ""}{fmt(it.change_pct)}%
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function AiCommentaryHistorySection() {
  const { data: history, loading } = useApi(() => aiApi.allCommentary(), []);
  const [expanded, setExpanded] = useState(null);

  return (
    <Card title="AI Yorum Geçmişi">
      {loading ? <Spinner /> : !history?.length ? (
        <div style={{ textAlign: "center", padding: 20, fontSize: 13, color: "var(--text-3)" }}>
          Henüz AI yorumu alınmamış. Hisse Tarayıcı'da bir hisseye tıklayıp "AI ile Yorumla" ile başlayabilirsin.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.map(item => {
            let parsed = null;
            try { parsed = JSON.parse(item.response); } catch { /* eski format olabilir */ }
            const isOpen = expanded === item.id;

            return (
              <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div onClick={() => setExpanded(isOpen ? null : item.id)} style={{
                  padding: "10px 14px", cursor: "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13 }}>{isOpen ? "▾" : "▸"}</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{item.symbol}</span>
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>{item.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {parsed?.tavsiye && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                        background: parsed.tavsiye === "AL" ? "var(--green-bg)" : parsed.tavsiye === "SAT" ? "var(--red-bg)" : "var(--bg)",
                        color: parsed.tavsiye === "AL" ? "var(--green)" : parsed.tavsiye === "SAT" ? "var(--red)" : "var(--text-2)",
                      }}>{parsed.tavsiye}</span>
                    )}
                    <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>{fmtDate(item.created_at)}</span>
                  </div>
                </div>

                {isOpen && parsed && (
                  <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      { label: "Finansal Sağlık", text: parsed.finansal_saglik },
                      { label: "Teknik-Temel Uyumu", text: parsed.teknik_temel_uyumu },
                      { label: "KAP Haberlerinin Etkisi", text: parsed.kap_etkisi },
                    ].map((s, i) => s.text && (
                      <div key={i}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>{s.label}</div>
                        <div style={{ fontSize: 12, color: "var(--text-1)", lineHeight: 1.5 }}>{s.text}</div>
                      </div>
                    ))}
                    {parsed.riskler?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--red)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>Riskler</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {parsed.riskler.map((r, i) => <li key={i} style={{ fontSize: 12 }}>{r}</li>)}
                        </ul>
                      </div>
                    )}
                    {parsed.firsatlar?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--green)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 3 }}>Fırsatlar</div>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {parsed.firsatlar.map((f, i) => <li key={i} style={{ fontSize: 12 }}>{f}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
// Yapışkan bölüm navigasyonu — 8 kartlık uzun sayfada kaybolmadan gezinmek için.
const SECTIONS = [
  { id: "sec-portfoy",     label: "Portföy" },
  { id: "sec-islemler",    label: "İşlemler" },
  { id: "sec-nakit",       label: "Nakit Akışı" },
  { id: "sec-filtreler",   label: "Filtre Performansı" },
  { id: "sec-ek-filtre",   label: "Ek Filtreler" },
  { id: "sec-vergi",       label: "Vergi / K-Z" },
  { id: "sec-ai-perf",     label: "AI İsabet" },
  { id: "sec-ai-gecmis",   label: "AI Geçmişi" },
];

function SectionNav() {
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 5,
      display: "flex", gap: 6, flexWrap: "wrap", padding: "10px 0",
      background: "var(--bg)", borderBottom: "1px solid var(--border)",
    }}>
      {SECTIONS.map(s => (
        <button key={s.id} onClick={() => scrollTo(s.id)} style={{
          padding: "5px 12px", borderRadius: 20, border: "1px solid var(--border)",
          background: "var(--surface)", color: "var(--text-2)",
          fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
        }}>{s.label}</button>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { data: portList } = useApi(() => portApi.list(), []);
  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionNav />
      <section id="sec-portfoy" style={{ scrollMarginTop: 58 }}><PortfolioPerformanceSection portfolioId={defaultPort?.id} /></section>
      <section id="sec-islemler" style={{ scrollMarginTop: 58 }}><TransactionHistorySection portfolioId={defaultPort?.id} /></section>
      <section id="sec-nakit" style={{ scrollMarginTop: 58 }}><CashFlowSection portfolioId={defaultPort?.id} /></section>
      <section id="sec-filtreler" style={{ scrollMarginTop: 58 }}><FilterPerformanceSection /></section>
      <section id="sec-ek-filtre" style={{ scrollMarginTop: 58 }}><ExtraFilterTrackingSection /></section>
      <section id="sec-vergi" style={{ scrollMarginTop: 58 }}><TaxSummarySection /></section>
      <section id="sec-ai-perf" style={{ scrollMarginTop: 58 }}><AiPerformanceSection /></section>
      <section id="sec-ai-gecmis" style={{ scrollMarginTop: 58 }}><AiCommentaryHistorySection /></section>
    </div>
  );
}
