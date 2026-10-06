import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";

const attachments = [
  { kind: "image", name: "foto.png", mimeType: "image/png", data: "AAAA" },
  { kind: "pdf", name: "invoice.pdf", data: "BBBB" },
  { kind: "text", name: "yuk.csv", text: "a,b" },
] as const;

test("old turns keep their text but not their images and PDFs", () => {
  for (const provider of [new AnthropicProvider(), new GeminiProvider()]) {
    const message = provider.userMessage("Bax", [...attachments]);
    const json = JSON.stringify(provider.dropAttachments(message as never));
    assert.ok(!json.includes("AAAA") && !json.includes("BBBB"), provider.name);
    assert.ok(json.includes("a,b") && json.includes("Bax"), provider.name);
    assert.match(json, /attach it again/, provider.name);
  }
});
