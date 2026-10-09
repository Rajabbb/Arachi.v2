import { config } from "../config";
import { currentArachiToken } from "../auth/current";

/** arachi.co-nun cavabı xəta olanda atılır; mesaj istifadəçiyə / AI-yə göstərilə bilən Azərbaycan dilindəki mətndir. */
export class ArachiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 25_000;

/** FastAPI "detail" is either a string or a list of validation problems. */
function detailOf(body: unknown): string | undefined {
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        const item = d as { loc?: unknown[]; msg?: string };
        const field = Array.isArray(item.loc) ? item.loc.filter((l) => l !== "body").join(".") : "";
        return item.msg ? (field ? `${field}: ${item.msg}` : item.msg) : "";
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return undefined;
}

async function send(method: string, path: string, headers: Record<string, string>, body?: string | FormData) {
  if (!config.arachiApiUrl) throw new ArachiError(503, "arachi.co ilə inteqrasiya qurulmayıb.");
  let res: Response;
  try {
    res = await fetch(`${config.arachiApiUrl}${path}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ArachiError(502, "arachi.co ilə əlaqə qurulmadı. Bir az sonra yenidən cəhd edin.");
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  return { res, parsed, text };
}

export interface Exchanged {
  token: string;
  /** Seconds the arachi.co token stays valid. */
  expiresIn: number;
  user: { id: number; email: string; name: string; plan: string };
}

/**
 * Trades the one-time ticket from arachi.co's "Aİ istifadə et" button for that
 * customer's access token. arachi.co checks the signature, the expiry, that the
 * ticket was not used before and that the customer is on the Pro plan.
 */
export async function exchangeTicket(ticket: string): Promise<Exchanged> {
  const { res, parsed } = await send(
    "POST",
    "/api/ai/exchange",
    { "content-type": "application/json", "x-service-secret": config.ssoSecret },
    JSON.stringify({ ticket }),
  );
  if (!res.ok) {
    const message = detailOf(parsed) ?? "arachi.co girişi təsdiqləmədi.";
    throw new ArachiError(res.status === 403 ? 403 : res.status >= 500 ? 502 : 401, message);
  }
  const data = parsed as { token?: string; expires_in?: number; user?: Exchanged["user"] };
  if (!data?.token || !data.user) throw new ArachiError(502, "arachi.co gözlənilməz cavab verdi.");
  return { token: data.token, expiresIn: Number(data.expires_in) || 12 * 3600, user: data.user };
}

export interface CallOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  form?: FormData;
}

/** A call to arachi.co as the signed-in user (the token comes from the request's context). */
export async function arachi<T = unknown>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${currentArachiToken()}` };
  let url = path;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const { res, parsed, text } = await send(method, url, headers, body);
  if (res.ok) return (parsed ?? (text as unknown)) as T;
  if (res.status === 401) {
    throw new ArachiError(401, "arachi.co sessiyasının vaxtı bitib. arachi.co-dan yenidən 'Aİ istifadə et' düyməsini basın.");
  }
  const detail = detailOf(parsed);
  if (res.status >= 500) throw new ArachiError(502, detail ? `arachi.co xətası: ${detail}` : "arachi.co-da xəta baş verdi. Bir az sonra yenidən cəhd edin.");
  throw new ArachiError(res.status, detail ?? `arachi.co sorğunu qəbul etmədi (${res.status}).`);
}
