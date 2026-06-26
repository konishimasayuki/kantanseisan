import { useState, useEffect } from "react";
import LoginPage from "./components/LoginPage.jsx";
import ExpenseApp from "./components/ExpenseApp.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // localStorage（永続）→ なければ sessionStorage（旧データ移行）の順で確認
    const saved = localStorage.getItem("ks_session") || sessionStorage.getItem("ks_session");
    if (saved) {
      try {
        setSession(JSON.parse(saved));
        // sessionStorageに残っていたら localStorage に移す
        if (!localStorage.getItem("ks_session")) {
          localStorage.setItem("ks_session", saved);
          sessionStorage.removeItem("ks_session");
        }
      } catch {
        localStorage.removeItem("ks_session");
        sessionStorage.removeItem("ks_session");
      }
    }
    setChecking(false);
  }, []);

  const handleLogin = (sess) => {
    localStorage.setItem("ks_session", JSON.stringify(sess));
    setSession(sess);
  };

  const handleLogout = () => {
    localStorage.removeItem("ks_session");
    sessionStorage.removeItem("ks_session");
    setSession(null);
  };

  if (checking) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#FFFAF7" }}>
        <div style={{ color: "#F97316", fontSize: 28 }}>💴</div>
      </div>
    );
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <ExpenseApp session={session} onLogout={handleLogout} />;
}
