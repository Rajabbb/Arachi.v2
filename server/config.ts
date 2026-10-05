import type Anthropic from "@anthropic-ai/sdk";

type Effort = NonNullable<Anthropic.Beta.BetaOutputConfig["effort"]>;

const efforts: Effort[] = ["low", "medium", "high", "xhigh", "max"];

function readEffort(): Effort {
  const value = process.env.AGENT_EFFORT as Effort | undefined;
  return value && efforts.includes(value) ? value : "medium";
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  model: process.env.AGENT_MODEL ?? "claude-opus-5-5",
  effort: readEffort(),
  maxTokens: 16000,
  /** Upper bound on model calls per user message (tool-use round trips). */
  maxIterations: 10,
  /** Request body cap; the Claude API itself rejects requests over 32 MB. */
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
  /** Address of the UI, used to build links sent to carriers. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  /** Secret for signing carrier links; generated and stored in the DB if unset. */
  linkSecret: process.env.ARACHI_LINK_SECRET ?? "",
};
