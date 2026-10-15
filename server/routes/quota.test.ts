import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { setProvider } from "../agent/providers";
import type { ModelProvider, ModelStep } from "../agent/providers/types";
import { consumeRequest, periodKey, quotaFor } from "../domain/quota";
import { freshDb } from "../test/helpers";
import type { ChatResponse, ConversationListData } from "../../shared/protocol";

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

function fakeProvider() {
  let n = 0;
  const provider: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text, attachments) => ({ fake: `user:${text}:${attachments.length}` }),
    dropAttachments: (m) => m,
    async generate(): Promise<ModelStep<Msg>> {
      n++;
      return { kind: "answer", message: { fake: `answer:${n}` }, text: `Cavab ${n}` };
    },
    toolResults: () => ({ fake: "results" }),
    describeError: () => null,
  };
  setProvider(provider as ModelProvider);
}

async function signUp(email: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    body: JSON.stringify({ email, password: "parol1234", name: "" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const request = async <T>(method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as T };
  };
  const id = Number((await db().get<{ id: number }>("SELECT id FROM users WHERE lower(email) = ?", email.toLowerCase()))!.id);
  return {
    id,
    chat: (text: string, conversationId: number | null = null) =>
      request<ChatResponse & { error?: string }>("POST", "/api/chat", { conversationId, message: { text, files: [] } }),
    list: () => request<ConversationListData>("GET", "/api/conversations"),
    remove: (cid: number) => request<{ ok: boolean }>("DELETE", `/api/conversations/${cid}`),
    me: () => request<{ user: { quota?: { limit: number | null; used: number; remaining: number | null; expired: boolean; plan: string } } }>("GET", "/api/auth/me"),
  };
}

async function setPlan(userId: number, sub: { plan: string; label?: string; limit: number | null; period?: "month" | "total"; trialEnds?: string | null }) {
  await db().run(
    "UPDATE users SET sub_plan = ?, sub_label = ?, sub_ai_limit = ?, sub_ai_period = ?, sub_trial_ends_at = ? WHERE id = ?",
    sub.plan, sub.label ?? sub.plan, sub.limit, sub.period ?? "month", sub.trialEnds ?? null, userId,
  );
}

let user: Awaited<ReturnType<typeof signUp>>;

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  user = await signUp("quota@arachi.az");
  fakeProvider();
});

test("a user without a plan is not limited and has no quota", async () => {
  assert.equal(await quotaFor(user.id), null);
  for (let i = 0; i < 3; i++) assert.equal((await user.chat(`mesaj ${i}`)).status, 200);
  assert.equal((await user.me()).body.user.quota, undefined);
});

test("the demo allowance counts every message and refuses the one after the limit", async () => {
  await setPlan(user.id, { plan: "demo", label: "Demo", limit: 3, period: "total" });
  const first = await user.chat("bir");
  assert.equal(first.status, 200);
  assert.equal(first.body.quota?.used, 1);
  assert.equal(first.body.quota?.remaining, 2);
  assert.equal((await user.chat("iki", first.body.conversationId)).status, 200);
  const third = await user.chat("üç", first.body.conversationId);
  assert.equal(third.status, 200);
  assert.equal(third.body.quota?.remaining, 0);

  const fourth = await user.chat("dörd", first.body.conversationId);
  assert.equal(fourth.status, 402);
  assert.match(fourth.body.error ?? "", /limiti dolub/);
  // The refused message is neither saved nor counted.
  assert.equal((await quotaFor(user.id))?.used, 3);
});

test("deleting a conversation does not give the requests back", async () => {
  await setPlan(user.id, { plan: "demo", limit: 2, period: "total" });
  const a = await user.chat("bir");
  assert.equal((await user.chat("iki", a.body.conversationId)).status, 200);
  assert.equal((await user.remove(a.body.conversationId)).status, 200);
  const blocked = await user.chat("üç");
  assert.equal(blocked.status, 402);
  assert.equal((await quotaFor(user.id))?.used, 2);
});

test("an ended demo refuses messages with the payment hint", async () => {
  await setPlan(user.id, { plan: "demo", limit: 100, period: "total", trialEnds: new Date(Date.now() - 86_400_000).toISOString() });
  const res = await user.chat("salam");
  assert.equal(res.status, 402);
  assert.match(res.body.error ?? "", /Demo müddətiniz bitib/);
  assert.equal((await user.me()).body.user.quota?.expired, true);
  assert.equal((await user.list()).body.conversations.length, 0);
});

test("a demo end time without a timezone is read as UTC", async () => {
  const future = new Date(Date.now() + 5 * 86_400_000).toISOString().replace("Z", "");
  await setPlan(user.id, { plan: "demo", limit: 100, period: "total", trialEnds: future });
  assert.equal((await quotaFor(user.id))?.expired, false);
  const past = new Date(Date.now() - 60_000).toISOString().replace("Z", "");
  await setPlan(user.id, { plan: "demo", limit: 100, period: "total", trialEnds: past });
  assert.equal((await quotaFor(user.id))?.expired, true);
});

test("a monthly plan renews with the calendar month", async () => {
  await setPlan(user.id, { plan: "standart", label: "Standart", limit: 2, period: "month" });
  const oct = new Date("2026-10-20T10:00:00Z");
  await consumeRequest(user.id, oct);
  await consumeRequest(user.id, oct);
  await assert.rejects(() => consumeRequest(user.id, oct), /Bu ay üçün 2 sorğu limiti dolub/);
  const nov = new Date("2026-11-01T00:05:00Z");
  const q = await consumeRequest(user.id, nov);
  assert.equal(q?.used, 1);
  assert.equal(q?.remaining, 1);
  assert.equal(periodKey("month", nov), "m:2026-11");
  assert.equal(periodKey("total", nov), "total");
});

test("an unlimited plan only counts", async () => {
  await setPlan(user.id, { plan: "pro", label: "Pro", limit: null, period: "month" });
  const q = await consumeRequest(user.id);
  assert.equal(q?.limit, null);
  assert.equal(q?.remaining, null);
  assert.equal(q?.used, 1);
});

test("the plan reported at sign-in is stored for the user", async () => {
  const { upsertArachiUser } = await import("../auth/accounts");
  const u = await upsertArachiUser({
    customerId: 9001,
    name: "Demo MMC",
    subscription: { plan: "demo", label: "Demo", ai_limit: 100, ai_period: "total", is_demo: true, trial_ends_at: "2026-11-01T00:00:00" },
  });
  const q = await quotaFor(u.id);
  assert.equal(q?.plan, "demo");
  assert.equal(q?.limit, 100);
  assert.equal(q?.isDemo, true);
  // Signing in again after an upgrade replaces it.
  await upsertArachiUser({
    customerId: 9001,
    name: "Demo MMC",
    subscription: { plan: "business", label: "Business", ai_limit: 1000, ai_period: "month", is_demo: false, trial_ends_at: null },
  });
  const upgraded = await quotaFor(u.id);
  assert.equal(upgraded?.plan, "business");
  assert.equal(upgraded?.limit, 1000);
  assert.equal(upgraded?.period, "month");
});
