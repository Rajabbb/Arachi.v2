import type { IncomingMessage, ServerResponse } from "node:http";
import { ArachiError, exchangeTicket } from "../arachi/client";
import { createSession, upsertArachiUser } from "../auth/accounts";
import { arachiMode, config, frameAncestors } from "../config";
import { HttpError } from "../http";
import { clientIp, limit } from "../rateLimit";
import { sessionCookie } from "./auth";

const MAX_TICKET_LENGTH = 4000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A small stand-alone page for a failed sign-in (the user came from a button on arachi.co, so a plain page with a way back is enough). */
function errorPage(res: ServerResponse, status: number, message: string) {
  const back = `${config.arachiSiteUrl}/customer`;
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors()}`,
    "referrer-policy": "no-referrer",
  });
  res.end(`<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arachi AI</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f7ff;color:#0b1433;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border:1px solid #dce4f7;border-radius:20px;padding:32px;max-width:440px;box-shadow:0 30px 60px -36px rgba(0,55,184,.5)}
h1{font-size:1.2rem;margin:0 0 10px}p{color:#56627f;line-height:1.6;margin:0 0 20px}a{display:inline-block;background:#0037b8;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:12px}</style></head>
<body><div class="c"><h1>Aİ-yə giriş alınmadı</h1><p>${escapeHtml(message)}</p><a href="${escapeHtml(back)}" target="_top">arachi.co-ya qayıt</a></div></body></html>`);
}

/**
 * GET /sso?ticket=... — where arachi.co's "Aİ istifadə et" button lands. The server (never the
 * browser) trades the one-time ticket with arachi.co, opens the customer's session and sends
 * them to the chat. The ticket is single use, so reloading this address later does nothing.
 */
export async function handleSso(req: IncomingMessage, res: ServerResponse) {
  if (!arachiMode()) return errorPage(res, 404, "Bu server arachi.co ilə birləşdirilməyib.");
  try {
    limit(`sso:${clientIp(req)}`, 30, 15);
    const ticket = new URL(req.url ?? "/", "http://localhost").searchParams.get("ticket") ?? "";
    if (!ticket || ticket.length > MAX_TICKET_LENGTH) {
      return errorPage(res, 400, "Giriş linki düzgün deyil. arachi.co-dan 'Aİ istifadə et' düyməsini yenidən basın.");
    }
    const exchanged = await exchangeTicket(ticket);
    const user = await upsertArachiUser({ customerId: exchanged.user.id, name: exchanged.user.name || "Müştəri" });
    const { token } = await createSession(user.id, { token: exchanged.token, expiresInSeconds: exchanged.expiresIn });
    res.writeHead(302, {
      location: "/",
      "set-cookie": sessionCookie(token, exchanged.expiresIn),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end();
  } catch (err) {
    if (err instanceof ArachiError) return errorPage(res, err.status === 403 ? 403 : err.status >= 500 ? 502 : 401, err.message);
    if (err instanceof HttpError) return errorPage(res, err.status, err.message);
    console.error("SSO failed:", err);
    errorPage(res, 500, "Giriş zamanı gözlənilməz xəta baş verdi. Bir az sonra yenidən cəhd edin.");
  }
}
