import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { call, freshDb } from "../test/helpers";
import { app } from "../app";
import { config } from "../config";
import { logProvider, setProvider } from "../notify";
import { resendProvider } from "../notify/resend";
import { setStatusChecker } from "../notify/emailStatus";
import { db } from "../db";
import { verifyResendSignature } from "./resendWebhook";

let server: Server;
let base: string;
before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const secret = `whsec_${Buffer.from("test-signing-key").toString("base64")}`;

function sign(body: string, id = "msg_1", timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", Buffer.from("test-signing-key")).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${sig}` };
}

const bounced = JSON.stringify({
  type: "email.bounced",
  created_at: "2026-10-06T20:00:00.000Z",
  data: { email_id: "re_1", bounce: { message: "Address not found", subType: "General", type: "Permanent" } },
});

const post = (body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/webhooks/resend`, { method: "POST", body, headers });

const dispatchStatus = async () => (await db().get<{ status: string; error: string }>("SELECT status, error FROM dispatches"))!;

beforeEach(async () => {
  await freshDb();
  const fetch = (async () => new Response(JSON.stringify({ id: "re_1" }), { status: 200 })) as typeof globalThis.fetch;
  setProvider("email", resendProvider({ apiKey: "k", from: "rfq@arachi.test", fetch }));
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Şərab", weight_kg: 5000 });
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@gmail.com" }] });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
});
afterEach(() => {
  config.resendWebhookSecret = "";
  setProvider("email", logProvider);
  setStatusChecker(null);
});

test("a signed bounce event marks the dispatch Çatdırılmadı with the bounce message", async () => {
  config.resendWebhookSecret = secret;
  assert.equal((await post(bounced, sign(bounced))).status, 200);
  const d = await dispatchStatus();
  assert.equal(d.status, "failed");
  assert.match(d.error, /Address not found/);
});

test("with a secret, unsigned or tampered events are rejected and change nothing", async () => {
  config.resendWebhookSecret = secret;
  assert.equal((await post(bounced)).status, 401);
  assert.equal((await post(bounced.replace("re_1", "re_2"), sign(bounced))).status, 401);
  assert.equal((await post(bounced, sign(bounced, "msg_1", Math.floor(Date.now() / 1000) - 3600))).status, 401);
  assert.equal((await dispatchStatus()).status, "sent");
});

test("without a secret the event is only a hint: the status comes from the Resend API", async () => {
  const asked: string[] = [];
  setStatusChecker(async (id) => (asked.push(id), "delivered"), 0);
  assert.equal((await post(bounced)).status, 200);
  assert.deepEqual(asked, ["re_1"]);
  assert.equal((await dispatchStatus()).status, "delivered");
  // Ids we never sent are not looked up.
  await post(bounced.replace("re_1", "re_unknown"));
  assert.deepEqual(asked, ["re_1"]);
});

test("signature check accepts any of several v1 signatures", () => {
  const body = "{}";
  const h = sign(body);
  const ok = verifyResendSignature(secret, { id: h["svix-id"], timestamp: h["svix-timestamp"], signature: `v1,AAAA ${h["svix-signature"]}` }, body);
  assert.equal(ok, true);
});
