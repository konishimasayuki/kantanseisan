import { useState } from "react";

export default function LoginPage({ onLogin }) {
  const [id, setId]       = useState("");
  const [pass, setPass]   = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!id || !pass) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "ログインに失敗しました");
      } else {
        onLogin({ userId: data.userId, token: data.token, displayName: data.displayName });
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={S.root}>
      <div style={S.card}>
        <div style={S.logo}>💴</div>
        <div style={S.title}>簡単精算くん</div>
        <div style={S.sub}>経費精算システム</div>

        <div style={S.field}>
          <label style={S.label}>ユーザーID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="ID を入力"
            style={S.input}
            autoCapitalize="none"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>
        <div style={S.field}>
          <label style={S.label}>パスワード</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="パスワードを入力"
            style={S.input}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
        </div>

        {error && <div style={S.error}>{error}</div>}

        <button
          style={{ ...S.btn, opacity: loading ? 0.6 : 1 }}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? "ログイン中..." : "ログイン"}
        </button>

        <div style={S.demo}>
          デモ用: ID <strong>a</strong> / PW <strong>a</strong>
        </div>
      </div>
    </div>
  );
}

const S = {
  root: {
    minHeight: "100vh",
    background: "#FFFAF7",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    fontFamily: "-apple-system, 'Hiragino Sans', 'Meiryo', sans-serif",
  },
  card: {
    background: "#fff",
    border: "1px solid #FED7AA",
    borderRadius: 16,
    padding: "36px 28px",
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 4px 24px #F9731611",
  },
  logo: { fontSize: 40, textAlign: "center", marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 800, textAlign: "center", color: "#1E293B", marginBottom: 4 },
  sub: { fontSize: 13, textAlign: "center", color: "#94A3B8", marginBottom: 28 },
  field: { marginBottom: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 5 },
  input: {
    width: "100%",
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 15,
    color: "#1E293B",
    outline: "none",
    boxSizing: "border-box",
  },
  error: {
    background: "#FEF2F2",
    border: "1px solid #FECACA",
    borderRadius: 7,
    color: "#EF4444",
    padding: "9px 12px",
    fontSize: 13,
    marginBottom: 14,
  },
  btn: {
    width: "100%",
    background: "#F97316",
    border: "none",
    borderRadius: 9,
    color: "#fff",
    padding: "13px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    marginBottom: 16,
  },
  demo: {
    textAlign: "center",
    fontSize: 12,
    color: "#94A3B8",
  },
};
