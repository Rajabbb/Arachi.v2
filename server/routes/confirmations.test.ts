import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { setProvider } from "../agent/providers";
import type { ModelProvider, ModelStep } from "../agent/providers/types";
import { call, freshDb } from "../test/helpers";
import { arachiData, installFakeArachi, signIn } from "../test/fakeArachi";
import type { ChatResponse, ConfirmationResponse, ConversationData } from "../../shared/protocol";

/** Messages to carriers wait for the user's "Bəli"; the agent alone cannot send them. */

let server: Server;
let base: string;
let restore: () => void;

before(async () => {
  restore = installFakeArachi();
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  restore();
});
afterEach(() => setProvider(undefined));

type Msg = { fake: string };

/** On each user message: calls the given tool once, then answers; records what it was sent. */
function toolCallingProvider(name: string, input: Record<string, unknown>) {
  const seen: string[] = [];
  const provider: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(_system, messages): Promise<ModelStep<Msg>> {
      const last = messages[messages.length - 1].fake;
      seen.push(last);
      if (last.startsWith("user:")) return { kind: "tool_calls", message: { fake: "calls" }, calls: [{ id: "1", name, input }] };
      return { kind: "answer", message: { fake: "answer" }, text: "Bəli düyməsini basın." };
    },
    toolResults: (results) => ({ fake: `results:${results.map((r) => r.content).join("|")}` }),
    describeError: () => null,
  };
  setProvider(provider as ModelProvider);
  return seen;
}

let cookie: string;
let userId: number;
async function request<T>(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as T };
}

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  ({ cookie, userId } = await signIn(1));
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 500 }, undefined, userId);
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Evil", email: "x@evil.example" }] }, undefined, userId);
});

test("the agent's send waits for Bəli, which sends exactly what was shown", async () => {
  const seen = toolCallingProvider("send_rfq_to_carriers", { rfq_id: 1 });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  assert.equal(chat.status, 200);
  assert.equal(arachiData.mails.length, 0, "nothing sent before Bəli");
  assert.match(seen[1], /waiting_for_user/);
  const [c] = chat.body.confirmations;
  assert.equal(c.status, "pending");
  assert.match(c.text, /2 daşıyıcıya/);
  assert.match(c.text, /x@evil\.example/, "the user sees every address");

  // A carrier added afterwards is not included: the confirmed list is frozen.
  await call("add_carriers", { carriers: [{ name: "Late", email: "late@x.az" }] }, undefined, userId);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.confirmation.status, "done");
  assert.match(yes.body.message!.text, /2 daşıyıcıya göndərildi/);
  assert.deepEqual(arachiData.mails.map((m) => m.to).sort(), ["a@road.az", "x@evil.example"]);

  // A second click cannot send again.
  assert.equal((await request("POST", `/api/confirmations/${c.id}`, { approve: true })).status, 409);
  assert.equal(arachiData.mails.length, 2);

  // The saved chat shows the card with its status, and the agent hears the outcome next turn.
  const saved = await request<ConversationData>("GET", `/api/conversations/${chat.body.conversationId}`);
  assert.equal(saved.body.messages[1].confirmations![0].status, "done");
  await request("POST", "/api/chat", { conversationId: chat.body.conversationId, message: { text: "sonra?", files: [] } });
  assert.match(seen.find((s) => s.includes("sonra?"))!, /pressed "Bəli".*2 daşıyıcıya göndərildi/s);
});

test("Xeyr sends nothing, and nobody else can answer the confirmation", async () => {
  toolCallingProvider("send_reminders", { rfq_id: 1 });
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, userId);
  arachiData.mails.length = 0;
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "xatırlat", files: [] } });
  const [c] = chat.body.confirmations;
  assert.match(c.text, /2 daşıyıcıya xatırlatma/);

  const mine = cookie;
  cookie = (await signIn(2, "Başqa MMC")).cookie;
  assert.equal((await request("POST", `/api/confirmations/${c.id}`, { approve: true })).status, 404);
  cookie = mine;

  const no = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: false });
  assert.equal(no.body.confirmation.status, "declined");
  assert.equal(arachiData.mails.length, 0);
});

test("confirming after the arachi.co session ended fails cleanly and sends nothing", async () => {
  toolCallingProvider("send_rfq_to_carriers", { rfq_id: 1 });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  arachiData.failWith = 401;
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${chat.body.confirmations[0].id}`, { approve: true });
  arachiData.failWith = 0;
  assert.equal(yes.body.confirmation.status, "failed");
  assert.match(yes.body.message!.text, /Alınmadı.*yenidən/);
  assert.equal(arachiData.mails.length, 0);
});

test("selecting a winner runs at once, with no confirmation card", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, userId);
  const q = arachiData.quotes[0];
  Object.assign(q, { price: 900, transit_time_days: 5, currency: "USD" });
  toolCallingProvider("select_winner", { rfq_id: 1, offer_id: q.id });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "qalibi seç", files: [] } });
  assert.equal(chat.body.confirmations.length, 0);
  assert.equal(arachiData.rfqs[0].status, "closed");
});

test("asking for the same send twice in one turn shows one card", async () => {
  const twice: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (_t): _t is Msg[] => true,
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(_s, messages): Promise<ModelStep<Msg>> {
      const calls = messages.filter((m) => m.fake === "calls").length;
      if (calls < 2) return { kind: "tool_calls", message: { fake: "calls" }, calls: [{ id: "1", name: "send_rfq_to_carriers", input: { rfq_id: 1 } }] };
      return { kind: "answer", message: { fake: "answer" }, text: "ok" };
    },
    toolResults: () => ({ fake: "results" }),
    describeError: () => null,
  };
  setProvider(twice as ModelProvider);
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  assert.equal(chat.body.confirmations.length, 1);
  assert.equal(Number((await db().get<{ n: number }>("SELECT count(*) AS n FROM confirmations"))!.n), 1);
});
