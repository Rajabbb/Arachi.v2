import { config } from "../../config";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import type { ModelProvider } from "./types";

let current: ModelProvider | undefined;

/** The provider chosen with AI_PROVIDER (anthropic by default). */
export function provider(): ModelProvider {
  current ??= config.provider === "gemini" ? new GeminiProvider() : new AnthropicProvider();
  return current;
}

/** Replaces the provider (tests use a scripted fake); undefined goes back to AI_PROVIDER. */
export function setProvider(next: ModelProvider | undefined) {
  current = next;
}
