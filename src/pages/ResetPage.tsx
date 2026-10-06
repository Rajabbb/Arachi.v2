import { useState, type FormEvent } from "react";
import { resetPassword } from "../lib/auth";

/** /reset/:token — the page the password reset email links to. */
export default function ResetPage({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError("Şifrələr eyni deyil.");
    setBusy(true);
    setError("");
    try {
      await resetPassword(token, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <a className="logo" href="/">Arachi</a>
        <span className="badge">V2</span>
      </header>
      <main className="page-body auth">
        <form className="card form" onSubmit={submit}>
          <h1 className="auth-title">Yeni şifrə təyin edin</h1>
          <label>
            Yeni şifrə
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <span className="hint">Ən azı 8 simvol.</span>
          </label>
          <label>
            Yeni şifrə (təkrar)
            <input type="password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="send-button" type="submit" disabled={busy}>
            {busy ? "Gözləyin…" : "Şifrəni yadda saxla"}
          </button>
          <div className="auth-links">
            <a href="/">Girişə qayıt</a>
          </div>
        </form>
      </main>
    </div>
  );
}
