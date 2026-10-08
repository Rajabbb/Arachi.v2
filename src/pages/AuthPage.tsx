import { useState, type FormEvent } from "react";
import { forgotPassword, login, register, type User } from "../lib/auth";

type Mode = "login" | "register" | "forgot";

const titles: Record<Mode, string> = {
  login: "Hesabınıza daxil olun",
  register: "Yeni hesab yaradın",
  forgot: "Şifrəni bərpa edin",
};

/** Login, registration and "forgot password" in one card. */
export default function AuthPage({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function switchTo(next: Mode) {
    setMode(next);
    setError("");
    setSent(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "forgot") {
        await forgotPassword(email);
        setSent(true);
      } else {
        onSignedIn(mode === "login" ? await login(email, password) : await register(name, email, password));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <span className="logo">Arachi</span>
        <span className="badge">V2</span>
      </header>
      <main className="page-body auth">
        <form className="card form" onSubmit={submit}>
          <h1 className="auth-title">{titles[mode]}</h1>
          {mode === "register" && (
            <label>
              Ad (istəyə görə)
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
            </label>
          )}
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          {mode !== "forgot" && (
            <label>
              Şifrə
              <input
                type="password"
                required
                minLength={mode === "register" ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
              {mode === "register" && <span className="hint">Ən azı 8 simvol.</span>}
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {sent ? (
            <p className="success">
              Bu email ilə hesab varsa, şifrəni bərpa etmək üçün link göndərdik. Poçtunuzu yoxlayın (spam qovluğunu da).
            </p>
          ) : (
            <button className="send-button" type="submit" disabled={busy}>
              {busy ? "Gözləyin…" : mode === "login" ? "Daxil ol" : mode === "register" ? "Qeydiyyatdan keç" : "Bərpa linki göndər"}
            </button>
          )}
          <div className="auth-links">
            {mode !== "login" && <button type="button" onClick={() => switchTo("login")}>Daxil ol</button>}
            {mode !== "register" && <button type="button" onClick={() => switchTo("register")}>Yeni hesab yarat</button>}
            {mode === "login" && <button type="button" onClick={() => switchTo("forgot")}>Şifrəni unutmusunuz?</button>}
          </div>
        </form>
      </main>
    </div>
  );
}
