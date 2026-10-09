import { arachiSiteUrl } from "../lib/auth";

/**
 * Arachi AI-yə yalnız arachi.co-dakı "Aİ istifadə et" düyməsi ilə daxil olunur (Pro plan).
 * Burada öz giriş formu yoxdur: sessiya bitibsə və ya link açılıbsa, istifadəçi arachi.co-ya qaytarılır.
 */
export default function ArachiLoginPage() {
  return (
    <div className="page">
      <header className="header">
        <span className="logo">Arachi</span>
        <span className="badge">AI</span>
      </header>
      <main className="page-body auth">
        <div className="card form">
          <h1 className="auth-title">Arachi AI</h1>
          <p>
            Aİ agentə arachi.co hesabınızla daxil olursunuz: orada hesabınıza girin və{" "}
            <strong>«Aİ istifadə et»</strong> düyməsini basın.
          </p>
          <p className="hint">Bu funksiya Pro plan üçün aktivdir.</p>
          <a className="send-button" style={{ textAlign: "center", textDecoration: "none" }} href={`${arachiSiteUrl}/login`} target="_top">
            arachi.co-ya keç
          </a>
        </div>
      </main>
    </div>
  );
}
