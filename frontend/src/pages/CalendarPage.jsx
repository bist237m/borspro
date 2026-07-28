// src/pages/CalendarPage.jsx
// Şirket Takvimi — piyasa genelindeki sermaye artırımı / temettü olayları,
// güne göre gruplu. Veri worker'ın --corporate-actions taramasından gelir.

import { useMemo, useState } from "react";
import { useApi } from "../hooks/useApi.js";
import { calendar as calendarApi } from "../api/client.js";

const fmt = (n, d = 2) => n == null ? "—" : Number(n).toLocaleString("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });

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

// Olay türü rozetleri — bedelli (sulanma) kırmızı ailede, para dağıtanlar yeşilde.
function eventBadges(ev) {
  const out = [];
  if (Number(ev.bedelli_oran) > 0)     out.push({ text: `Bedelli %${fmt(ev.bedelli_oran)}`,          tone: "red" });
  if (Number(ev.ruchan_oran) > 0)      out.push({ text: `Rüçhan %${fmt(ev.ruchan_oran)}`,            tone: "red" });
  if (Number(ev.bedelsiz_ic_oran) > 0) out.push({ text: `Bedelsiz (İK) %${fmt(ev.bedelsiz_ic_oran)}`, tone: "green" });
  if (Number(ev.bedelsiz_tm_oran) > 0) out.push({ text: `Bedelsiz (T) %${fmt(ev.bedelsiz_tm_oran)}`,  tone: "green" });
  if (Number(ev.nakit_tm_oran) > 0)    out.push({ text: `Nakit Temettü %${fmt(ev.nakit_tm_oran)}`,    tone: "green" });
  return out;
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const dayLabel = (key) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const date = new Date(key + "T00:00:00");
  const diff = Math.round((date - today) / 86400000);
  const base = date.toLocaleDateString("tr-TR", { weekday: "long", day: "2-digit", month: "long" });
  if (diff === 0) return `Bugün · ${base}`;
  if (diff === 1) return `Yarın · ${base}`;
  if (diff === -1) return `Dün · ${base}`;
  return base;
};

export default function CalendarPage() {
  const { data: events, loading } = useApi(() => calendarApi.company(), []);
  const [showPast, setShowPast] = useState(false);

  const { upcomingGroups, pastGroups, counts } = useMemo(() => {
    const todayKey = dayKey(new Date());
    const upcoming = {}, past = {};
    let bedelli = 0, temettu = 0;
    for (const ev of events || []) {
      const key = dayKey(ev.event_date);
      const bucket = key >= todayKey ? upcoming : past;
      (bucket[key] = bucket[key] || []).push(ev);
      if (key >= todayKey) {
        if (Number(ev.bedelli_oran) > 0) bedelli++;
        if (Number(ev.nakit_tm_oran) > 0 || Number(ev.bedelsiz_tm_oran) > 0) temettu++;
      }
    }
    return {
      upcomingGroups: Object.entries(upcoming).sort((a, b) => a[0].localeCompare(b[0])),
      pastGroups:     Object.entries(past).sort((a, b) => b[0].localeCompare(a[0])),
      counts: { bedelli, temettu },
    };
  }, [events]);

  const DayGroup = ({ dateKey, list, dimmed }) => (
    <div style={{ opacity: dimmed ? 0.65 : 1 }}>
      <div style={{
        position: "sticky", top: 0, zIndex: 2, padding: "8px 18px",
        background: "var(--bg)", borderBottom: "1px solid var(--border)",
        fontSize: 12, fontWeight: 700, color: dateKey === dayKey(new Date()) ? "var(--accent)" : "var(--text-2)",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>{dayLabel(dateKey)}</span>
        <span style={{ fontFamily: "var(--font-m)", fontWeight: 500, color: "var(--text-3)" }}>{list.length} olay</span>
      </div>
      {list.map((ev, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "10px 18px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ minWidth: 120 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{ev.symbol}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{ev.name}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
            {eventBadges(ev).length ? eventBadges(ev).map((b, j) => (
              <span key={j} style={{
                fontSize: 11, fontWeight: 600, fontFamily: "var(--font-m)",
                padding: "2px 9px", borderRadius: 20,
                background: b.tone === "green" ? "var(--green-bg)" : "var(--red-bg)",
                color:      b.tone === "green" ? "var(--green)"    : "var(--red)",
              }}>{b.text}</span>
            )) : (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Detay yok</span>
            )}
          </div>
          {ev.sector && <span style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-m)" }}>{ev.sector}</span>}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Özet şeridi */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "Yaklaşan Olay",          val: upcomingGroups.reduce((s, [, l]) => s + l.length, 0), color: "var(--accent)" },
          { label: "Yaklaşan Bedelli",       val: counts.bedelli, color: "var(--red)" },
          { label: "Yaklaşan Temettü/Bedelsiz", val: counts.temettu, color: "var(--green)" },
        ].map(x => (
          <div key={x.label} style={{ flex: "1 1 180px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 6 }}>{x.label}</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: 22, color: x.color }}>{loading ? "…" : x.val}</div>
          </div>
        ))}
      </div>

      {/* Takvim */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 15 }}>Şirket Takvimi — Sermaye Artırımı & Temettü</span>
          <button onClick={() => setShowPast(v => !v)} style={{
            padding: "5px 12px", borderRadius: 20, border: "1px solid var(--border)",
            background: showPast ? "var(--accent-bg)" : "var(--bg)",
            color: showPast ? "var(--accent)" : "var(--text-3)",
            fontSize: 11, fontWeight: 600, cursor: "pointer",
          }}>{showPast ? "Geçmişi gizle" : "Son 7 günü göster"}</button>
        </div>

        {loading ? <Spinner /> : !upcomingGroups.length && !pastGroups.length ? (
          <div style={{ padding: 40, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>
            Takvimde kayıt yok. Worker'da <code>python main.py --corporate-actions</code> çalıştırınca burası dolar.
          </div>
        ) : (
          <div style={{ maxHeight: 640, overflowY: "auto" }}>
            {upcomingGroups.length ? (
              upcomingGroups.map(([key, list]) => <DayGroup key={key} dateKey={key} list={list} />)
            ) : (
              <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>Yaklaşan olay görünmüyor.</div>
            )}
            {showPast && pastGroups.map(([key, list]) => <DayGroup key={key} dateKey={key} list={list} dimmed />)}
          </div>
        )}
      </div>
    </div>
  );
}
