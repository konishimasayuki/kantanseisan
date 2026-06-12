import { useState, useEffect } from "react";
import LoginPage from "./components/LoginPage.jsx";
import ExpenseApp from "./components/ExpenseApp.jsx";

export default function App() {
  const [session, setSession] = useState(null); // { userId, token }
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = sessionStorage.getItem("ks_session");
    if (saved) {
      try {
        setSession(JSON.parse(saved));
      } catch {
        sessionStorage.removeItem("ks_session");
      }
    }
    setChecking(false);
  }, []);

  const handleLogin = (sess) => {
    sessionStorage.setItem("ks_session", JSON.stringify(sess));
    setSession(sess);
  };

  const handleLogout = () => {
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
