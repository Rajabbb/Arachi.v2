import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { addUser, asTestUser, call, freshDb, testUserId } from "../test/helpers";
import { db } from "../db";
import { logProvider, setProvider } from ".";
import { resendProvider } from "./resend";
import { applyEmailStatus, recheckAfterMs, refreshEmailStatuses, setStatusChecker } from "./emailStatus";

/** Resend that accepts every email with ids re_1, re_2, ... */
function acceptingResend() {
  let n = 0;
  const fetch = (async () =>
    new Response(JSON.stringify({ id: `re_${++n}` }), { status: 200 })) as typeof globalThis.fetch;
  setProvider("email", resendProvider({ apiKey: "k", from: "rfq@arachi.test", fetch }));
}

beforeEach(async () => {
  await freshDb();
  acceptingResend();
  await call("create_rfq", { origin: "Bakı", destination: "İstanbul", cargo_type: "Tekstil", weight_kg: 12000 });
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Road B", email: "b@road.az" }] });
});
afterEach(() => {
  setProvider("email", logProvider);
  setStatusChecker(null);
});

const statusOf = async (label: string) =>
  (await call("get_dashboard")).result.statuses.find((s: { label: string }) => s.label === label)?.count;

test("an email Resend accepted is Göndərildi until Resend reports the outcome", async () => {
  const { result } = await call("send_rfq_to_carriers", { rfq_id: 1 });
  assert.deepEqual(result.results.map((r: { status: string }) => r.status), ["Göndərildi", "Göndərildi"]);
  const outbox = await db().all<{ provider_status: string; carrier_id: number }>(
    "SELECT o.provider_status, d.carrier_id FROM outbox o JOIN dispatches d ON d.id = o.dispatch_id ORDER BY o.id",
  );
  assert.deepEqual(outbox.map((r) => ({ ...r })), [
    { provider_status: "sent", carrier_id: 1 },
    { provider_status: "sent", carrier_id: 2 },
  ]);
});

test("a bounce makes the dispatch Çatdırılmadı with the reason, delivered and opened move it forward", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  assert.equal(await applyEmailStatus("re_1", "bounced", "Mailbox does not exist"), true);
  await applyEmailStatus("re_2", "delivered");
  assert.equal(await statusOf("Çatdırılmadı"), 1);
  assert.equal(await statusOf("Çatdırıldı"), 1);
  assert.equal(await statusOf("Göndərildi"), 0);

  const { result } = await call("get_dashboard");
  assert.equal(result.failedDeliveries.length, 1);
  assert.equal(result.failedDeliveries[0].carrier, "Road A");
  assert.match(result.failedDeliveries[0].error, /geri qayıtdı.*Mailbox does not exist/);
  const row = (await db().get<{ delivered: number; error: string; provider_status: string }>(
    "SELECT delivered, error, provider_status FROM outbox WHERE provider_id = 're_1'",
  ))!;
  assert.equal(row.delivered, 0);
  assert.equal(row.provider_status, "bounced");

  // A late "delivered" never hides a bounce; an open marks the other one Baxıldı.
  await applyEmailStatus("re_1", "delivered");
  await applyEmailStatus("re_2", "opened");
  await applyEmailStatus("re_2", "delivered");
  assert.equal(await statusOf("Çatdırılmadı"), 1);
  assert.equal(await statusOf("Baxıldı"), 1);
  // Unknown ids and events are ignored.
  assert.equal(await applyEmailStatus("re_999", "bounced"), false);
  assert.equal(await applyEmailStatus("re_2", "received"), false);
});

test("a dispatch with an offer keeps its status when a reminder bounces", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await db().run("UPDATE dispatches SET status = 'offered' WHERE carrier_id = 1");
  await applyEmailStatus("re_1", "complained");
  assert.equal(await statusOf("Təklif alındı"), 1);
});

test("polling asks Resend about undecided emails, only the user's own, and stops once settled", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  // Another user's email that is still undecided.
  const other = await addUser("other@arachi.az");
  await db().run(
    `INSERT INTO outbox (channel, recipient, subject, body, delivered, provider_id, provider_status, created_at, user_id)
     VALUES ('email', 'x@y.az', 'RFQ #5 A → B', '', 1, 're_other', 'sent', ?, ?)`,
    new Date().toISOString(), other,
  );
  const asked: string[] = [];
  const answers: Record<string, string> = { re_1: "bounced", re_2: "delivered", re_other: "delivered" };
  setStatusChecker(async (id) => (asked.push(id), answers[id]), 0);

  assert.equal(await asTestUser(() => refreshEmailStatuses({ userId: testUserId })), 2);
  assert.deepEqual(asked.sort(), ["re_1", "re_2"]);
  assert.equal(await statusOf("Çatdırılmadı"), 1);
  assert.equal(await statusOf("Çatdırıldı"), 1);

  // Just checked: nothing is due again yet.
  asked.length = 0;
  assert.equal(await refreshEmailStatuses(), 1);
  assert.deepEqual(asked, ["re_other"]);

  // Once due again, the bounced one is settled; the delivered ones are still watched for an open.
  await db().run("UPDATE outbox SET status_checked_at = '2000-01-01T00:00:00.000Z'");
  asked.length = 0;
  await refreshEmailStatuses();
  assert.deepEqual(asked.sort(), ["re_2", "re_other"]);
  // The other user's email is not in this user's panel.
  assert.equal((await call("get_dashboard")).result.statuses.reduce((n: number, s: { count: number }) => n + s.count, 0), 2);
});

test("a Resend outage does not break the panel", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  setStatusChecker(async () => {
    throw new Error("rate limited");
  }, 0);
  assert.equal(await statusOf("Göndərildi"), 2);
});

test("emails sent before dispatch_id existed are matched by recipient and RFQ number", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await db().run("UPDATE outbox SET dispatch_id = NULL");
  await db().run("UPDATE dispatches SET status = 'delivered'");
  await applyEmailStatus("re_2", "bounced");
  const rows = await db().all<{ carrier_id: number; status: string }>("SELECT carrier_id, status FROM dispatches ORDER BY id");
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { carrier_id: 1, status: "delivered" },
    { carrier_id: 2, status: "failed" },
  ]);
});

test("recheck interval grows with the email's age, from a minute to two hours", () => {
  assert.equal(recheckAfterMs(0), 60_000);
  assert.equal(recheckAfterMs(3600_000), 900_000);
  assert.equal(recheckAfterMs(86400_000), 7200_000);
});
