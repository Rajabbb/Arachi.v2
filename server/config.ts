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
  /** SQLite file; ":memory:" keeps everything in RAM (tests). */
  dbPath: process.env.ARACHI_DB_PATH ?? "data/arachi.db",
  /** Address of the UI, used to build links sent to carriers. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  /** Secret for signing carrier links; generated and stored in the DB if unset. */
  linkSecret: process.env.ARACHI_LINK_SECRET ?? "",
};
