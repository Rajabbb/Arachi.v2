import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { setProvider } from "../agent/providers";
import type { ModelProvider, ModelStep } from "../agent/providers/types";
import { freshDb, textFile } from "../test/helpers";
import type { ChatResponse, ConversationData, ConversationListData, UploadedFile } from "../../shared/protocol";

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
afterEach(() => setProvider(undefined));

type Msg = { fake: string };

/** Answers every message with "Cavab N" and records what the model was sent. */
function fakeProvider(fail = false) {
  const seen: string[][] = [];
  let n = 0;
  const provider: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text, attachments) => ({ fake: `user:${text}:${attachments.length}` }),
    dropAttachments: (m) => m,
    async generate(_system, messages): Promise<ModelStep<Msg>> {
      seen.push(messages.map((m) => m.fake));
      if (fail) throw new Error("AI is down");
      n++;
      return { kind: "answer", message: { fake: `answer:${n}` }, text: `Cavab ${n}` };
    },
    toolResults: () => ({ fake: "results" }),
    describeError: () => null,
  };
  setProvider(provider as ModelProvider);
  return seen;
}

/** A signed-in browser for a newly registered user. */
async function signUp(email: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    body: JSON.stringify({ email, password: "parol1234", name: "" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const request = async <T>(method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as T };
  };
  return {
    chat: (text: string, conversationId: number | null = null, files: UploadedFile[] = []) =>
      request<ChatResponse & { error?: string }>("POST", "/api/chat", { conversationId, message: { text, files } }),
    list: () => request<ConversationListData>("GET", "/api/conversations"),
    get: (id: number) => request<ConversationData>("GET", `/api/conversations/${id}`),
    remove: (id: number) => request<{ ok: boolean }>("DELETE", `/api/conversations/${id}`),
  };
}

let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  alice = await signUp("alice@arachi.az");
  bob = await signUp("bob@arachi.az");
});

test("a first message starts a saved conversation titled after it", async () => {
  fakeProvider();
  const long = "Bakıdan   Tbilisiyə 5 ton şərab üçün RFQ yarat, daşıyıcılara göndər və təklifləri müqayisə et";
  const first = await alice.chat(long);
  assert.equal(first.status, 200);
  assert.equal(first.body.reply, "Cavab 1");

  const { body } = await alice.list();
  assert.equal(body.conversations.length, 1);
  const title = body.conversations[0].title;
  assert.ok(title.startsWith("Bakıdan Tbilisiyə 5 ton"), title);
  assert.ok(title.length <= 60 && title.endsWith("…"), title);

  const saved = await alice.get(first.body.conversationId);
  assert.deepEqual(saved.body.messages.map((m) => [m.role, m.text]), [["user", long], ["assistant", "Cavab 1"]]);
});

test("continuing a conversation gives the AI its earlier turns; a new one starts empty", async () => {
  const seen = fakeProvider();
  const first = await alice.chat("Salam");
  const id = first.body.conversationId;
  await alice.chat("Davam", id);
  assert.deepEqual(seen[1], ["user:Salam:0", "answer:1", "user:Davam:0"]);

  const other = await alice.chat("Başqa mövzu");
  assert.notEqual(other.body.conversationId, id);
  assert.deepEqual(seen[2], ["user:Başqa mövzu:0"]);

  // Most recently used first.
  await alice.chat("Yenə birinci", id);
  assert.deepEqual((await alice.list()).body.conversations.map((c) => c.id), [id, other.body.conversationId]);
});

test("attachment names and sizes are saved, not the files", async () => {
  fakeProvider();
  const res = await alice.chat("", null, [textFile("yuk.csv", "a,b\n1,2", "text/csv")]);
  const saved = await alice.get(res.body.conversationId);
  assert.deepEqual(saved.body.messages[0].attachments, [{ name: "yuk.csv", size: 7, type: "text/csv" }]);
  assert.equal(saved.body.conversation.title, "yuk.csv");
});

test("users never see, continue or delete each other's conversations", async () => {
  fakeProvider();
  const id = (await alice.chat("Alicenin sirri")).body.conversationId;

  assert.deepEqual((await bob.list()).body.conversations, []);
  assert.equal((await bob.get(id)).status, 404);
  assert.equal((await bob.chat("oğurla", id)).status, 404);
  assert.equal((await bob.remove(id)).status, 404);

  const saved = await alice.get(id);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.messages.length, 2);
});

test("deleting removes the conversation and its messages", async () => {
  fakeProvider();
  const id = (await alice.chat("Silinəcək")).body.conversationId;
  const keep = (await alice.chat("Qalacaq")).body.conversationId;

  assert.equal((await alice.remove(id)).status, 200);
  assert.equal((await alice.get(id)).status, 404);
  assert.deepEqual((await alice.list()).body.conversations.map((c) => c.id), [keep]);
  const left = await db().get<{ n: number }>("SELECT count(*) AS n FROM conversation_messages WHERE conversation_id = ?", id);
  assert.equal(Number(left!.n), 0);
});

test("when the AI fails, the message is kept and the error names its conversation", async () => {
  fakeProvider(true);
  const res = await alice.chat("Salam");
  assert.equal(res.status, 500);
  assert.ok(res.body.error);
  const id = (res.body as unknown as { conversationId: number }).conversationId;
  const saved = await alice.get(id);
  assert.deepEqual(saved.body.messages.map((m) => m.role), ["user"]);
});

test("chat needs a login", async () => {
  const res = await fetch(`${base}/api/conversations`);
  assert.equal(res.status, 401);
});
