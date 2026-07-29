// src/pages/LoginPage.jsx
import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

const S = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #F5F6F8; --surface: #fff; --border: #E2E5EA;
    --text-1: #111827; --text-2: #4B5563; --text-3: #9CA3AF;
    --accent: #1D4ED8; --accent-bg: #EEF2FF;
    --green: #059669; --red: #DC2626;
    --font: 'DM Sans', sans-serif;
    --font-d: 'DM Serif Display', serif;
    --font-m: 'DM Mono', monospace;
  }
  html, body, #root { height: 100%; background: var(--bg); font-family: var(--font); -webkit-font-smoothing: antialiased; }
  input { font-family: var(--font); }
  button { font-family: var(--font); cursor: pointer; }
`;

function Field({ label, type = "text", value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.04em" }}>
        {label}
      </label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "10px 14px", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--bg)",
          fontSize: 14, color: "var(--text-1)", outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={e  => e.target.style.borderColor = "var(--accent)"}
        onBlur={e   => e.target.style.borderColor = "var(--border)"}
      />
    </div>
  );
}

// ── KVKK Aydınlatma Metni — kısa modal ──────────────────────
// Tam metin ayrıca gizlilik-politikasi.md olarak sitede yayınlanmalı;
// burada kayıt anında gösterilecek özet + link yeterli.
const KVKK_SUMMARY = `
Borsa Pro'ya kayıt olurken e-posta adresiniz ve şifreniz (şifrelenmiş olarak) saklanır.
Uygulamayı kullandıkça oluşturduğunuz portföyler, işlemler ve izleme listeleri de
hesabınızla ilişkilendirilerek işlenir.

Verileriniz, hizmetin sağlanabilmesi için veritabanı ve barındırma sağlayıcılarımızla
(Supabase, Vercel) paylaşılır. AI yorum özelliğini kendi API anahtarınızla kullanmayı
tercih ederseniz, o sorgu OpenAI'a iletilir — bu özellik tamamen isteğe bağlıdır.

KVKK m.11 kapsamında verilerinizin ne şekilde işlendiğini öğrenme, düzeltilmesini veya
silinmesini talep etme hakkına sahipsiniz. Detaylı bilgi için Aydınlatma Metni'nin
tamamını okuyabilirsiniz.
`.trim();

function KvkkModal({ onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--surface)", borderRadius: 14, maxWidth: 480, width: "100%",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
      }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-d)", fontSize: 17 }}>KVKK Aydınlatma Metni</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "var(--text-3)", cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: 22, overflowY: "auto", fontSize: 13, lineHeight: 1.7, color: "var(--text-2)", whiteSpace: "pre-line" }}>
          {KVKK_SUMMARY}
        </div>
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "10px", borderRadius: 8, border: "none",
            background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600,
          }}>Anladım</button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode,     setMode]     = useState("login"); // "login" | "register"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [name,     setName]     = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [showKvkk, setShowKvkk] = useState(false);

  async function handleSubmit() {
    if (!email || !password) { setError("E-posta ve şifre zorunludur."); return; }
    if (mode === "register" && !kvkkAccepted) {
      setError("Devam etmek için KVKK Aydınlatma Metni'ni onaylamanız gerekiyor.");
      return;
    }
    setLoading(true); setError("");
    try {
      if (mode === "login") await login(email, password);
      else                  await register(email, password, name, kvkkAccepted);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{S}</style>
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24,
      }}>
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 16, padding: "40px 44px", width: "100%", maxWidth: 420,
          boxShadow: "0 8px 40px rgba(0,0,0,0.07)",
        }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: "var(--accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                <polyline points="16 7 22 7 22 13"/>
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-d)", fontSize: 18, lineHeight: 1 }}>Borsa Pro</div>
              <div style={{ fontFamily: "var(--font-m)", fontSize: 9, color: "var(--text-3)", letterSpacing: "0.14em", marginTop: 2 }}>ANALİTİK</div>
            </div>
          </div>

          <h1 style={{ fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 400, marginBottom: 6 }}>
            {mode === "login" ? "Tekrar hoş geldiniz" : "Hesap oluştur"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 28 }}>
            {mode === "login" ? "Hesabınıza giriş yapın" : "Ücretsiz başlayın"}
          </p>

          {/* Form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {mode === "register" && (
              <Field label="Ad Soyad" value={name} onChange={setName} placeholder="Ahmet Yılmaz" />
            )}
            <Field label="E-Posta" type="email" value={email} onChange={setEmail} placeholder="ornek@email.com" />
            <Field label="Şifre" type="password" value={password} onChange={setPassword} placeholder="••••••••" />

            {mode === "register" && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--text-2)", cursor: "pointer", lineHeight: 1.5 }}>
                <input
                  type="checkbox" checked={kvkkAccepted}
                  onChange={e => setKvkkAccepted(e.target.checked)}
                  style={{ marginTop: 2, width: 15, height: 15, flexShrink: 0, cursor: "pointer" }}
                />
                <span>
                  <button type="button" onClick={(e) => { e.preventDefault(); setShowKvkk(true); }}
                    style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>
                    KVKK Aydınlatma Metni
                  </button>'ni okudum, kabul ediyorum.
                </span>
              </label>
            )}

            {error && (
              <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: "#FEF2F2", border: "1px solid #FEE2E2",
                fontSize: 13, color: "var(--red)",
              }}>{error}</div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                padding: "11px", borderRadius: 8, border: "none",
                background: loading ? "var(--accent-bg)" : "var(--accent)",
                color: loading ? "var(--accent)" : "#fff",
                fontSize: 14, fontWeight: 600,
                transition: "all 0.15s", marginTop: 4,
              }}
            >
              {loading ? "Lütfen bekleyin..." : mode === "login" ? "Giriş Yap" : "Kayıt Ol"}
            </button>
          </div>

          {/* Mod değiştir */}
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-3)", marginTop: 24 }}>
            {mode === "login" ? "Hesabınız yok mu? " : "Hesabınız var mı? "}
            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
            >
              {mode === "login" ? "Kayıt Ol" : "Giriş Yap"}
            </button>
          </p>
        </div>
      </div>
      {showKvkk && <KvkkModal onClose={() => setShowKvkk(false)} />}
    </>
  );
}
