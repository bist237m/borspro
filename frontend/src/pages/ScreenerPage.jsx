// src/pages/ScreenerPage.jsx
import { useState, useMemo } from "react";
import { useApi } from "../hooks/useApi.js";
import { stocks as stocksApi, jobs as jobsApi, signals as signalsApi, ai as aiApi } from "../api/client.js";
import { FILTER_LABELS, FILTER_DEFINITIONS, parseFilterTypes } from "../constants/filterDefinitions.js";
import { useAuth } from "../context/AuthContext.jsx";

const fmt  = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtB = (n) => {
  if (n == null) return "—";
  const v = Number(n);
  if (v >= 1e9) return `${(v/1e9).toFixed(1)}Mr`;
  if (v >= 1e6) return `${(v/1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${(v/1e3).toFixed(0)}K`;
  return String(v);
};

const PRESETS = [
  { id:"oversold",  label:"🔵 Aşırı Satım",    desc:"RSI < 30",        filters:{ rsi_max:"30" } },
  { id:"overbought",label:"🔴 Aşırı Alım",     desc:"RSI > 70",        filters:{ rsi_min:"70" } },
  { id:"gainers",   label:"📈 Bugün Yükselen", desc:"Değişim > +2%",   filters:{ change_pct_min:"2" } },
  { id:"losers",    label:"📉 Bugün Düşen",    desc:"Değişim < -2%",   filters:{ change_pct_max:"-2" } },
  { id:"highvol",   label:"🔊 Yüksek Hacim",  desc:"Hacim > 10M",     filters:{ volume_min:"10000000" } },
  { id:"lowprice",  label:"💰 Düşük Fiyat",   desc:"Fiyat < 50₺",     filters:{ price_max:"50" } },
];

// NOT: "sector" seçenekleri artık sabit/tahmini bir liste değil — gerçek
// verideki (allStocks) benzersiz sektör değerlerinden dinamik kuruluyor.
// Eskiden buradaki ["Finans","Sanayi","Otomotiv",...] listesi KAP/İş Yatırım'ın
// gerçekte döndürdüğü değerlerle (İMALAT, MALİ KURULUŞLAR vb.) hiç uyuşmuyordu.
function buildFilters(sectorOptions) {
  return [
    { group:"Fiyat", items:[
      { id:"price_min",      label:"Min Fiyat (₺)",   type:"number", placeholder:"0"    },
      { id:"price_max",      label:"Max Fiyat (₺)",   type:"number", placeholder:"∞"    },
      { id:"change_pct_min", label:"Min Değişim (%)",  type:"number", placeholder:"-100" },
      { id:"change_pct_max", label:"Max Değişim (%)",  type:"number", placeholder:"100"  },
    ]},
    { group:"Hacim", items:[
      { id:"volume_min", label:"Min Hacim", type:"number", placeholder:"0" },
      { id:"volume_max", label:"Max Hacim", type:"number", placeholder:"∞" },
    ]},
    { group:"Borsa & Sektör", items:[
      { id:"exchange", label:"Borsa",  type:"select", options:["","BIST","NASDAQ","NYSE"] },
      { id:"sector",   label:"Sektör", type:"select", options:["", ...sectorOptions] },
    ]},
  ];
}

const COLS = [
  { id:"symbol",     label:"Hisse",      sortable:true  },
  { id:"exchange",   label:"Borsa",      sortable:false },
  { id:"sector",     label:"Sektör",     sortable:true  },
  { id:"price",      label:"Fiyat",      sortable:true  },
  { id:"change_pct", label:"Değişim %",  sortable:true  },
  { id:"change_abs", label:"Değişim ₺",  sortable:true  },
  { id:"day_high",   label:"Gün Y.",     sortable:true  },
  { id:"day_low",    label:"Gün D.",     sortable:true  },
  { id:"volume",     label:"Hacim",      sortable:true  },
  { id:"market_cap", label:"Piy. Değ.",  sortable:true  },
];

// ── BİLANÇO SATIRLARI ────────────────────────────────────────
// ai.js'teki formatBalanceSheet ile aynı mantık: kalem adlarını tahmin
// etmiyoruz, ham JSON'daki "TOPLAM"/"ÖZKAYNAK" geçen üst-kalemleri öne
// çıkarıp (ilk 12 tanesi) önceki döneme göre değişimiyle listeliyoruz.
function BalanceSheetRows({ bs }) {
  const { data, prev_data } = bs;
  const priorityKeys = Object.keys(data).filter(k => /toplam|özkaynak/i.test(k));
  const otherKeys = Object.keys(data).filter(k => !priorityKeys.includes(k));
  const orderedKeys = [...priorityKeys, ...otherKeys].slice(0, 12);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {orderedKeys.map(k => {
        const cur = data[k];
        const prev = prev_data ? prev_data[k] : null;
        const changePct = (prev != null && cur != null && prev !== 0) ? ((cur - prev) / Math.abs(prev)) * 100 : null;
        return (
          <div key={k} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
            padding: "7px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600 }}>
                {cur != null ? `₺${Number(cur).toLocaleString("tr-TR")}` : "—"}
              </span>
              {changePct != null && (
                <span style={{
                  fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 700,
                  color: changePct >= 0 ? "var(--green)" : "var(--red)",
                }}>{changePct >= 0 ? "+" : ""}{changePct.toFixed(1)}%</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ height:200, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
      {[0,1,2].map(i => (
        <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:"var(--accent)", animation:`bl 1s ease ${i*.18}s infinite` }}/>
      ))}
      <style>{`@keyframes bl{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

// ── HİSSE DETAY MODALI (teknik + temel + AI yorum) ──────────
function StockDetailModal({ symbol, onClose }) {
  const { user } = useAuth();
  const { data: detail } = useApi(() => stocksApi.get(symbol), [symbol]);
  const { data: filterData, loading: filterLoading } = useApi(() => stocksApi.filters(symbol), [symbol]);
  const { data: fundData, loading: fundLoading } = useApi(() => stocksApi.fundamentals(symbol), [symbol]);
  const { data: newsData, loading: newsLoading } = useApi(() => stocksApi.news(symbol), [symbol]);
  const { data: extraFilters, loading: extraLoading } = useApi(() => stocksApi.extraFilters(symbol), [symbol]);
  const { data: corpActions, loading: corpLoading } = useApi(() => stocksApi.corporateActions(symbol), [symbol]);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult,  setAiResult]  = useState(null);
  const [aiError,   setAiError]   = useState(null);

  async function handleAiComment() {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await aiApi.comment(symbol);
      setAiResult(res.comment);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  const up = detail ? Number(detail.change_pct) >= 0 : true;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--overlay)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: "var(--surface)", borderRadius: 14, width: "100%", maxWidth: 640,
        maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        animation: "popIn 0.22s cubic-bezier(0.34,1.56,0.64,1) both",
      }}>
        <style>{`@keyframes popIn{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}`}</style>

        {/* Başlık */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-d)", fontSize: 18 }}>{symbol}</span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{detail?.name}</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "var(--text-3)", cursor: "pointer" }}>✕</button>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Fiyat özeti */}
          {detail?.price && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-m)", fontSize: 20, fontWeight: 600 }}>₺{fmt(detail.price)}</span>
              <span style={{
                fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600,
                color: up ? "var(--green)" : "var(--red)",
                background: up ? "var(--green-bg)" : "var(--red-bg)",
                padding: "2px 8px", borderRadius: 20,
              }}>{up ? "▲" : "▼"} {fmt(Math.abs(detail.change_pct))}%</span>
            </div>
          )}

          {/* Sektör ve Endeks Rozetleri */}
          {(detail?.sector || detail?.index_codes?.length > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {detail?.sector && (
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                  background: "var(--accent-bg)", color: "var(--accent)",
                }}>{detail.sector}</span>
              )}
              {detail?.index_codes?.map(code => (
                <span key={code} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                  background: "var(--bg)", color: "var(--text-2)", border: "1px solid var(--border)",
                  fontFamily: "var(--font-m)",
                }}>{code}</span>
              ))}
            </div>
          )}

          {/* Filtre durumu */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Filtre Durumu
            </div>
            {filterLoading ? <Spinner /> : !filterData ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Henüz gösterge verisi yok (tarama bekleniyor).</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(FILTER_LABELS).map(([key, label]) => (
                  <div key={key} style={{
                    background: filterData[key] ? "var(--green-bg)" : "var(--bg)",
                    border: `1px solid ${filterData[key] ? "var(--green)" : "var(--border)"}`,
                    borderRadius: 8, padding: "8px 12px",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: filterData[key] ? "var(--green)" : "var(--text-3)", display: "flex", alignItems: "center", gap: 5 }}>
                      {label}
                      <span title={FILTER_DEFINITIONS[key]} style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 14, height: 14, borderRadius: "50%", fontSize: 9, fontWeight: 700,
                        color: "var(--text-3)", border: "1px solid var(--border)", cursor: "help", flexShrink: 0,
                      }}>ⓘ</span>
                    </span>
                    <span style={{ fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 700, color: filterData[key] ? "var(--green)" : "var(--text-3)" }}>
                      {filterData[key] ? "✓" : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ek Filtreler (Filtre 5 ve 6 — farklı zaman dilimleri) */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Ek Filtreler
            </div>
            {extraLoading ? <Spinner /> : !extraFilters?.length ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Henüz ek filtre verisi yok.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {extraFilters.map((f, i) => {
                  const label = f.filter_code === "IFT5_EMA_MACD" ? "IFT5-EMA-MACD" : "EMA120";
                  return (
                    <div key={i} style={{
                      background: f.result ? "var(--green-bg)" : "var(--bg)",
                      border: `1px solid ${f.result ? "var(--green)" : "var(--border)"}`,
                      borderRadius: 8, padding: "8px 12px",
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: f.result ? "var(--green)" : "var(--text-3)" }}>
                        {label} <span style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--text-3)" }}>({f.timeframe})</span>
                      </span>
                      <span style={{ fontFamily: "var(--font-m)", fontSize: 10, fontWeight: 700, color: f.result ? "var(--green)" : "var(--text-3)" }}>
                        {f.result ? "✓" : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Temel veriler */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Temel Veriler
            </div>
            {fundLoading ? <Spinner /> : !fundData ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Bu hisse için temel veri yok.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  { label: "FAVÖK",           val: fundData.favok      != null ? `₺${fmtB(fundData.favok)}` : "—" },
                  { label: "Net Kar",         val: fundData.net_kar    != null ? `₺${fmtB(fundData.net_kar)}` : "—" },
                  { label: "F/K",             val: fmt(fundData.pe_ratio, 2) },
                  { label: "PD/DD",           val: fmt(fundData.pb_ratio, 2) },
                  { label: "FD/FAVÖK",        val: fmt(fundData.ev_ebitda, 2) },
                  { label: "FD/Satış",        val: fmt(fundData.ev_sales, 2) },
                  { label: "PEG Rasyosu",     val: (fundData.pe_ratio != null && fundData.net_income_yoy_growth > 0)
                      ? (fundData.pe_ratio / fundData.net_income_yoy_growth).toFixed(2) : "—" },
                  { label: "Piyasa Değeri",   val: fundData.market_cap != null ? `₺${fmtB(fundData.market_cap)}` : "—" },
                  { label: "52H Yüksek",      val: fundData.year_high  != null ? `₺${fmt(fundData.year_high)}` : "—" },
                  { label: "52H Düşük",       val: fundData.year_low   != null ? `₺${fmt(fundData.year_low)}` : "—" },
                  { label: "ROE",             val: fundData.roe            != null ? `%${fmt(fundData.roe, 1)}` : "—" },
                  { label: "Net Kar Marjı",   val: fundData.net_margin     != null ? `%${fmt(fundData.net_margin, 1)}` : "—" },
                  { label: "FAVÖK Marjı",     val: fundData.ebitda_margin  != null ? `%${fmt(fundData.ebitda_margin, 1)}` : "—" },
                  { label: "Ciro Büyümesi",   val: fundData.revenue_yoy_growth != null ? `%${fmt(fundData.revenue_yoy_growth, 1)}` : "—" },
                  { label: "Halka Açıklık",   val: fundData.free_float     != null ? `%${fmt(fundData.free_float, 1)}` : "—" },
                  { label: "Yabancı Oranı",   val: fundData.foreign_ratio  != null ? `%${fmt(fundData.foreign_ratio, 1)}` : "—" },
                  { label: "Yab. Oranı (1 Hafta Δ)", val: fundData.foreign_ratio_1w_change != null ? `${fmt(fundData.foreign_ratio_1w_change, 2)} baz` : "—" },
                  { label: "Yab. Oranı (1 Ay Δ)",    val: fundData.foreign_ratio_1m_change != null ? `${fmt(fundData.foreign_ratio_1m_change, 2)} baz` : "—" },
                  { label: "Günlük Getiri",   val: fundData.return_1d != null ? `%${fmt(fundData.return_1d, 2)}` : "—" },
                  { label: "Haftalık Getiri", val: fundData.return_1w != null ? `%${fmt(fundData.return_1w, 2)}` : "—" },
                  { label: "Aylık Getiri",    val: fundData.return_1m != null ? `%${fmt(fundData.return_1m, 2)}` : "—" },
                  { label: "Temettü Verimi",  val: fundData.dividend_yield != null ? `%${fmt(fundData.dividend_yield, 2)}` : "—" },
                  { label: "Tarihsel Ort. F/K",      val: fmt(fundData.pe_hist_avg, 2) },
                  { label: "Tarihsel Ort. FD/FAVÖK", val: fmt(fundData.ev_ebitda_hist_avg, 2) },
                ].map((row, i) => (
                  <div key={i} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 2 }}>{row.label}</div>
                    <div style={{ fontFamily: "var(--font-m)", fontSize: 13, fontWeight: 600 }}>{row.val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bilanço (dönemsel) */}
          {fundData?.balance_sheet_json?.data && Object.keys(fundData.balance_sheet_json.data).length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                Bilanço
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                  background: "var(--bg)", color: "var(--text-3)", border: "1px solid var(--border)",
                  textTransform: "none", letterSpacing: 0,
                }}>
                  {fundData.financial_group === "UFRS" ? "Bankacılık formatı" : "Sanayi formatı"} · {fundData.balance_sheet_period}
                </span>
              </div>
              <BalanceSheetRows bs={fundData.balance_sheet_json} />
            </div>
          )}

          {/* Sermaye Artırımı / Temettü Takvimi */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Sermaye Artırımı / Temettü Takvimi
            </div>
            {corpLoading ? <Spinner /> : !corpActions?.length ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Yaklaşan bir sermaye artırımı/temettü kaydı yok.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {corpActions.map((ca, i) => {
                  const items = [
                    ca.bedelli_oran > 0 && { label: "Bedelli", val: `%${fmt(ca.bedelli_oran, 2)}` },
                    ca.bedelsiz_ic_oran > 0 && { label: "Bedelsiz (İç Kaynak)", val: `%${fmt(ca.bedelsiz_ic_oran, 2)}` },
                    ca.bedelsiz_tm_oran > 0 && { label: "Bedelsiz (Temettü)", val: `%${fmt(ca.bedelsiz_tm_oran, 2)}` },
                    ca.nakit_tm_oran > 0 && { label: "Nakit Temettü", val: `%${fmt(ca.nakit_tm_oran, 2)}` },
                    ca.ruchan_oran > 0 && { label: "Rüçhan Hakkı", val: `%${fmt(ca.ruchan_oran, 2)}` },
                  ].filter(Boolean);
                  return (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap",
                      padding: "8px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--border)",
                    }}>
                      <span style={{ fontFamily: "var(--font-m)", fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                        {fmtDate(ca.event_date)}
                      </span>
                      <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {items.length ? items.map((it, j) => (
                          <span key={j} style={{
                            fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                            background: "var(--accent-bg)", color: "var(--accent)",
                          }}>{it.label}: {it.val}</span>
                        )) : (
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>Detay yok</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* KAP Haberleri */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              KAP Haberleri
            </div>
            {newsLoading ? <Spinner /> : !newsData?.length ? (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>Bu hisse için haber bulunamadı.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                {newsData.map(n => (
                  <a key={n.id} href={n.url} target="_blank" rel="noreferrer" style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                    padding: "8px 12px", borderRadius: 8, background: "var(--bg)",
                    border: "1px solid var(--border)", textDecoration: "none",
                  }}>
                    <span style={{ fontSize: 12, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.title}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-m)", flexShrink: 0 }}>
                      {n.published_at ? new Date(n.published_at).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : ""}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {user?.plan !== "pro" ? (
            <div style={{
              padding: "14px", borderRadius: 8, border: "1px dashed var(--border)",
              background: "var(--bg)", textAlign: "center",
            }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔒</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", marginBottom: 4 }}>
                AI Yorum — Pro Özelliği
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                Bu özellik sadece Pro üyeler için kullanılabilir.
              </div>
            </div>
          ) : (
            <>
              <button onClick={handleAiComment} disabled={aiLoading} style={{
                padding: "11px", borderRadius: 8, border: "none",
                background: aiLoading ? "var(--bg)" : "var(--accent)",
                color: aiLoading ? "var(--text-3)" : "#fff",
                fontSize: 13, fontWeight: 600, cursor: aiLoading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {aiLoading ? "AI analiz ediyor..." : "🤖 AI ile Yorumla"}
              </button>

              {aiError && (
                <div style={{ padding: "9px 14px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid var(--red)", fontSize: 12, color: "var(--red)" }}>
                  {aiError}
                </div>
              )}

              {aiResult && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                      background: aiResult.tavsiye === "AL" ? "var(--green-bg)" : aiResult.tavsiye === "SAT" ? "var(--red-bg)" : "var(--bg)",
                      color: aiResult.tavsiye === "AL" ? "var(--green)" : aiResult.tavsiye === "SAT" ? "var(--red)" : "var(--text-2)",
                    }}>{aiResult.tavsiye}</span>
                    <span style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                      background: "var(--bg)", color: "var(--text-2)", border: "1px solid var(--border)",
                    }}>Risk: {aiResult.risk_seviyesi}</span>
                  </div>
                  {[
                    { label: "Finansal Sağlık", text: aiResult.finansal_saglik },
                    { label: "Teknik-Temel Uyumu", text: aiResult.teknik_temel_uyumu },
                    { label: "KAP Haberlerinin Etkisi", text: aiResult.kap_etkisi },
                  ].map((s, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>{s.text}</div>
                    </div>
                  ))}

                  {aiResult.riskler?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--red)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Riskler</div>
                      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                        {aiResult.riskler.map((r, i) => (
                          <li key={i} style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.4 }}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiResult.firsatlar?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>Fırsatlar</div>
                      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                        {aiResult.firsatlar.map((f, i) => (
                          <li key={i} style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.4 }}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div style={{ fontSize: 10, color: "var(--text-3)", fontStyle: "italic" }}>
                    Bu içerik yapay zeka tarafından üretilmiştir, yatırım tavsiyesi değildir.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── EK FİLTRELERE GİREN HİSSELER ────────────────────────────
const EXTRA_FILTER_LABELS = { IFT5_EMA_MACD: "IFT5-EMA-MACD", EMA120: "EMA120" };

function ExtraFilterTable({ onSelectSymbol }) {
  const { data: groups, loading } = useApi(() => signalsApi.extraTracked(), []);

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Ek Filtreye Girenler</span>
      </div>
      {loading ? <Spinner /> : !groups?.length ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>🔍</div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>Henüz ek filtreye giren hisse yok.</div>
        </div>
      ) : (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {groups.map(g => (
            <div key={`${g.filter_code}-${g.timeframe}`} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{EXTRA_FILTER_LABELS[g.filter_code] || g.filter_code}</span>
                <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)", background: "var(--bg)", padding: "2px 8px", borderRadius: 4 }}>{g.timeframe}</span>
                <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--accent)", marginLeft: "auto" }}>{g.stocks.length} hisse</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.stocks.map(s => (
                  <span key={s.symbol} onClick={() => onSelectSymbol(s.symbol)} style={{
                    fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20,
                    background: "var(--accent-bg)", color: "var(--accent)", cursor: "pointer",
                  }}>{s.symbol}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FİLTREYE GİREN HİSSELER TABLOSU ─────────────────────────
function TrackedTable({ list, loading, onSelectSymbol }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Filtreye Giren Hisseler</span>
        <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>{list?.length || 0} hisse</span>
      </div>
      {loading ? <Spinner /> : !list?.length ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.3 }}>🔍</div>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>Henüz filtreye giren hisse yok.</div>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                {["Hisse","Filtre(ler)","Giriş Tarihi","Giriş Fiyatı","Güncel Fiyat","Değişim","Maks. Fiyat"].map((h,i) => (
                  <th key={i} style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 600,
                    color: "var(--text-3)", letterSpacing: "0.06em", textTransform: "uppercase",
                    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(row => {
                const up = Number(row.change_pct) >= 0;
                return (
                  <tr key={row.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    onClick={() => onSelectSymbol(row.symbol)}
                    onMouseEnter={e => e.currentTarget.style.background = "var(--bg)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{row.symbol}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>{row.name}</div>
                    </td>
                    <td style={{ padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {parseFilterTypes(row.filter_types).map(f => (
                        <span key={f.code} title={f.definition} style={{
                          fontSize: 10, fontFamily: "var(--font-m)", color: "var(--accent)",
                          background: "var(--accent-bg)", padding: "2px 6px", borderRadius: 4,
                          cursor: "help", whiteSpace: "nowrap",
                        }}>{f.label} ⓘ</span>
                      ))}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "var(--font-m)", color: "var(--text-2)" }}>
                      {new Date(row.entry_date).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "2-digit" })}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "var(--font-m)" }}>₺{fmt(row.entry_price)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "var(--font-m)", fontWeight: 600 }}>₺{fmt(row.current_price)}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 600,
                        color: up ? "var(--green)" : "var(--red)",
                        background: up ? "var(--green-bg)" : "var(--red-bg)",
                        padding: "2px 8px", borderRadius: 20,
                      }}>{up ? "▲" : "▼"} {fmt(Math.abs(row.change_pct))}%</span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, fontFamily: "var(--font-m)", color: "var(--text-2)" }}>₺{fmt(row.max_price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ScreenerPage() {
  const [filters,      setFilters]    = useState({});
  const [sortBy,       setSortBy]     = useState("symbol");
  const [sortDir,      setSortDir]    = useState("asc");
  const [activePreset, setPreset]     = useState(null);
  const [panelOpen,    setPanelOpen]  = useState(true);
  const [scanStatus,   setScanStatus] = useState(null);
  const [tab,          setTab]        = useState("all");
  const [selectedSymbol, setSelectedSymbol] = useState(null);

  const { data: allStocks, loading } = useApi(() => stocksApi.list(), []);
  const { data: trackedList, loading: trackedLoading, refetch: refetchTracked } = useApi(() => signalsApi.tracked(), []);

  const sectorOptions = useMemo(() => {
    if (!allStocks) return [];
    return [...new Set(allStocks.map(s => s.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));
  }, [allStocks]);
  const FILTERS = useMemo(() => buildFilters(sectorOptions), [sectorOptions]);

  const results = useMemo(() => {
    if (!allStocks) return [];
    return allStocks.filter(s => {
      const price = Number(s.price      || 0);
      const chg   = Number(s.change_pct || 0);
      const vol   = Number(s.volume     || 0);
      if (filters.price_min      && price < Number(filters.price_min))      return false;
      if (filters.price_max      && price > Number(filters.price_max))      return false;
      if (filters.change_pct_min && chg   < Number(filters.change_pct_min)) return false;
      if (filters.change_pct_max && chg   > Number(filters.change_pct_max)) return false;
      if (filters.volume_min     && vol   < Number(filters.volume_min))      return false;
      if (filters.volume_max     && vol   > Number(filters.volume_max))      return false;
      if (filters.exchange && s.exchange !== filters.exchange) return false;
      if (filters.sector   && s.sector   !== filters.sector)   return false;
      return true;
    }).sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }, [allStocks, filters, sortBy, sortDir]);

  function setSort(col) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  }

  async function handleScan() {
    try {
      await jobsApi.scan();
      setScanStatus({ status: "queued" });
      const interval = setInterval(async () => {
        try {
          const s = await jobsApi.status();
          setScanStatus(s);
          if (s.status === "completed") {
            clearInterval(interval);
            refetchTracked();
          }
        } catch {
          clearInterval(interval);
        }
      }, 8000);
    } catch (err) {
      alert("Tarama başlatılamadı: " + err.message);
    }
  }

  const activeFilterCount = Object.values(filters).filter(v => v !== "" && v != null).length;
  const isRunning = scanStatus && ["queued", "in_progress"].includes(scanStatus.status);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--r)", padding:"14px 18px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:"var(--text-3)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:10 }}>Hazır Taramalar</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => { setPreset(p.id); setFilters(p.filters); }} style={{
                  padding:"7px 14px", borderRadius:8,
                  border:`1px solid ${activePreset===p.id?"var(--accent)":"var(--border)"}`,
                  background:activePreset===p.id?"var(--accent-bg)":"var(--bg)",
                  color:activePreset===p.id?"var(--accent)":"var(--text-2)",
                  fontWeight:activePreset===p.id?600:400, fontSize:12, cursor:"pointer",
                  display:"flex", flexDirection:"column", alignItems:"flex-start", gap:1,
                }}>
                  <span>{p.label}</span>
                  <span style={{ fontSize:10, color:activePreset===p.id?"var(--accent)":"var(--text-3)", fontFamily:"var(--font-m)" }}>{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
            <button onClick={handleScan}
              disabled={isRunning}
              style={{
                padding:"9px 18px", borderRadius:8, border:"none",
                background: isRunning ? "var(--bg)" : "var(--accent)",
                color: isRunning ? "var(--text-3)" : "#fff",
                fontWeight:600, fontSize:13, cursor: isRunning ? "not-allowed" : "pointer",
                display:"flex", alignItems:"center", gap:7,
              }}>
              {isRunning ? "⏳ Taranıyor (GitHub Actions)..." : "⚡ Şimdi Tara"}
            </button>
            {scanStatus && (
              <div style={{ fontSize:11, fontFamily:"var(--font-m)", color: scanStatus.status==="completed" ? "var(--green)" : "var(--text-3)" }}>
                {scanStatus.status === "completed" ? "✅ Tarama tamamlandı" :
                 scanStatus.status === "in_progress" ? "⏳ Çalışıyor..." :
                 scanStatus.status === "queued"    ? "⏳ Sıraya eklendi..." : ""}
                {scanStatus.url && (
                  <a href={scanStatus.url} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "var(--accent)" }}>Detay →</a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {[
          { id: "all",     label: "Tüm Hisseler" },
          { id: "tracked", label: "Filtreye Girenler" },
          { id: "extra",   label: "Ek Filtreye Girenler" },
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

      {tab === "tracked" ? (
        <TrackedTable list={trackedList} loading={trackedLoading} onSelectSymbol={setSelectedSymbol} />
      ) : tab === "extra" ? (
        <ExtraFilterTable onSelectSymbol={setSelectedSymbol} />
      ) : (
      <div style={{ display:"grid", gridTemplateColumns:panelOpen?"240px 1fr":"0 1fr", gap:panelOpen?16:0 }}>

        {panelOpen && (
          <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--r)", overflow:"hidden", alignSelf:"start", position:"sticky", top:0 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:"var(--font-d)", fontSize:14 }}>Filtreler</span>
              {activeFilterCount > 0 && (
                <button onClick={() => { setFilters({}); setPreset(null); }} style={{ background:"none", border:"none", fontSize:11, color:"var(--red)", cursor:"pointer", fontWeight:600 }}>
                  Temizle ({activeFilterCount})
                </button>
              )}
            </div>
            <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:18 }}>
              {FILTERS.map(group => (
                <div key={group.group}>
                  <div style={{ fontSize:10, fontWeight:700, color:"var(--text-3)", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>{group.group}</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {group.items.map(item => (
                      <div key={item.id}>
                        <label style={{ fontSize:11, color:"var(--text-2)", display:"block", marginBottom:4 }}>{item.label}</label>
                        {item.type === "select" ? (
                          <select value={filters[item.id]||""} onChange={e => setFilters(f => ({...f,[item.id]:e.target.value}))}
                            style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg)", fontSize:12, fontFamily:"var(--font)", outline:"none" }}>
                            {item.options.map(o => <option key={o} value={o}>{o||"Tümü"}</option>)}
                          </select>
                        ) : (
                          <input type="number" value={filters[item.id]||""} placeholder={item.placeholder}
                            onChange={e => setFilters(f => ({...f,[item.id]:e.target.value}))}
                            style={{ width:"100%", padding:"7px 10px", borderRadius:7, border:"1px solid var(--border)", background:"var(--bg)", fontSize:12, fontFamily:"var(--font-m)", outline:"none" }}
                            onFocus={e => e.target.style.borderColor="var(--accent)"}
                            onBlur={e  => e.target.style.borderColor="var(--border)"}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--r)", overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={() => setPanelOpen(v => !v)} style={{ background:"var(--bg)", border:"1px solid var(--border)", borderRadius:7, padding:"5px 10px", fontSize:12, color:"var(--text-2)", cursor:"pointer" }}>
                {panelOpen?"◀ Gizle":"▶ Filtreler"}
                {!panelOpen && activeFilterCount > 0 && (
                  <span style={{ marginLeft:6, background:"var(--accent)", color:"#fff", borderRadius:"50%", width:16, height:16, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700 }}>{activeFilterCount}</span>
                )}
              </button>
              <span style={{ fontFamily:"var(--font-d)", fontSize:14 }}>Sonuçlar</span>
              <span style={{ fontFamily:"var(--font-m)", fontSize:11, background:"var(--accent-bg)", color:"var(--accent)", padding:"2px 8px", borderRadius:20, fontWeight:600 }}>
                {results.length} hisse
              </span>
            </div>
            <span style={{ fontSize:11, color:"var(--text-3)", fontFamily:"var(--font-m)" }}>{sortBy} {sortDir==="asc"?"▲":"▼"}</span>
          </div>

          {loading ? <Spinner /> : results.length === 0 ? (
            <div style={{ padding:48, textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:12, opacity:.3 }}>🔍</div>
              <div style={{ fontFamily:"var(--font-d)", fontSize:15, color:"var(--text-2)", marginBottom:6 }}>Kriterlere uyan hisse bulunamadı</div>
              <div style={{ fontSize:13, color:"var(--text-3)" }}>Filtreleri gevşetin veya farklı bir kombinasyon deneyin.</div>
            </div>
          ) : (
            <>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ background:"var(--bg)" }}>
                      {COLS.map(col => (
                        <th key={col.id} onClick={() => col.sortable && setSort(col.id)} style={{
                          padding:"9px 14px", textAlign:"left", fontSize:10, fontWeight:600,
                          color:sortBy===col.id?"var(--accent)":"var(--text-3)",
                          letterSpacing:"0.07em", textTransform:"uppercase",
                          borderBottom:"1px solid var(--border)", whiteSpace:"nowrap",
                          cursor:col.sortable?"pointer":"default", userSelect:"none",
                        }}>
                          {col.label}{col.sortable && sortBy===col.id && (sortDir==="asc"?" ▲":" ▼")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(s => {
                      const up  = Number(s.change_pct||0) >= 0;
                      const pct = Number(s.change_pct||0);
                      return (
                        <tr key={s.id} style={{ borderBottom:"1px solid var(--border)", cursor:"pointer" }}
                          onClick={() => setSelectedSymbol(s.symbol)}
                          onMouseEnter={e => e.currentTarget.style.background="var(--bg)"}
                          onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                          <td style={{ padding:"11px 14px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                              <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:up?"var(--green-bg)":"var(--red-bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--font-m)", fontSize:9, fontWeight:700, color:up?"var(--green)":"var(--red)" }}>
                                {s.symbol?.slice(0,4)}
                              </div>
                              <div>
                                <div style={{ fontWeight:600, fontSize:13 }}>{s.symbol}</div>
                                <div style={{ fontSize:10, color:"var(--text-3)", marginTop:1, maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:"11px 14px" }}>
                            <span style={{ fontFamily:"var(--font-m)", fontSize:10, fontWeight:600, background:"var(--accent-bg)", color:"var(--accent)", padding:"2px 6px", borderRadius:4 }}>{s.exchange}</span>
                          </td>
                          <td style={{ padding:"11px 14px", fontSize:12, color:"var(--text-2)" }}>{s.sector||"—"}</td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:13, fontWeight:600 }}>{s.price?`₺${fmt(s.price)}`:"—"}</td>
                          <td style={{ padding:"11px 14px" }}>
                            {s.change_pct!=null?(
                              <span style={{ fontFamily:"var(--font-m)", fontSize:12, fontWeight:600, color:up?"var(--green)":"var(--red)", background:up?"var(--green-bg)":"var(--red-bg)", padding:"2px 8px", borderRadius:20 }}>
                                {up?"▲":"▼"} {fmt(Math.abs(pct))}%
                              </span>
                            ):"—"}
                          </td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:12, color:up?"var(--green)":"var(--red)" }}>{s.change_abs!=null?`${up?"+":""}₺${fmt(s.change_abs)}`:"—"}</td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:12, color:"var(--green)" }}>{s.day_high?`₺${fmt(s.day_high)}`:"—"}</td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:12, color:"var(--red)" }}>{s.day_low?`₺${fmt(s.day_low)}`:"—"}</td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:12, color:"var(--text-2)" }}>{s.volume?fmtB(s.volume):"—"}</td>
                          <td style={{ padding:"11px 14px", fontFamily:"var(--font-m)", fontSize:12, color:"var(--text-2)" }}>{s.market_cap?`₺${fmtB(s.market_cap)}`:"—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ padding:"10px 16px", borderTop:"1px solid var(--border)", display:"flex", gap:20, flexWrap:"wrap" }}>
                {[
                  { label:"Yükselen",  val:results.filter(s=>Number(s.change_pct)>0).length,   color:"var(--green)"  },
                  { label:"Düşen",     val:results.filter(s=>Number(s.change_pct)<0).length,   color:"var(--red)"    },
                  { label:"Değişmez",  val:results.filter(s=>Number(s.change_pct)===0).length, color:"var(--text-3)" },
                  { label:"Ort. Değ.", val:`${fmt(results.reduce((s,r)=>s+Number(r.change_pct||0),0)/results.length)}%`, color:"var(--accent)" },
                ].map((s,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <span style={{ fontSize:11, color:"var(--text-3)" }}>{s.label}:</span>
                    <span style={{ fontFamily:"var(--font-m)", fontSize:11, fontWeight:700, color:s.color }}>{s.val}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {selectedSymbol && (
        <StockDetailModal symbol={selectedSymbol} onClose={() => setSelectedSymbol(null)} />
      )}
    </div>
  );
}
