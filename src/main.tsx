import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuotePage from "./pages/QuotePage";
import PanelPage from "./pages/PanelPage";
import "./styles.css";

// Minimal routing: carriers open /quote/:token from their link, /panel is the
// analytics panel, everything else is the chat.
const path = window.location.pathname;
const quote = path.match(/^\/quote\/([\w.-]+)$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {quote ? <QuotePage token={quote[1]} /> : path === "/panel" ? <PanelPage /> : <App />}
  </StrictMode>,
);
