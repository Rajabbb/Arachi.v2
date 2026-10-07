import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { asUser } from "../auth/current";
import { submitOffer } from "../domain/offers";
import { lastMonths, monthOf } from "../domain/analytics";
import { call, freshDb } from "../test/helpers";
import type { DashboardData, MonthlyReportData } from "../../shared/protocol";

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function signUp(email: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    body: JSON.stringify({ email, password: "parol1234", name: "" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0];
  const id = ((await res.json()) as { user: { id: number } }).user.id;
  const get = async <T>(path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { cookie } });
    return { status: r.status, body: (await r.json()) as T };
  };
  return { id, get };
}

const offer = (userId: number, rfqId: number, carrierId: number, price: number, currency = "USD", offerNo = 0) =>
  asUser(userId, () =>
    submitOffer({
      rfqId, carrierId, dispatchId: null, price, currency, transitDays: 5,
      validUntil: "", notes: "", source: "manual", files: [], offerNo,
    }),
  );

let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;
const [lastMonth, thisMonth] = lastMonths(2);

/** A timestamp in the middle of a month, for moving test rows in time. */
const mid = (month: string) => `${month}-15T10:00:00.000Z`;

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  alice = await signUp("alice@arachi.az");
  bob = await signUp("bob@arachi.az");
  await call(
    "add_carriers",
    { carriers: [{ name: "Avto Trans", email: "a@x.az" }, { name: "Blue Sea", email: "b@x.az" }] },
    undefined, alice.id,
  );
  for (const destination of ["Tbilisi", "Minsk"]) {
    await call("create_rfq", { origin: "Bakı", destination, cargo_type: "Şərab", weight_kg: 5000 }, undefined, alice.id);
  }
  await call("send_rfq_to_carriers", { rfq_id: 1, audience: "all" }, undefined, alice.id);
  await call("send_rfq_to_carriers", { rfq_id: 2, audience: "all" }, undefined, alice.id);
  await offer(alice.id, 1, 1, 1500);
  await offer(alice.id, 1, 1, 1300, "USD", 1); // an update, not a new offer
  await offer(alice.id, 1, 2, 1400, "EUR");
  await offer(alice.id, 2, 2, 900);
  // Offers typed in by hand don't move the send's status; carriers answering via their link do.
  await db().run(
    "UPDATE dispatches SET status = 'offered' WHERE EXISTS (SELECT 1 FROM offers o WHERE o.rfq_id = dispatches.rfq_id AND o.carrier_id = dispatches.carrier_id)",
  );
  await call("select_winner", { rfq_id: 1, offer_id: 2, notify_winner: false }, undefined, alice.id);
  // RFQ 1 and everything about it happened last month; RFQ 2 is this month's.
  await db().run("UPDATE rfqs SET created_at = ?, awarded_at = CASE WHEN awarded_at IS NULL THEN NULL ELSE ? END WHERE id = 1", mid(lastMonth), mid(lastMonth));
  await db().run("UPDATE dispatches SET sent_at = ? WHERE rfq_id = 1", mid(lastMonth));
  await db().run("UPDATE offers SET created_at = ? WHERE rfq_id = 1", mid(lastMonth));
  // Bob's RFQ in the same month must not show up for Alice.
  await call("add_carriers", { carriers: [{ name: "Bob Cargo", email: "bob@x.az" }] }, undefined, bob.id);
  await call("create_rfq", { origin: "Bakı", destination: "Ankara", cargo_type: "Un", weight_kg: 1000 }, undefined, bob.id);
});

test("months are counted in Baku time", () => {
  assert.equal(monthOf("2026-09-30T19:59:59.000Z"), "2026-09");
  assert.equal(monthOf("2026-09-30T20:00:00.000Z"), "2026-10");
  assert.deepEqual(lastMonths(3, Date.parse("2026-01-10T00:00:00Z")), ["2025-11", "2025-12", "2026-01"]);
});

test("dashboard carries the last 12 months for the charts", async () => {
  const { status, body } = await alice.get<DashboardData>("/api/dashboard?days=30");
  assert.equal(status, 200);
  assert.equal(body.monthly.length, 12);
  assert.equal(body.monthly[11].month, thisMonth);
  const [prev, cur] = body.monthly.slice(-2);
  assert.deepEqual(prev, { month: lastMonth, rfqs: 1, offers: 2, sent: 2, offered: 2, awarded: 1, responseRate: 100 });
  assert.deepEqual(cur, { month: thisMonth, rfqs: 1, offers: 1, sent: 2, offered: 1, awarded: 0, responseRate: 50 });
});

test("monthly report: totals, the month's RFQs with winner, carriers best first", async () => {
  const { status, body } = await alice.get<MonthlyReportData>(`/api/report?month=${lastMonth}`);
  assert.equal(status, 200);
  assert.equal(body.rfqsCreated, 1);
  assert.equal(body.offersReceived, 2);
  assert.equal(body.responseRate, 100);
  assert.equal(body.awarded, 1);
  assert.deepEqual(body.awardedValue, [{ currency: "USD", total: 1300 }]);
  assert.equal(body.rfqs.length, 1);
  assert.equal(body.rfqs[0].destination, "Tbilisi");
  assert.equal(body.rfqs[0].offers, 2);
  assert.deepEqual(body.rfqs[0].winner, { carrier: "Avto Trans", price: 1300, currency: "USD" });
  assert.deepEqual(body.carriers.map((c) => [c.name, c.sent, c.offered, c.won]), [["Avto Trans", 1, 1, 1], ["Blue Sea", 1, 1, 0]]);

  const current = await alice.get<MonthlyReportData>("/api/report");
  assert.equal(current.body.month, thisMonth);
  assert.deepEqual(current.body.rfqs.map((r) => r.destination), ["Minsk"]);
  assert.equal(current.body.responseRate, 50);
});

test("monthly report is per user and rejects a bad month", async () => {
  const { body } = await bob.get<MonthlyReportData>(`/api/report?month=${thisMonth}`);
  assert.deepEqual(body.rfqs.map((r) => r.destination), ["Ankara"]);
  assert.equal(body.sent, 0);
  assert.equal((await alice.get("/api/report?month=2026-13")).status, 400);
  assert.equal((await alice.get("/api/report?month=oct")).status, 400);
});
