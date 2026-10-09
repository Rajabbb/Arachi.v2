import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import RequireLogin from "./components/RequireLogin";
import "./styles.css";

// Arachi AI is the chat only: the panel (analytics, RFQs, offers) lives on arachi.co.
// Sign-in happens there ("Aİ istifadə et" → /sso, handled by the server).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RequireLogin>{(user) => <App user={user} />}</RequireLogin>
  </StrictMode>,
);
