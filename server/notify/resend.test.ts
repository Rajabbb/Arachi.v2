import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { freshDb } from "../test/helpers";
import { db } from "../db";
import { deliver, logProvider, sendsForReal, setProvider } from ".";
import { fetchResendStatus, resendProvider } from "./resend";

beforeEach(freshDb);
afterEach(() => setProvider("email", logProvider));

/** A fetch that records the request and answers like the Resend API. */
function fakeResend(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

const message = { channel: "email" as const, to: "carrier@road.az", subject: "RFQ #1", body: "Salam" };

test("sends through Resend and keeps its message id in the outbox", async () => {
  const api = fakeResend(200, { id: "re_123" });
  setProvider("email", resendProvider({ apiKey: "test-key", from: "Arachi <rfq@arachi.test>", replyTo: "team@arachi.test", fetch: api.fetch }));
  assert.equal(sendsForReal("email"), true);

  assert.deepEqual(await deliver(message), { delivered: true, providerId: "re_123" });
  assert.equal(api.calls[0].url, "https://api.resend.com/emails");
  assert.equal((api.calls[0].init.headers as Record<string, string>).authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(api.calls[0].init.body as string), {
    from: "Arachi <rfq@arachi.test>",
    to: ["carrier@road.az"],
    subject: "RFQ #1",
    text: "Salam",
    reply_to: "team@arachi.test",
  });
  const row = await db().get<{ delivered: number; provider_id: string }>("SELECT delivered, provider_id FROM outbox");
  assert.deepEqual({ ...row }, { delivered: 1, provider_id: "re_123" });
});

test("a Resend error or a missing address marks the message undelivered", async () => {
  const api = fakeResend(403, { statusCode: 403, message: "The domain is not verified." });
  setProvider("email", resendProvider({ apiKey: "k", from: "rfq@arachi.test", fetch: api.fetch }));

  const failed = await deliver(message);
  assert.equal(failed.delivered, false);
  assert.match(failed.error!, /403.*not verified/);
  assert.equal((await deliver({ ...message, to: " " })).delivered, false);
  assert.equal(api.calls.length, 1);
});

test("without a key the email channel stays a log stub", () => {
  assert.equal(sendsForReal("email"), false);
  assert.equal(sendsForReal("whatsapp"), false);
});

test("reads an email's last event from Resend; a sending-only key gets a clear message", async () => {
  const api = fakeResend(200, { object: "email", id: "re_9", last_event: "bounced" });
  assert.equal(await fetchResendStatus("k", "re_9", api.fetch), "bounced");
  assert.equal(api.calls[0].url, "https://api.resend.com/emails/re_9");
  assert.equal(await fetchResendStatus("k", "re_9", fakeResend(404, {}).fetch), undefined);
  await assert.rejects(fetchResendStatus("k", "re_9", fakeResend(401, { message: "restricted" }).fetch), /Full access/);
});
