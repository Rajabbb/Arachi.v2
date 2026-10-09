import type Anthropic from "@anthropic-ai/sdk";

import { providerNames, type ProviderName } from "./agent/providers/types";

type Effort = NonNullable<Anthropic.Beta.BetaOutputConfig["effort"]>;

const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function readEffort(): Effort {
  const value = process.env.AGENT_EFFORT as Effort | undefined;
  return value && efforts.includes(value) ? value : "medium";
}

function readProvider(): ProviderName {
  const value = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (!value) return "anthropic";
  if ((providerNames as readonly string[]).includes(value)) return value as ProviderName;
  throw new Error(`AI_PROVIDER must be one of: ${providerNames.join(", ")} (got "${value}")`);
}

function readRetries(): number {
  const value = Number(process.env.AI_MAX_RETRIES);
  return Number.isInteger(value) && value >= 0 && value <= 10 ? value : 3;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** Which AI model API the agent uses: "anthropic" (Claude) or "gemini". */
  provider: readProvider(),
  /** Claude model, when AI_PROVIDER=anthropic. */
  model: process.env.AGENT_MODEL ?? "claude-opus-5-5",
  /** Gemini API key from Google AI Studio, when AI_PROVIDER=gemini. */
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  /** Gemini model, when AI_PROVIDER=gemini. */
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  /** Optional Gemini model to switch to when GEMINI_MODEL stays overloaded after all retries. */
  geminiFallbackModel: (process.env.GEMINI_FALLBACK_MODEL ?? "").trim(),
  /** Automatic retries of a model call on overload, rate limit or a dropped connection. */
  aiRetries: readRetries(),
  effort: readEffort(),
  maxTokens: 16000,
  /** How many past turns (user message + agent reply) of a conversation the model sees. */
  historyTurns: 20,
  /** Of those, how many latest turns keep their images and PDFs; older ones keep a note instead. */
  attachmentTurns: 3,
  /** Upper bound on model calls per user message (tool-use round trips). */
  maxIterations: 10,
  /** Request body cap; the Claude API rejects requests over 32 MB. */
  maxBodyBytes: 30 * 1024 * 1024,
  /** Postgres (Supabase) connection string. When unset, the local SQLite file is used. */
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** "off" disables TLS (local Postgres only). */
  databaseSsl: process.env.DATABASE_SSL ?? "",
  /** Path to the Supabase CA certificate, for a fully verified TLS connection. */
  databaseSslCa: process.env.DATABASE_SSL_CA ?? "",
  databasePoolSize: Number(process.env.DATABASE_POOL_SIZE ?? 5),
  /** SQLite file used when DATABASE_URL is unset; ":memory:" keeps everything in RAM. */
  dbPath: process.env.ARACHI_DB_PATH ?? "data/arachi.db",
  /** Resend API key. When unset, emails are only logged (local development). */
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  /** Sender address on a domain verified in Resend, e.g. "Arachi <rfq@example.com>". */
  emailFrom: process.env.EMAIL_FROM ?? "",
  /** Where carriers' email replies go, e.g. the team's real inbox. */
  emailReplyTo: process.env.EMAIL_REPLY_TO ?? "",
  /** Signing secret of the Resend webhook ("whsec_..."); optional, see routes/resendWebhook.ts. */
  resendWebhookSecret: (process.env.RESEND_WEBHOOK_SECRET ?? "").trim(),
  /**
   * Public address of the app, used in every link the app sends out (carrier
   * quote links, password reset, RFQ/panel pages). Locally it defaults to the
   * Vite dev UI; on the VPS docker-compose.yml sets it to https://APP_DOMAIN.
   */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL?.trim() || "http://localhost:5173").replace(/\/+$/, ""),
  /** Built UI (npm run build) served by this server in production; ignored when missing. */
  staticDir: process.env.STATIC_DIR ?? "dist",
  /** Secret for signing carrier links; generated and stored in the DB if unset. */
  linkSecret: process.env.ARACHI_LINK_SECRET ?? "",
  /**
   * Whether anyone may create an account once one exists. The VPS turns it off
   * in docker-compose.yml (ALLOW_SIGNUP=true in .env opens it again).
   */
  allowSignup: process.env.ALLOW_SIGNUP?.trim().toLowerCase() !== "false",
  /** Behind a reverse proxy (Caddy on the VPS): read the client address from X-Forwarded-For. */
  trustProxy: ["1", "true"].includes(process.env.TRUST_PROXY?.trim().toLowerCase() ?? ""),
  /**
   * arachi.co ilə birləşmə. ARACHI_API_URL və V2_SSO_SECRET təyin olunanda: giriş yalnız arachi.co-dan SSO ilə olur,
   * AI isə müştərinin RFQ, daşıyıcı və təkliflərini arachi.co-nun API-si vasitəsilə idarə edir (data arachi.co-dadır).
   */
  arachiApiUrl: (process.env.ARACHI_API_URL ?? "").trim().replace(/\/+$/, ""),
  /** arachi.co-nun ictimai ünvanı: giriş və "geri qayıt" linkləri üçün. */
  arachiSiteUrl: (process.env.ARACHI_SITE_URL?.trim() || "https://arachi.co").replace(/\/+$/, ""),
  /** arachi.co və v2 arasında ortaq gizli açar (arachi.co-dakı V2_SSO_SECRET ilə eyni olmalıdır). */
  ssoSecret: (process.env.V2_SSO_SECRET ?? "").trim(),
};

/** Whether this server works on top of arachi.co (SSO login, arachi.co data) instead of its own accounts and data. */
export function arachiMode(): boolean {
  return Boolean(config.arachiApiUrl && config.ssoSecret);
}

/** Who may show this app in a frame: only arachi.co (the AI opens inside its panel), nobody otherwise. */
export function frameAncestors(): string {
  if (!arachiMode()) return "'none'";
  try {
    return new URL(config.arachiSiteUrl).origin;
  } catch {
    return "'none'";
  }
}
