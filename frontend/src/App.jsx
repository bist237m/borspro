// src/App.jsx
import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import LoginPage   from "./pages/LoginPage.jsx";
import OverviewPage   from "./pages/OverviewPage.jsx";
import PositionsPage  from "./pages/PositionsPage.jsx";
import WatchlistPage  from "./pages/WatchlistPage.jsx";
import ChartsPage     from "./pages/ChartsPage.jsx";
import TechnicalsPage from "./pages/TechnicalsPage.jsx";
import ScreenerPage   from "./pages/ScreenerPage.jsx";
import SettingsPage   from "./pages/SettingsPage.jsx";

// ── GLOBAL STYLES ──────────────────────────────────────────
const G = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── AÇIK TEMA (varsayılan) ── */
  :root {
    --bg:        #F5F6F8;
    --surface:   #FFFFFF;
    --border:    #E2E5EA;
    --text-1:    #111827;
    --text-2:    #4B5563;
    --text-3:    #9CA3AF;
    --accent:    #1D4ED8;
    --accent-bg: #EEF2FF;
    --green:     #059669;
    --green-bg:  #ECFDF5;
    --red:       #DC2626;
    --red-bg:    #FEF2F2;
    --overlay:   rgba(17, 24, 39, 0.5);
    --sidebar-w: 220px;
    --header-h:  58px;
    --r:         10px;
    --font:      'DM Sans', sans-serif;
    --font-d:    'DM Serif Display', serif;
    --font-m:    'DM Mono', monospace;
  }

  /* ── KOYU TEMA (sistem tercihine göre otomatik) ── */
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:        #0B0E14;
      --surface:   #131722;
      --border:    #232838;
      --text-1:    #E8EAED;
      --text-2:    #9CA3AF;
      --text-3:    #6B7280;
      --accent:    #3B82F6;
      --accent-bg: #1E293B;
      --green:     #22C55E;
      --green-bg:  #14251C;
      --red:       #EF4444;
      --red-bg:    #2A1616;
      --overlay:   rgba(0, 0, 0, 0.6);
    }
  }

  html, body, #root { height: 100%; background: var(--bg); color: var(--text-1); font-family: var(--font); -webkit-font-smoothing: antialiased; }
  button { font-family: var(--font); cursor: pointer; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #CDD2DA; border-radius: 4px; }
  .fade { animation: fd 0.38s ease both; }
  @keyframes fd { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

  /* ── SIDEBAR — masaüstünde sabit, mobilde çekmece ── */
  .sidebar {
    width: var(--sidebar-w);
    transition: transform 0.25s ease;
  }
  .hamburger-btn { display: none; }
  .overlay-backdrop { display: none; }

  @media (max-width: 860px) {
    .sidebar {
      transform: translateX(-100%);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .main-content {
      margin-left: 0 !important;
    }
    .hamburger-btn { display: flex !important; }
    .overlay-backdrop.open {
      display: block;
      position: fixed;
      inset: 0;
      background: var(--overlay);
      z-index: 90;
    }
    .header-search-text { display: none; }
    .header-title { font-size: 17px !important; }
    main.dashboard-main { padding: 16px !important; }
  }
`;

// ── NAV ────────────────────────────────────────────────────
const NAV = [
  { group: "Portföy", items: [
    { id: "overview",   label: "Genel Bakış",    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "watchlist",  label: "İzleme Listesi", icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" },
    { id: "positions",  label: "Pozisyonlar",    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  ]},
  { group: "Analiz", items: [
    { id: "charts",     label: "Grafikler",      icon: "M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" },
    { id: "technicals", label: "Teknik Analiz",  icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
    { id: "screener",   label: "Hisse Tarayıcı", icon: "M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" },
  ]},
  { group: "Piyasa", items: [
    { id: "news",     label: "Haberler",         icon: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" },
    { id: "calendar", label: "Ekon. Takvim",     icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
    { id: "sectors",  label: "Sektörler",        icon: "M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" },
  ]},
  { group: "Diğer", items: [
    { id: "reports",  label: "Raporlar",         icon: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
    { id: "settings", label: "Ayarlar",          icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
  ]},
];

const TITLES = {
  overview:"Genel Bakış", watchlist:"İzleme Listesi", positions:"Pozisyonlar",
  charts:"Grafikler", technicals:"Teknik Analiz", screener:"Hisse Tarayıcı",
  news:"Haberler", calendar:"Ekonomik Takvim", sectors:"Sektörler",
  reports:"Raporlar", settings:"Ayarlar",
};

function NavIcon({ d }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split("M").filter(Boolean).map((p, i) => <path key={i} d={"M" + p} />)}
    </svg>
  );
}

// ── SIDEBAR ────────────────────────────────────────────────
function Sidebar({ active, onNav, mobileOpen, onClose }) {
  const { user, logout } = useAuth();
  const initials = user?.full_name?.split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase() || "?";

  return (
    <aside className={`sidebar${mobileOpen ? " open" : ""}`} style={{
      background: "var(--surface)",
      borderRight: "1px solid var(--border)",
      position: "fixed", top: 0, left: 0, bottom: 0,
      display: "flex", flexDirection: "column", zIndex: 100,
    }}>
      <div style={{
        height: "var(--header-h)", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: 15, lineHeight: 1 }}>Borsa Pro</div>
            <div style={{ fontFamily: "var(--font-m)", fontSize: 9, color: "var(--text-3)", letterSpacing: "0.12em", marginTop: 2 }}>ANALİTİK</div>
          </div>
        </div>
        {/* Mobilde kapatma butonu */}
        <button onClick={onClose} className="hamburger-btn" style={{
          background: "none", border: "none", color: "var(--text-2)", fontSize: 20,
        }}>✕</button>
      </div>

      <nav style={{ flex: 1, overflowY: "auto", padding: "10px 10px" }}>
        {NAV.map(g => (
          <div key={g.group} style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-3)", padding: "10px 8px 4px", textTransform: "uppercase" }}>
              {g.group}
            </div>
            {g.items.map(item => {
              const on = active === item.id;
              return (
                <button key={item.id} onClick={() => { onNav(item.id); onClose(); }} style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9,
                  padding: "8px 10px", borderRadius: 7, border: "none",
                  background: on ? "var(--accent-bg)" : "transparent",
                  color: on ? "var(--accent)" : "var(--text-2)",
                  fontWeight: on ? 600 : 400, fontSize: 13,
                  transition: "all 0.15s", textAlign: "left", marginBottom: 1,
                }}
                  onMouseEnter={e => { if (!on) { e.currentTarget.style.background = "var(--bg)"; e.currentTarget.style.color = "var(--text-1)"; }}}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-2)"; }}}
                >
                  <span style={{ opacity: on ? 1 : 0.65, flexShrink: 0 }}><NavIcon d={item.icon} /></span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%", background: "var(--accent)",
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 600, fontSize: 12, flexShrink: 0,
        }}>{initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.full_name || user?.email}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "capitalize" }}>{user?.plan} Üye</div>
        </div>
        <button onClick={logout} title="Çıkış Yap" style={{
          background: "none", border: "none", color: "var(--text-3)", fontSize: 16, padding: 4,
        }}>⏻</button>
      </div>
    </aside>
  );
}

// ── HEADER ─────────────────────────────────────────────────
const TICKERS = [
  { s:"BIST 100",v:"9.847",c:"+1.02%",up:true },{ s:"THYAO",v:"312,40",c:"+2.15%",up:true },
  { s:"GARAN",v:"118,90",c:"+0.84%",up:true },{ s:"ASELS",v:"87,60",c:"-1.20%",up:false },
  { s:"USD/TRY",v:"32,15",c:"+0.18%",up:true },{ s:"ALTIN",v:"2.847",c:"+0.74%",up:true },
];

function Header({ active, onMenuClick }) {
  return (
    <>
      <header style={{
        height: "var(--header-h)", background: "var(--surface)", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Hamburger — sadece mobilde görünür */}
          <button onClick={onMenuClick} className="hamburger-btn" style={{
            background: "none", border: "none", color: "var(--text-1)", fontSize: 20,
            alignItems: "center", justifyContent: "center", padding: 0,
          }}>☰</button>
          <h1 className="header-title" style={{ fontFamily: "var(--font-d)", fontSize: 20, fontWeight: 400 }}>{TITLES[active]}</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "var(--green-bg)", border: "1px solid var(--green)",
            borderRadius: 20, padding: "4px 12px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block" }}/>
            <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--green)", fontWeight: 500 }}>BIST AÇIK</span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "6px 12px",
          }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span className="header-search-text" style={{ fontFamily: "var(--font-m)", fontSize: 12, color: "var(--text-3)" }}>Hisse ara...</span>
          </div>
        </div>
      </header>
      {/* Ticker */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", height: 32, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <style>{`@keyframes sc{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
        <div style={{ display: "flex", animation: "sc 26s linear infinite", whiteSpace: "nowrap" }}>
          {[...TICKERS,...TICKERS].map((t,i) => (
            <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0 20px", borderRight: "1px solid var(--border)" }}>
              <span style={{ fontFamily: "var(--font-m)", fontSize: 11, fontWeight: 500, color: "var(--text-2)" }}>{t.s}</span>
              <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-1)" }}>{t.v}</span>
              <span style={{ fontFamily: "var(--font-m)", fontSize: 11, color: t.up ? "var(--green)" : "var(--red)" }}>{t.up?"▲":"▼"} {t.c}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── SOON PLACEHOLDER ───────────────────────────────────────
function Soon({ id }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px dashed var(--border)",
      borderRadius: 10, height: 320,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      <div style={{ fontSize: 32, opacity: 0.3 }}>🔧</div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 15, color: "var(--text-2)" }}>{TITLES[id]} modülü</div>
      <div style={{ fontFamily: "var(--font-m)", fontSize: 11, color: "var(--text-3)" }}>YAPIM AŞAMASINDA</div>
    </div>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────
function Dashboard() {
  const [active, setActive] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div
        className={`overlay-backdrop${mobileNavOpen ? " open" : ""}`}
        onClick={() => setMobileNavOpen(false)}
      />
      <Sidebar
        active={active}
        onNav={setActive}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="main-content" style={{ marginLeft: "var(--sidebar-w)", flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header active={active} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="dashboard-main" style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
          {active === "overview"   && <OverviewPage />}
          {active === "positions"  && <PositionsPage />}
          {active === "watchlist"  && <WatchlistPage />}
          {active === "charts"     && <ChartsPage />}
          {active === "technicals" && <TechnicalsPage />}
          {active === "screener"    && <ScreenerPage />}
          {active === "settings"    && <SettingsPage />}
          {!["overview","positions","watchlist","charts","technicals","screener","settings"].includes(active) && <Soon id={active} />}
        </main>
        <footer style={{ borderTop: "1px solid var(--border)", padding: "8px 28px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--text-3)" }}>© 2026 Borsa Pro Analytics</span>
          <span style={{ fontFamily: "var(--font-m)", fontSize: 10, color: "var(--text-3)" }}>v3.0.0</span>
        </footer>
      </div>
    </div>
  );
}

// ── AUTH GUARD ─────────────────────────────────────────────
function AuthGate() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 20, color: "var(--text-3)" }}>Yükleniyor...</div>
    </div>
  );

  return user ? <Dashboard /> : <LoginPage />;
}

// ── ROOT ───────────────────────────────────────────────────
export default function App() {
  return (
    <>
      <style>{G}</style>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </>
  );
}
