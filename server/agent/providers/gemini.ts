import { ApiError, FinishReason, GoogleGenAI, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from "@google/genai";
import { config } from "../../config";
import type { Attachment } from "../files";
import { isNetworkError, overloadedMessage, withRetry, type Sleep } from "./retry";
import { removedNote, type ModelProvider, type ModelStep, type ToolCallResult, type ToolDefinition } from "./types";

/** Image types Gemini accepts inline (GIF is not one of them). */
const imageTypes = ["image/png", "image/jpeg", "image/webp"];

/** Finish reasons that mean the answer was blocked rather than cut short. */
const blocked: string[] = [
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
];

class MissingKeyError extends Error {}

/** API statuses that mean "busy or briefly down, try again later". */
const transientStatuses = [429, 500, 502, 503, 504];

function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) return transientStatuses.includes(err.status);
  return isNetworkError(err);
}

function toPart(a: Attachment): Part {
  switch (a.kind) {
    case "image":
      return imageTypes.includes(a.mimeType)
        ? { inlineData: { mimeType: a.mimeType, data: a.data } }
        : { text: `[Attached image "${a.name}" (${a.mimeType}) cannot be read: this format is not supported.]` };
    case "pdf":
      return { inlineData: { mimeType: "application/pdf", data: a.data } };
    case "text":
      return { text: `[Attached file "${a.name}"]\n${a.text}` };
    case "note":
      return { text: a.text };
  }
}

/** The one SDK call the provider makes; replaced by a fake in tests. */
export type GenerateContent = (params: GenerateContentParameters) => Promise<GenerateContentResponse>;

/** Google Gemini through the Gemini API (GEMINI_API_KEY). */
export class GeminiProvider implements ModelProvider<Content> {
  readonly name = "gemini";
  readonly model: string;
  /** Used when the main model is still busy after all retries; empty = none. */
  readonly fallbackModel: string;
  private generateContent?: GenerateContent;
  private retries: number;
  private sleep?: Sleep;

  constructor(
    options: { model?: string; fallbackModel?: string; generateContent?: GenerateContent; retries?: number; sleep?: Sleep } = {},
  ) {
    this.model = options.model ?? config.geminiModel;
    this.fallbackModel = options.fallbackModel ?? config.geminiFallbackModel;
    this.generateContent = options.generateContent;
    this.retries = options.retries ?? config.aiRetries;
    this.sleep = options.sleep;
  }

  ownsTranscript(transcript: unknown[]): transcript is Content[] {
    return transcript.every((m) => typeof m === "object" && m !== null && "parts" in m);
  }

  userMessage(text: string, attachments: Attachment[]): Content {
    const parts = attachments.map(toPart);
    if (text.trim()) parts.push({ text });
    return { role: "user", parts };
  }

  dropAttachments(message: Content): Content {
    const parts = (message.parts ?? []).map((p): Part =>
      p.inlineData ? { text: removedNote(p.inlineData.mimeType === "application/pdf" ? "a PDF file" : "an image") } : p,
    );
    return { ...message, parts };
  }

  private client(): GenerateContent {
    if (!this.generateContent) {
      if (!config.geminiApiKey) throw new MissingKeyError();
      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      this.generateContent = (params) => ai.models.generateContent(params);
    }
    return this.generateContent;
  }

  /** One call on `model`, retrying transient errors with exponential backoff. */
  private call(model: string, params: Omit<GenerateContentParameters, "model">): Promise<GenerateContentResponse> {
    const generate = this.client();
    return withRetry(() => generate({ ...params, model }), {
      retries: this.retries,
      baseDelayMs: 1000,
      isTransient,
      sleep: this.sleep,
      onRetry: (err, attempt, delayMs) =>
        console.warn(`Gemini (${model}) attempt ${attempt} failed, retrying in ${delayMs} ms:`, err instanceof Error ? err.message : err),
    });
  }

  /** Calls the main model, then the fallback model if the main one stays busy. */
  private async request(params: Omit<GenerateContentParameters, "model">): Promise<GenerateContentResponse> {
    try {
      return await this.call(this.model, params);
    } catch (err) {
      if (!this.fallbackModel || this.fallbackModel === this.model || !isTransient(err)) throw err;
      console.warn(`Gemini (${this.model}) still unavailable, switching to ${this.fallbackModel}:`, err instanceof Error ? err.message : err);
      return this.call(this.fallbackModel, params);
    }
  }

  async generate(system: string, messages: Content[], tools: ToolDefinition[]): Promise<ModelStep<Content>> {
    const response = await this.request({
      contents: messages,
      config: {
        systemInstruction: system,
        maxOutputTokens: config.maxTokens,
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ],
      },
    });

    if (response.promptFeedback?.blockReason) {
      return { kind: "stopped", reason: "refusal" };
    }
    const candidate = response.candidates?.[0];
    if (!candidate) return { kind: "stopped", reason: "other" };

    // Keep the model's content exactly as returned: its parts carry the
    // thought signatures Gemini needs back on the next call.
    const message: Content = { role: "model", parts: candidate.content?.parts ?? [] };
    const parts = message.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);

    if (calls.length > 0 && candidate.finishReason !== FinishReason.MAX_TOKENS) {
      return {
        kind: "tool_calls",
        message,
        calls: calls.map((c) => ({ id: c.id, name: c.name ?? "", input: c.args ?? {} })),
      };
    }

    const reason = candidate.finishReason ?? FinishReason.STOP;
    if (reason === FinishReason.STOP) {
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("");
      return { kind: "answer", message, text };
    }
    if (reason === FinishReason.MAX_TOKENS) return { kind: "stopped", reason: "max_tokens" };
    if (blocked.includes(reason)) return { kind: "stopped", reason: "refusal" };
    return { kind: "stopped", reason: "other" };
  }

  toolResults(results: ToolCallResult[]): Content {
    return {
      role: "user",
      parts: results.map((r) => ({
        functionResponse: {
          ...(r.call.id ? { id: r.call.id } : {}),
          name: r.call.name,
          response: r.ok ? { output: r.content } : { error: r.content },
        },
      })),
    };
  }

  describeError(err: unknown) {
    if (err instanceof MissingKeyError) {
      return { status: 500, message: "Serverdə GEMINI_API_KEY qurulmayıb." };
    }
    if (isNetworkError(err)) return { status: 503, message: overloadedMessage };
    if (!(err instanceof ApiError)) return null;
    if (err.status === 401 || err.status === 403 || /API key/i.test(err.message)) {
      return { status: 500, message: "Serverdəki GEMINI_API_KEY etibarsızdır və ya bu modelə icazəsi yoxdur." };
    }
    if (err.status === 429) {
      return { status: 429, message: "Gemini sorğu limiti dolub, bir az sonra yenidən cəhd edin." };
    }
    if (err.status === 400 || err.status === 404) {
      return { status: 400, message: `AI sorğunu qəbul etmədi: ${err.message}` };
    }
    if (err.status >= 500) return { status: 503, message: overloadedMessage };
    return { status: 502, message: "AI xidməti ilə əlaqədə xəta baş verdi." };
  }
}
