import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuotePage from "./pages/QuotePage";
import "./styles.css";

// Minimal routing: carriers open /quote/:token from their link; everything else is the app.
const quote = window.location.pathname.match(/^\/quote\/([\w.-]+)$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{quote ? <QuotePage token={quote[1]} /> : <App />}</StrictMode>,
);
