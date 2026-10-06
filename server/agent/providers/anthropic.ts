import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config";
import type { Attachment } from "../files";
import type { ModelProvider, ModelStep, ToolCallResult, ToolDefinition } from "./types";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Block = Anthropic.Beta.BetaContentBlockParam;

function toBlock(a: Attachment): Block {
  switch (a.kind) {
    case "image":
      return { type: "image", source: { type: "base64", media_type: a.mimeType, data: a.data } };
    case "pdf":
      return {
        type: "document",
        title: a.name,
        source: { type: "base64", media_type: "application/pdf", data: a.data },
      };
    case "text":
      return {
        type: "document",
        title: a.name,
        source: { type: "text", media_type: "text/plain", data: a.text },
      };
    case "note":
      return { type: "text", text: a.text };
  }
}

/** Claude through the Anthropic API (ANTHROPIC_API_KEY). */
export class AnthropicProvider implements ModelProvider<MessageParam> {
  readonly name = "anthropic";
  readonly model = config.model;
  // Created on first use; reads ANTHROPIC_API_KEY from the server environment.
  private client?: Anthropic;

  ownsTranscript(transcript: unknown[]): transcript is MessageParam[] {
    return transcript.every((m) => typeof m === "object" && m !== null && "content" in m);
  }

  userMessage(text: string, attachments: Attachment[]): MessageParam {
    const content = attachments.map(toBlock);
    if (text.trim()) content.push({ type: "text", text });
    return { role: "user", content };
  }

  async generate(system: string, messages: MessageParam[], tools: ToolDefinition[]): Promise<ModelStep<MessageParam>> {
    this.client ??= new Anthropic();
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: config.maxTokens,
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema,
      })),
      messages,
      output_config: { effort: config.effort },
      cache_control: { type: "ephemeral" },
      // On a safety-classifier decline, retry on Anthropic's recommended model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const message: MessageParam = { role: "assistant", content: response.content };

    switch (response.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return {
          kind: "answer",
          message,
          text: response.content
            .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n\n"),
        };
      case "pause_turn":
        return { kind: "continue", message };
      case "tool_use":
        return {
          kind: "tool_calls",
          message,
          calls: response.content
            .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
            .map((b) => ({ id: b.id, name: b.name, input: b.input })),
        };
      case "refusal":
        return { kind: "stopped", reason: "refusal" };
      case "max_tokens":
        return { kind: "stopped", reason: "max_tokens" };
      default:
        return { kind: "stopped", reason: "other" };
    }
  }

  toolResults(results: ToolCallResult[]): MessageParam {
    return {
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.call.id ?? "",
        content: r.content,
        is_error: !r.ok,
      })),
    };
  }

  describeError(err: unknown) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { status: 500, message: "Serverdə ANTHROPIC_API_KEY qurulmayıb və ya etibarsızdır." };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { status: 429, message: "Hazırda sorğu limiti dolub, bir az sonra yenidən cəhd edin." };
    }
    if (err instanceof Anthropic.BadRequestError) {
      return { status: 400, message: `AI sorğunu qəbul etmədi: ${err.message}` };
    }
    if (err instanceof Anthropic.APIError) {
      return { status: 502, message: "AI xidməti ilə əlaqədə xəta baş verdi." };
    }
    return null;
  }
}
