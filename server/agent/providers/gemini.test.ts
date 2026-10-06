import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { ApiError } from "@google/genai";
import { freshDb } from "../../test/helpers";
import { runTurn } from "../loop";
import { GeminiProvider } from "./gemini";

beforeEach(freshDb);

/** A Gemini that replays scripted responses and records every request. */
function fakeGemini(responses: object[]) {
  const requests: GenerateContentParameters[] = [];
  const provider = new GeminiProvider({
    model: "gemini-test",
    generateContent: async (params) => {
      requests.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("no more scripted responses");
      return next as GenerateContentResponse;
    },
  });
  return { provider, requests };
}

const answer = (text: string) => ({
  candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }],
});

test("runs registry tools through Gemini function calling", async () => {
  const { provider, requests } = fakeGemini([
    {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [
              { text: "thinking", thought: true },
              {
                functionCall: {
                  id: "call-1",
                  name: "create_rfq",
                  args: { origin: "Bakı", destination: "Tbilisi", cargo_type: "Xalça", weight_kg: 1200 },
                },
                thoughtSignature: "sig-1",
              },
            ],
          },
        },
      ],
    },
    answer("RFQ yaradıldı."),
  ]);

  const res = await runTurn([], "Bakıdan Tbilisiyə 1200 kq xalça", [], provider);

  assert.equal(res.reply, "RFQ yaradıldı.");
  assert.deepEqual(res.toolCalls.map((c) => [c.name, c.ok, c.params.currency]), [["create_rfq", true, "USD"]]);

  // Tools are declared from the shared registry as JSON Schema.
  const declarations = requests[0].config!.tools![0] as { functionDeclarations: { name: string; parametersJsonSchema: { required: string[] } }[] };
  const createRfq = declarations.functionDeclarations.find((d) => d.name === "create_rfq")!;
  assert.deepEqual(createRfq.parametersJsonSchema.required, ["origin", "destination", "cargo_type", "weight_kg"]);
  assert.match(String(requests[0].config!.systemInstruction), /Arachi AI agent/);

  // Second call: the model turn comes back unchanged (with its thought
  // signature), followed by the function response matched by id and name.
  const contents = requests[1].contents as Content[];
  assert.equal(contents.length, 3);
  assert.equal(contents[1].parts![1].thoughtSignature, "sig-1");
  const response = contents[2].parts![0].functionResponse!;
  assert.equal(response.id, "call-1");
  assert.equal(response.name, "create_rfq");
  assert.match(String(response.response!.output), /Tbilisi/);

  // The transcript continues the conversation on the next turn.
  const { provider: next, requests: nextRequests } = fakeGemini([answer("Bəli.")]);
  const res2 = await runTurn(res.transcript, "Hazırdır?", [], next);
  assert.equal(res2.reply, "Bəli.");
  assert.equal((nextRequests[0].contents as Content[]).length, 5);
});

test("tool errors go back as an error response", async () => {
  const { provider, requests } = fakeGemini([
    {
      candidates: [
        { finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "create_rfq", args: { origin: "Bakı" } } }] } },
      ],
    },
    answer("Təyinat yeri lazımdır."),
  ]);
  const res = await runTurn([], "RFQ", [], provider);
  assert.equal(res.toolCalls[0].ok, false);
  const response = (requests[1].contents as Content[])[2].parts![0].functionResponse!;
  assert.equal(response.id, undefined);
  assert.match(String(response.response!.error), /Missing required parameter/);
});

test("attachments become inline data and text parts", async () => {
  const { provider, requests } = fakeGemini([answer("Oxudum.")]);
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  await runTurn([], "Bax", [
    { name: "a.png", type: "image/png", data: b64("png") },
    { name: "b.pdf", type: "application/pdf", data: b64("pdf") },
    { name: "c.csv", type: "text/csv", data: b64("Bakı,Milan") },
    { name: "d.gif", type: "image/gif", data: b64("gif") },
    { name: "e.docx", type: "application/msword", data: b64("doc") },
  ], provider);

  const parts = (requests[0].contents as Content[])[0].parts!;
  assert.deepEqual(parts[0], { inlineData: { mimeType: "image/png", data: b64("png") } });
  assert.deepEqual(parts[1], { inlineData: { mimeType: "application/pdf", data: b64("pdf") } });
  assert.match(parts[2].text!, /c\.csv[\s\S]*Bakı,Milan/);
  assert.match(parts[3].text!, /d\.gif.*not supported/);
  assert.match(parts[4].text!, /e\.docx.*not supported/);
  assert.deepEqual(parts[5], { text: "Bax" });
});

test("blocked or cut-off answers leave the transcript unchanged", async () => {
  const { provider } = fakeGemini([
    { candidates: [{ finishReason: "SAFETY", content: { role: "model", parts: [] } }] },
    { candidates: [{ finishReason: "MAX_TOKENS", content: { role: "model", parts: [{ text: "yarım" }] } }] },
    { promptFeedback: { blockReason: "PROHIBITED_CONTENT" } },
  ]);
  const earlier: Content[] = [{ role: "user", parts: [{ text: "salam" }] }, { role: "model", parts: [{ text: "Salam!" }] }];

  const refused = await runTurn(earlier, "x", [], provider);
  assert.match(refused.reply, /yerinə yetirə bilmirəm/);
  assert.deepEqual(refused.transcript, earlier);

  const cut = await runTurn(earlier, "x", [], provider);
  assert.match(cut.reply, /yarımçıq/);
  assert.deepEqual(cut.transcript, earlier);

  const blocked = await runTurn(earlier, "x", [], provider);
  assert.match(blocked.reply, /yerinə yetirə bilmirəm/);
});

test("a transcript from another provider starts a new conversation", async () => {
  const { provider, requests } = fakeGemini([answer("Salam!")]);
  const claudeTranscript = [{ role: "user", content: [{ type: "text", text: "köhnə" }] }];
  const res = await runTurn(claudeTranscript, "salam", [], provider);
  assert.equal((requests[0].contents as Content[]).length, 1);
  assert.equal(res.transcript.length, 2);
});

test("errors are explained in Azerbaijani", () => {
  const provider = new GeminiProvider();
  assert.match(provider.describeError(new ApiError({ status: 400, message: "API key not valid" }))!.message, /GEMINI_API_KEY/);
  assert.equal(provider.describeError(new ApiError({ status: 429, message: "quota" }))!.status, 429);
  assert.equal(provider.describeError(new Error("other")), null);
});

/** A Gemini whose calls follow `script` (an error to throw or a response), without real waiting. */
function flakyGemini(script: (Error | object)[], options: { fallbackModel?: string; retries?: number } = {}) {
  const models: string[] = [];
  const delays: number[] = [];
  const provider = new GeminiProvider({
    model: "gemini-main",
    fallbackModel: options.fallbackModel ?? "",
    retries: options.retries ?? 3,
    sleep: async (ms) => {
      delays.push(ms);
    },
    generateContent: async (params) => {
      models.push(params.model);
      const next = script.shift();
      if (!next) throw new Error("no more scripted responses");
      if (next instanceof Error) throw next;
      return next as GenerateContentResponse;
    },
  });
  return { provider, models, delays };
}

const unavailable = () =>
  new ApiError({ status: 503, message: '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}' });

test("retries 503, 429 and dropped connections with growing delays", async () => {
  const dropped = new TypeError("fetch failed", { cause: Object.assign(new Error("socket"), { code: "ECONNRESET" }) });
  const { provider, models, delays } = flakyGemini([unavailable(), new ApiError({ status: 429, message: "quota" }), dropped, answer("Salam")]);

  const res = await runTurn([], "Salam", [], provider);

  assert.equal(res.reply, "Salam");
  assert.deepEqual(models, ["gemini-main", "gemini-main", "gemini-main", "gemini-main"]);
  assert.equal(delays.length, 3);
  assert.ok(delays[0] >= 1000 && delays[1] >= 2000 && delays[2] >= 4000, `delays ${delays}`);
});

test("does not retry request errors", async () => {
  const { provider, models } = flakyGemini([new ApiError({ status: 400, message: "bad request" }), answer("never")]);

  await assert.rejects(runTurn([], "Salam", [], provider), (err: unknown) => err instanceof ApiError && err.status === 400);
  assert.deepEqual(models, ["gemini-main"]);
});

test("switches to GEMINI_FALLBACK_MODEL when the main model stays unavailable", async () => {
  const { provider, models } = flakyGemini([unavailable(), unavailable(), unavailable(), answer("Ehtiyat modeldən")], {
    fallbackModel: "gemini-lite",
    retries: 2,
  });

  const res = await runTurn([], "Salam", [], provider);

  assert.equal(res.reply, "Ehtiyat modeldən");
  assert.deepEqual(models, ["gemini-main", "gemini-main", "gemini-main", "gemini-lite"]);
});

test("gives a clear message once every retry is used up", async () => {
  const { provider, models } = flakyGemini([unavailable(), unavailable(), unavailable(), unavailable()], { retries: 3 });

  const err = await runTurn([], "Salam", [], provider).catch((e: unknown) => e);

  assert.equal(models.length, 4);
  assert.deepEqual(provider.describeError(err), {
    status: 503,
    message: "AI xidməti müvəqqəti yüklənib, bir az sonra yenidən cəhd edin.",
  });
});
