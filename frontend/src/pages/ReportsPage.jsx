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
                      {isOpen ? "▾" : "▸"} {FILTER_LABELS[s.filter_code.toLowerCase()] || s.filter_code}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                      background: s.win_rate >= 50 ? "var(--green-bg)" : "var(--red-bg)",
                      color: s.win_rate >= 50 ? "var(--green)" : "var(--red)",
                    }}>%{s.win_rate} kazanma oranı</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10 }}>{FILTER_DEFINITIONS[s.filter_code]}</div>
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12 }}>
                    <div><span style={{ color: "var(--text-3)" }}>Toplam örnek: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.total}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>Ort. getiri: </span><b style={{ fontFamily: "var(--font-m)", color: s.avg_change_pct >= 0 ? "var(--green)" : "var(--red)" }}>{s.avg_change_pct >= 0 ? "+" : ""}{fmt(s.avg_change_pct)}%</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%5'e ort. gün: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.avg_days_to_5 != null ? fmt(s.avg_days_to_5, 1) : "—"}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%10'a ort. gün: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.avg_days_to_10 != null ? fmt(s.avg_days_to_10, 1) : "—"}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%20'ye ulaşan: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.reached_20}/{s.total}</b></div>
                    <div><span style={{ color: "var(--text-3)" }}>%30'a ulaşan: </span><b style={{ fontFamily: "var(--font-m)" }}>{s.reached_30}/{s.total}</b></div>
                  </div>
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
                          {s.items.map((it, i) => (
                            <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                              <Td style={{ fontFamily: "var(--font)", fontWeight: 600 }}>{it.symbol}</Td>
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
export default function ReportsPage() {
  const { data: portList } = useApi(() => portApi.list(), []);
  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PortfolioPerformanceSection portfolioId={defaultPort?.id} />
      <TransactionHistorySection portfolioId={defaultPort?.id} />
      <CashFlowSection portfolioId={defaultPort?.id} />
      <FilterPerformanceSection />
      <TaxSummarySection />
      <AiCommentaryHistorySection />
    </div>
  );
}
