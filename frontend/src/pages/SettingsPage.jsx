// src/pages/SettingsPage.jsx
import { useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useApi, useMutation } from "../hooks/useApi.js";
import { auth as authApi, portfolios as portApi } from "../api/client.js";

// ── YARDIMCI BİLEŞENLER ────────────────────────────────────

function Section({ title, desc, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r)", overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 16 }}>{title}</div>
        {desc && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>{desc}</div>}
      </div>
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 12px", borderRadius: 8,
  border: "1px solid var(--border)", background: "var(--bg)",
  fontSize: 13, fontFamily: "var(--font)", outline: "none", color: "var(--text-1)",
};

function Toggle({ checked, onChange, label, sub }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{sub}</div>}
      </div>
      <button onClick={() => onChange(!checked)} style={{
        width: 40, height: 22, borderRadius: 20, border: "none", cursor: "pointer",
        background: checked ? "var(--accent)" : "var(--border)",
        position: "relative", transition: "background 0.15s", flexShrink: 0,
      }}>
        <span style={{
          position: "absolute", top: 2, left: checked ? 20 : 2,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }} />
      </button>
    </div>
  );
}

function Banner({ type = "success", children }) {
  const isErr = type === "error";
  return (
    <div style={{
      padding: "9px 14px", borderRadius: 8, fontSize: 12,
      background: isErr ? "var(--red-bg)" : "var(--green-bg)",
      border: `1px solid ${isErr ? "var(--red)" : "var(--green)"}`,
      color: isErr ? "var(--red)" : "var(--green)",
    }}>{children}</div>
  );
}

// ── 1. PROFİL BİLGİLERİ ─────────────────────────────────────
function ProfileSection() {
  const { user, updateUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [msg, setMsg] = useState(null);
  const { mutate, loading } = useMutation((b) => authApi.updateMe(b));

  const initials = (fullName || user?.email || "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();

  async function handleSave() {
    setMsg(null);
    try {
      const updated = await mutate({ full_name: fullName, avatar_url: avatarUrl });
      updateUser(updated);
      setMsg({ type: "success", text: "Profil güncellendi." });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
  }

  return (
    <Section title="Profil Bilgileri" desc="Adın ve profil resmin.">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: "var(--accent)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 18,
          }}>{initials}</div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{user?.email}</div>
      </div>

      <Field label="Ad Soyad">
        <input style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ad Soyad" />
      </Field>

      <Field label="Avatar URL (isteğe bağlı)">
        <input style={inputStyle} value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." />
      </Field>

      {msg && <Banner type={msg.type}>{msg.text}</Banner>}

      <button onClick={handleSave} disabled={loading} style={{
        alignSelf: "flex-start", padding: "9px 20px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13,
        cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
      }}>{loading ? "Kaydediliyor..." : "Kaydet"}</button>
    </Section>
  );
}

// ── 2. ŞİFRE DEĞİŞTİRME ─────────────────────────────────────
function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(null);
  const { mutate, loading } = useMutation((b) => authApi.changePassword(b));

  async function handleSave() {
    setMsg(null);
    if (next !== confirm) { setMsg({ type: "error", text: "Yeni şifreler eşleşmiyor." }); return; }
    try {
      await mutate({ current_password: current, new_password: next });
      setMsg({ type: "success", text: "Şifre değiştirildi." });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
  }

  return (
    <Section title="Şifre Değiştir" desc="Güvenliğin için düzenli olarak şifreni güncelle.">
      <Field label="Mevcut Şifre">
        <input type="password" style={inputStyle} value={current} onChange={e => setCurrent(e.target.value)} />
      </Field>
      <Field label="Yeni Şifre">
        <input type="password" style={inputStyle} value={next} onChange={e => setNext(e.target.value)} />
      </Field>
      <Field label="Yeni Şifre (Tekrar)">
        <input type="password" style={inputStyle} value={confirm} onChange={e => setConfirm(e.target.value)} />
      </Field>

      {msg && <Banner type={msg.type}>{msg.text}</Banner>}

      <button onClick={handleSave} disabled={loading || !current || !next} style={{
        alignSelf: "flex-start", padding: "9px 20px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13,
        cursor: loading ? "not-allowed" : "pointer", opacity: (loading || !current || !next) ? 0.6 : 1,
      }}>{loading ? "Kaydediliyor..." : "Şifreyi Değiştir"}</button>
    </Section>
  );
}

// ── 3. BİLDİRİM TERCİHLERİ ──────────────────────────────────
function NotificationsSection() {
  const { user, updateUser } = useAuth();
  const [notifyEmail, setNotifyEmail] = useState(user?.notify_email ?? true);
  const [notifyAlerts, setNotifyAlerts] = useState(user?.notify_price_alerts ?? true);
  const [msg, setMsg] = useState(null);
  const { mutate, loading } = useMutation((b) => authApi.updateMe(b));

  async function save(patch) {
    setMsg(null);
    try {
      const updated = await mutate(patch);
      updateUser(updated);
      setMsg({ type: "success", text: "Tercih kaydedildi." });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
  }

  return (
    <Section title="Bildirim Tercihleri" desc="Hangi bildirimleri almak istediğini seç.">
      <Toggle
        checked={notifyEmail}
        onChange={(v) => { setNotifyEmail(v); save({ notify_email: v }); }}
        label="E-posta Bildirimleri"
        sub="Önemli güncellemeler e-posta ile gönderilsin"
      />
      <Toggle
        checked={notifyAlerts}
        onChange={(v) => { setNotifyAlerts(v); save({ notify_price_alerts: v }); }}
        label="Fiyat Uyarıları"
        sub="Kurduğun fiyat alarmları tetiklendiğinde bildirim al"
      />
      {msg && <Banner type={msg.type}>{msg.text}</Banner>}
    </Section>
  );
}

// ── 4. AI API KEY ────────────────────────────────────────────
function ApiKeySection() {
  const { user, updateUser } = useAuth();
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState(null);
  const { mutate, loading } = useMutation((b) => authApi.updateMe(b));

  async function handleSave() {
    setMsg(null);
    try {
      const updated = await mutate({ openai_api_key: apiKey });
      updateUser(updated);
      setMsg({ type: "success", text: "API key kaydedildi." });
      setApiKey("");
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
  }

  return (
    <Section title="AI Yorum Özelliği" desc="Hisse detaylarında ChatGPT (OpenAI) yorumu almak için kendi API key'ini gir.">
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 12, color: user?.has_api_key ? "var(--green)" : "var(--text-3)",
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: user?.has_api_key ? "var(--green)" : "var(--border)",
        }} />
        {user?.has_api_key ? "API key kayıtlı" : "Henüz API key girilmedi"}
      </div>

      <Field label="OpenAI API Key">
        <input type="password" style={inputStyle} value={apiKey} onChange={e => setApiKey(e.target.value)}
          placeholder="sk-..." />
      </Field>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        platform.openai.com/api-keys adresinden alabilirsin. Bu key, veritabanında düz metin olarak saklanıyor —
        kişisel/deneme projesi için kabul edilebilir, ama gerçek şifreleme değil.
      </div>

      {msg && <Banner type={msg.type}>{msg.text}</Banner>}

      <button onClick={handleSave} disabled={loading || !apiKey} style={{
        alignSelf: "flex-start", padding: "9px 20px", borderRadius: 8, border: "none",
        background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13,
        cursor: loading ? "not-allowed" : "pointer", opacity: (loading || !apiKey) ? 0.6 : 1,
      }}>{loading ? "Kaydediliyor..." : "Kaydet"}</button>
    </Section>
  );
}

// ── 5. PORTFÖY / PARA BİRİMİ ─────────────────────────────────
function PortfolioSection() {
  const { data: portList, refetch } = useApi(() => portApi.list(), []);
  const defaultPort = portList?.find(p => p.is_default) || portList?.[0];
  const [currency, setCurrency] = useState("TRY");
  const [msg, setMsg] = useState(null);
  const { mutate, loading } = useMutation((b) => portApi.update(defaultPort.id, b));

  async function handleSave() {
    setMsg(null);
    try {
      await mutate({ currency });
      refetch();
      setMsg({ type: "success", text: "Para birimi güncellendi." });
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
  }

  return (
    <Section title="Portföy Ayarları" desc="Varsayılan portföyünün para birimi.">
      {!defaultPort ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Henüz bir portföy yok.</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Portföy: <b style={{ color: "var(--text-1)" }}>{defaultPort.name}</b></div>
          <Field label="Para Birimi">
            <select style={inputStyle} value={currency || defaultPort.currency} onChange={e => setCurrency(e.target.value)}>
              <option value="TRY">TRY — Türk Lirası</option>
              <option value="USD">USD — Amerikan Doları</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </Field>
          {msg && <Banner type={msg.type}>{msg.text}</Banner>}
          <button onClick={handleSave} disabled={loading} style={{
            alignSelf: "flex-start", padding: "9px 20px", borderRadius: 8, border: "none",
            background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13,
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
          }}>{loading ? "Kaydediliyor..." : "Kaydet"}</button>
        </>
      )}
    </Section>
  );
}

// ── ANA SAYFA ──────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 640 }}>
      <ProfileSection />
      <PasswordSection />
      <NotificationsSection />
      <ApiKeySection />
      <PortfolioSection />
    </div>
  );
}
