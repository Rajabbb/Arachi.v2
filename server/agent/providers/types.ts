import type { Attachment } from "../files";

/** A tool as offered to the model: name, description and a JSON Schema for its input. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema of an object (`type`, `properties`, `required`). */
  parameters: Record<string, unknown>;
}

/** A tool the model asked to run. */
export interface ToolCallRequest {
  /** Provider's id for the call, used to match the result to it. */
  id?: string;
  name: string;
  input: unknown;
}

export interface ToolCallResult {
  call: ToolCallRequest;
  /** Tool output (JSON text) or the error message. */
  content: string;
  ok: boolean;
}

/** What one model call produced, in provider-neutral terms. */
export type ModelStep<M> =
  /** The model answered; the turn is over. */
  | { kind: "answer"; message: M; text: string }
  /** The model wants these tools run before it continues. */
  | { kind: "tool_calls"; message: M; calls: ToolCallRequest[] }
  /** The model paused mid-turn and should be called again as is. */
  | { kind: "continue"; message: M }
  /** The turn can't finish; the transcript is left unchanged. */
  | { kind: "stopped"; reason: "refusal" | "max_tokens" | "other" };

/**
 * One AI model API behind the agent loop. The loop (conversation history,
 * attachments, tool use) is the same for every provider; a provider only
 * translates to and from its own message format. Messages of type M are
 * stored in the transcript the UI sends back, so they must be plain JSON.
 */
export interface ModelProvider<M = unknown> {
  readonly name: ProviderName;
  /** Model id, for logs. */
  readonly model: string;
  /** True when every message is in this provider's format (a transcript from another provider is not). */
  ownsTranscript(transcript: unknown[]): transcript is M[];
  userMessage(text: string, attachments: Attachment[]): M;
  generate(system: string, messages: M[], tools: ToolDefinition[]): Promise<ModelStep<M>>;
  /** All results of one tool_calls step, as the next message. */
  toolResults(results: ToolCallResult[]): M;
  /** HTTP status and Azerbaijani message for this provider's errors; null for other errors. */
  describeError(err: unknown): { status: number; message: string } | null;
}

export const providerNames = ["anthropic", "gemini"] as const;
export type ProviderName = (typeof providerNames)[number];
