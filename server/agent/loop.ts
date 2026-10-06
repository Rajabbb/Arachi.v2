import type { ChatResponse, ToolCallSummary, UploadedFile } from "../../shared/protocol";
import { config } from "../config";
import { systemPrompt } from "./prompt";
import { toAttachment } from "./files";
import { provider as defaultProvider } from "./providers";
import type { ModelProvider } from "./providers/types";
import { tools } from "./tools";
import { emptyContext } from "./tools/registry";

export class AgentError extends Error {}

/**
 * Runs one user turn: appends the user's message to the transcript, calls
 * the model, executes any tools it asks for, and repeats until it answers.
 * The loop is the same for every provider; the transcript holds messages in
 * the provider's own format.
 *
 * The transcript is append-only (Claude's thinking blocks and Gemini's
 * thought signatures are bound to the exact history that produced them). If
 * the turn can't finish cleanly, the previous transcript is returned
 * unchanged so the next turn starts from a valid state.
 */
export async function runTurn<M>(
  previous: unknown[],
  text: string,
  files: UploadedFile[],
  provider: ModelProvider<M> = defaultProvider() as ModelProvider<M>,
): Promise<ChatResponse> {
  const attachments = await Promise.all(files.map(toAttachment));
  if (attachments.length === 0 && !text.trim()) {
    throw new AgentError("Mesaj boşdur.");
  }

  // A conversation started with another provider can't be continued here
  // (the formats differ), so it starts over.
  const transcript: M[] = provider.ownsTranscript(previous) ? previous : [];
  const messages: M[] = [...transcript, provider.userMessage(text, attachments)];
  const toolCalls: ToolCallSummary[] = [];
  const definitions = tools.definitions();
  const ctx = emptyContext(files);

  const abort = (reply: string): ChatResponse => ({
    reply,
    transcript,
    toolCalls,
    downloads: ctx.downloads,
  });

  for (let i = 0; i < config.maxIterations; i++) {
    const step = await provider.generate(systemPrompt, messages, definitions);

    switch (step.kind) {
      case "answer":
        messages.push(step.message);
        return {
          reply: step.text.trim() || "Hazırdır.",
          transcript: messages,
          toolCalls,
          downloads: ctx.downloads,
        };

      case "continue":
        messages.push(step.message);
        continue;

      case "tool_calls": {
        messages.push(step.message);
        const results = await Promise.all(
          step.calls.map(async (call) => {
            const run = await tools.execute(call.name, call.input, ctx);
            toolCalls.push({
              name: call.name,
              params: run.params,
              overrides: run.overrides,
              ok: run.ok,
            });
            return { call, content: run.content, ok: run.ok };
          }),
        );
        // All results go back in a single message.
        messages.push(provider.toolResults(results));
        continue;
      }

      case "stopped":
        switch (step.reason) {
          case "refusal":
            return abort(
              "Bu sorğunu yerinə yetirə bilmirəm. Zəhmət olmasa onu başqa cür ifadə edin.",
            );
          case "max_tokens":
            return abort(
              "Cavab çox uzun alındı və yarımçıq qaldı. Tapşırığı daha kiçik hissələrə bölüb yenidən cəhd edin.",
            );
          default:
            return abort("Gözlənilməz cavab alındı, zəhmət olmasa yenidən cəhd edin.");
        }
    }
  }

  return abort(
    "Tapşırıq gözləniləndən çox addım tələb etdi və dayandırıldı. Zəhmət olmasa onu sadələşdirib yenidən cəhd edin.",
  );
}
