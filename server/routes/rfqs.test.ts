import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { asUser } from "../auth/current";
import { submitOffer } from "../domain/offers";
import { call, freshDb } from "../test/helpers";
import type { RfqDetailData, RfqListData } from "../../shared/protocol";

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** A signed-in browser for a newly registered user. */
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

/** A carrier's offer; offerNo updates that earlier offer (a new version) instead of adding one. */
const offer = (
  userId: number, carrierId: number, price: number, transitDays: number, currency = "USD", validUntil = "", offerNo = 0,
) =>
  asUser(userId, () =>
    submitOffer({
      rfqId: 1, carrierId, dispatchId: null, price, currency, transitDays,
      validUntil, notes: "", source: "manual", files: [], offerNo,
    }),
  );

let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  alice = await signUp("alice@arachi.az");
  bob = await signUp("bob@arachi.az");
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Şərab", weight_kg: 5000 }, undefined, alice.id);
  await call(
    "add_carriers",
    { carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }, { name: "C", email: "c@x.az" }] },
    undefined, alice.id,
  );
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, alice.id);
});

test("RFQ list shows counts and the best price in the RFQ currency", async () => {
  await offer(alice.id, 1, 1500, 5);
  await offer(alice.id, 1, 1300, 5, "USD", "", 1); // A revises its offer: v2 counts
  await offer(alice.id, 2, 1400, 3);
  await offer(alice.id, 3, 1000, 7, "EUR"); // other currency: not compared without a rate
  await call("create_rfq", { origin: "Bakı", destination: "Minsk", cargo_type: "Meyvə", weight_kg: 900 }, undefined, alice.id);

  const { status, body } = await alice.get<RfqListData>("/api/rfqs");
  assert.equal(status, 200);
  assert.deepEqual(body.rfqs.map((r) => r.id), [2, 1]);
  const first = body.rfqs[1];
  assert.equal(first.statusLabel, "Təklif toplanır");
  assert.equal(first.carriersSent, 3);
  assert.equal(first.carriersResponded, 3);
  assert.deepEqual(first.bestPrice, { price: 1300, currency: "USD" });
  assert.equal(body.rfqs[0].carriersSent, 0);
  assert.equal(body.rfqs[0].bestPrice, null);

  // Offers grouped under their RFQ: latest versions, cheapest first, with marks.
  assert.deepEqual(body.rfqs[0].offers, []);
  assert.deepEqual(
    first.offers.map((o) => [o.carrier, o.version, o.price, o.currency, o.cheapest, o.fastest]),
    [["C", 1, 1000, "EUR", false, false], ["A", 2, 1300, "USD", true, false], ["B", 1, 1400, "USD", false, true]],
  );
});

test("RFQ page: carriers with status, offers with versions, cheapest, fastest and winner", async () => {
  await offer(alice.id, 1, 1500, 5, "USD", "2000-01-01");
  await offer(alice.id, 1, 1300, 5, "USD", "", 1);
  await offer(alice.id, 2, 1400, 3);
  await db().run("UPDATE dispatches SET status = 'failed', error = 'Bounced: mailbox does not exist' WHERE carrier_id = 3");
  await db().run("UPDATE dispatches SET reminder_count = 2, last_reminder_at = '2026-10-05T10:00:00.000Z' WHERE carrier_id = 2");
  await call("select_winner", { rfq_id: 1, offer_id: 3, notify_winner: false }, undefined, alice.id);

  const { status, body } = await alice.get<RfqDetailData>("/api/rfqs/1");
  assert.equal(status, 200);
  assert.equal(body.rfq.origin, "Bakı");
  assert.equal(body.rfq.statusLabel, "Qalib seçilib");
  assert.ok(body.rfq.awarded_at);

  assert.equal(body.carriers.length, 3);
  const c = body.carriers.find((x) => x.name === "C")!;
  assert.equal(c.statusLabel, "Çatdırılmadı");
  assert.equal(c.error, "Bounced: mailbox does not exist");
  assert.equal(body.carriers.find((x) => x.name === "B")!.reminder_count, 2);

  assert.deepEqual(body.offers.map((o) => [o.carrier, o.version, o.price]), [["A", 2, 1300], ["B", 1, 1400]]);
  const [a, b] = body.offers;
  assert.equal(a.cheapest, true);
  assert.equal(a.fastest, false);
  assert.equal(a.winner, false);
  assert.deepEqual(a.previous.map((p) => [p.version, p.price]), [[1, 1500]]);
  assert.equal(b.cheapest, false);
  assert.equal(b.fastest, true);
  assert.equal(b.winner, true);
  assert.equal(body.mixedCurrencies, false);
});

test("a carrier's separate offers are compared one by one, each with its own versions", async () => {
  await offer(alice.id, 1, 1500, 5);
  await offer(alice.id, 1, 1200, 9); // A's second offer: slower but cheaper
  await offer(alice.id, 1, 1450, 5, "USD", "", 1); // A updates its first offer
  await offer(alice.id, 2, 1400, 3);

  const list = (await alice.get<RfqListData>("/api/rfqs")).body.rfqs[0];
  assert.equal(list.carriersResponded, 2);
  assert.deepEqual(
    list.offers.map((o) => [o.carrier, o.offer_no, o.carrier_offers, o.version, o.price, o.cheapest]),
    [["A", 2, 2, 1, 1200, true], ["B", 1, 1, 1, 1400, false], ["A", 1, 2, 2, 1450, false]],
  );

  const detail = (await alice.get<RfqDetailData>("/api/rfqs/1")).body;
  const a1 = detail.offers.find((o) => o.carrier === "A" && o.offer_no === 1)!;
  const a2 = detail.offers.find((o) => o.carrier === "A" && o.offer_no === 2)!;
  assert.deepEqual(a1.previous.map((p) => [p.version, p.price]), [[1, 1500]]);
  assert.deepEqual(a2.previous, []);

  // The winner is one specific offer; the carrier's other offer is not marked.
  await call("select_winner", { rfq_id: 1, offer_id: a2.id, notify_winner: false }, undefined, alice.id);
  const after = (await alice.get<RfqDetailData>("/api/rfqs/1")).body;
  assert.deepEqual(after.offers.filter((o) => o.winner).map((o) => [o.carrier, o.offer_no]), [["A", 2]]);
});

test("another user's RFQ is not found and not listed", async () => {
  assert.equal((await bob.get<RfqListData>("/api/rfqs")).body.rfqs.length, 0);
  const res = await bob.get<{ error: string }>("/api/rfqs/1");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Sorğu tapılmadı.");
  assert.equal((await alice.get("/api/rfqs/abc")).status, 404);
  assert.equal((await alice.get("/api/rfqs/99")).status, 404);
});

test("RFQ pages need a login", async () => {
  assert.equal((await fetch(`${base}/api/rfqs`)).status, 401);
  assert.equal((await fetch(`${base}/api/rfqs/1`)).status, 401);
});

test("create_rfq returns the RFQ's page link", async () => {
  const { result } = await call("create_rfq", { origin: "Bakı", destination: "Aktau", cargo_type: "Taxıl", weight_kg: 2000 }, undefined, alice.id);
  assert.match(result.page_url, /\/panel\/rfq\/2$/);
});
