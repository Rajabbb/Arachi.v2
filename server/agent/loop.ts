import Anthropic from "@anthropic-ai/sdk";
import type { ChatResponse, ToolCallSummary, UploadedFile } from "../../shared/protocol";
import { config } from "../config";
import { systemPrompt } from "./prompt";
import { userContent } from "./files";
import { tools } from "./tools";
import { emptyContext } from "./tools/registry";

type MessageParam = Anthropic.Beta.BetaMessageParam;

// Reads ANTHROPIC_API_KEY from the server environment; never sent to the browser.
const client = new Anthropic();

export class AgentError extends Error {}

/**
 * Runs one user turn: appends the user's message to the transcript, calls
 * Claude, executes any tools it asks for, and repeats until Claude answers.
 *
 * The transcript is append-only (thinking blocks are bound to the exact
 * history that produced them). If the turn can't finish cleanly, the
 * previous transcript is returned unchanged so the next turn starts from a
 * valid state.
 */
export async function runTurn(
  transcript: MessageParam[],
  text: string,
  files: UploadedFile[],
): Promise<ChatResponse> {
  const content = userContent(text, files);
  if (content.length === 0) {
    throw new AgentError("Mesaj boşdur.");
  }

  const messages: MessageParam[] = [...transcript, { role: "user", content }];
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
    const response = await client.beta.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      tools: definitions,
      messages,
      output_config: { effort: config.effort },
      cache_control: { type: "ephemeral" },
      // On a safety-classifier decline, retry on Anthropic's recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    switch (response.stop_reason) {
      case "end_turn":
      case "stop_sequence": {
        messages.push({ role: "assistant", content: response.content });
        const reply = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n\n")
          .trim();
        return {
          reply: reply || "Hazırdır.",
          transcript: messages,
          toolCalls,
          downloads: ctx.downloads,
        };
      }

      case "pause_turn":
        messages.push({ role: "assistant", content: response.content });
        continue;

      case "tool_use": {
        messages.push({ role: "assistant", content: response.content });
        const uses = response.content.filter(
          (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
        );
        // All results go back in a single user message.
        const results = await Promise.all(
          uses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
            const run = await tools.execute(use.name, use.input, ctx);
            toolCalls.push({
              name: use.name,
              params: run.params,
              overrides: run.overrides,
              ok: run.ok,
            });
            return {
              type: "tool_result",
              tool_use_id: use.id,
              content: run.content,
              is_error: !run.ok,
            };
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }

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

  return abort(
    "Tapşırıq gözləniləndən çox addım tələb etdi və dayandırıldı. Zəhmət olmasa onu sadələşdirib yenidən cəhd edin.",
  );
}
