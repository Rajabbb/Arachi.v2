import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { asUser } from "../auth/current";
import { submitOffer } from "../domain/offers";
import { call, freshDb } from "../test/helpers";
import type { CarrierDetailData, CarrierListData } from "../../shared/protocol";

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

const offer = (userId: number, rfqId: number, carrierId: number, price: number, transitDays: number, offerNo = 0) =>
  asUser(userId, () =>
    submitOffer({
      rfqId, carrierId, dispatchId: null, price, currency: "USD", transitDays,
      validUntil: "", notes: "", source: "manual", files: [], offerNo,
    }),
  );

let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  alice = await signUp("alice@arachi.az");
  bob = await signUp("bob@arachi.az");
  await call(
    "add_carriers",
    {
      carriers: [
        { name: "Avto Trans", email: "a@x.az", category: "Quru", subcategory: "Türkiyə xətti" },
        { name: "Blue Sea", email: "b@x.az", category: "Dəniz" },
        { name: "Cargo Air", email: "c@x.az", category: "Hava" },
      ],
    },
    undefined, alice.id,
  );
  // Two RFQs sent to all three carriers.
  for (const destination of ["Tbilisi", "Minsk"]) {
    await call("create_rfq", { origin: "Bakı", destination, cargo_type: "Şərab", weight_kg: 5000 }, undefined, alice.id);
  }
  await call("send_rfq_to_carriers", { rfq_id: 1, audience: "all" }, undefined, alice.id);
  await call("send_rfq_to_carriers", { rfq_id: 2, audience: "all" }, undefined, alice.id);
});

test("carrier base lists each carrier with sends, answers, wins and its latest offer", async () => {
  await offer(alice.id, 1, 1, 1500, 5);
  await offer(alice.id, 1, 1, 1300, 5, 1); // a new version of the same offer
  await offer(alice.id, 1, 2, 1400, 3);
  await offer(alice.id, 2, 1, 900, 4);
  await db().run("UPDATE dispatches SET status = 'failed', error = 'Bounced' WHERE carrier_id = 3 AND rfq_id = 2");
  await call("select_winner", { rfq_id: 1, offer_id: 3, notify_winner: false }, undefined, alice.id);
  await db().run("UPDATE carriers SET active = 0 WHERE name = 'Blue Sea'");

  const { status, body } = await alice.get<CarrierListData>("/api/carriers");
  assert.equal(status, 200);
  // Active first, then by name.
  assert.deepEqual(body.carriers.map((c) => c.name), ["Avto Trans", "Cargo Air", "Blue Sea"]);
  const [a, c, b] = body.carriers;

  assert.equal(a.category, "Quru");
  assert.equal(a.subcategory, "Türkiyə xətti");
  assert.equal(a.active, true);
  assert.equal(a.rfqsSent, 2);
  assert.equal(a.rfqsAnswered, 2);
  assert.equal(a.responseRate, 100);
  assert.equal(a.rfqsWon, 0);
  assert.equal(a.lastOffer?.rfq_id, 2);
  assert.equal(a.lastOffer?.price, 900);
  assert.ok(a.lastActivity);

  assert.equal(b.active, false);
  assert.equal(b.rfqsAnswered, 1);
  assert.equal(b.responseRate, 50);
  assert.equal(b.rfqsWon, 1);

  assert.equal(c.rfqsAnswered, 0);
  assert.equal(c.responseRate, 0);
  assert.equal(c.failedDeliveries, 1);
  assert.equal(c.lastOffer, null);
});

test("a carrier that was never sent anything has no response rate", async () => {
  await call("add_carriers", { carriers: [{ name: "Yeni", email: "new@x.az" }] }, undefined, alice.id);
  const { body } = await alice.get<CarrierListData>("/api/carriers");
  const fresh = body.carriers.find((c) => c.name === "Yeni")!;
  assert.equal(fresh.rfqsSent, 0);
  assert.equal(fresh.responseRate, null);
  assert.equal(fresh.lastActivity, null);
});

test("carrier page: its RFQs newest first, delivery status with bounce reason, offers with versions", async () => {
  await offer(alice.id, 1, 1, 1500, 5);
  await offer(alice.id, 1, 1, 1300, 5, 1);
  await offer(alice.id, 1, 2, 1400, 3);
  await db().run("UPDATE dispatches SET status = 'failed', error = 'Bounced: mailbox full' WHERE carrier_id = 1 AND rfq_id = 2");

  const { status, body } = await alice.get<CarrierDetailData>("/api/carriers/1");
  assert.equal(status, 200);
  assert.equal(body.carrier.name, "Avto Trans");
  assert.equal(body.carrier.email, "a@x.az");
  assert.deepEqual(body.rfqs.map((r) => r.rfq.id), [2, 1]);

  const [second, first] = body.rfqs;
  assert.equal(second.rfq.destination, "Minsk");
  assert.equal(second.dispatch?.statusLabel, "Çatdırılmadı");
  assert.equal(second.dispatch?.error, "Bounced: mailbox full");
  assert.deepEqual(second.offers, []);

  assert.equal(first.dispatch?.channel, "email");
  // Only this carrier's offers, marked against the whole RFQ.
  assert.deepEqual(first.offers.map((o) => [o.carrier, o.version, o.price, o.cheapest, o.fastest]), [["Avto Trans", 2, 1300, true, false]]);
  assert.deepEqual(first.offers[0].previous.map((p) => [p.version, p.price]), [[1, 1500]]);
});

test("another user's carriers are not listed and their pages are not found", async () => {
  assert.deepEqual((await bob.get<CarrierListData>("/api/carriers")).body.carriers, []);
  const res = await bob.get<{ error: string }>("/api/carriers/1");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Daşıyıcı tapılmadı.");
  assert.equal((await alice.get("/api/carriers/abc")).status, 404);
  assert.equal((await alice.get("/api/carriers/99")).status, 404);
});

test("carrier pages need a login", async () => {
  assert.equal((await fetch(`${base}/api/carriers`)).status, 401);
  assert.equal((await fetch(`${base}/api/carriers/1`)).status, 401);
});
