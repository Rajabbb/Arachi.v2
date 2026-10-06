import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import QuotePage from "./pages/QuotePage";
import PanelPage from "./pages/PanelPage";
import ResetPage from "./pages/ResetPage";
import RfqPage from "./pages/RfqPage";
import CarrierPage from "./pages/CarrierPage";
import RequireLogin from "./components/RequireLogin";
import "./styles.css";

// Minimal routing: carriers open /quote/:token from their link (no login),
// /reset/:token comes from the password reset email, /panel is the analytics
// panel, /panel/rfq/:id one RFQ's page and /panel/carrier/:id one carrier's page, everything else is the chat. Chat and panel need a login.
const path = window.location.pathname;
const quote = path.match(/^\/quote\/([\w.-]+)$/);
const reset = path.match(/^\/reset\/([\w-]+)$/);
const rfq = path.match(/^\/panel\/rfq\/(\d+)$/);
const carrier = path.match(/^\/panel\/carrier\/(\d+)$/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {quote ? (
      <QuotePage token={quote[1]} />
    ) : reset ? (
      <ResetPage token={reset[1]} />
    ) : (
      <RequireLogin>
        {(user) =>
          rfq ? (
            <RfqPage user={user} id={Number(rfq[1])} />
          ) : carrier ? (
            <CarrierPage user={user} id={Number(carrier[1])} />
          ) : path === "/panel" ? (
            <PanelPage user={user} />
          ) : (
            <App user={user} />
          )
        }
      </RequireLogin>
    )}
  </StrictMode>,
);
