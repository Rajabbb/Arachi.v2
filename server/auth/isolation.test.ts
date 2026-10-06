import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { asUser } from "./current";
import { dashboard } from "../domain/dashboard";
import { submitOffer } from "../domain/offers";
import { getRfq } from "../domain/rfqs";
import { addUser, call, freshDb, testUserId } from "../test/helpers";

/** Every user sees only their own RFQs, carriers, offers, messages and panel numbers. */

let alice: number;
let bob: number;

beforeEach(async () => {
  await freshDb();
  alice = testUserId;
  bob = await addUser("bob@arachi.az");
  await call("create_rfq", { origin: "Bakı", destination: "İstanbul", cargo_type: "Tekstil", weight_kg: 12000 }, undefined, alice);
  await call("add_carriers", { carriers: [{ name: "Alice Road", email: "road@x.az" }] }, undefined, alice);
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, alice);
});

test("lists show only the user's own records", async () => {
  assert.equal((await call("list_rfqs", {}, undefined, alice)).result.length, 1);
  assert.equal((await call("list_rfqs", {}, undefined, bob)).result.length, 0);
  assert.equal((await call("list_carriers", {}, undefined, alice)).result.count, 1);
  assert.equal((await call("list_carriers", {}, undefined, bob)).result.count, 0);
  assert.equal((await call("list_outbox", {}, undefined, alice)).result.length, 1);
  assert.equal((await call("list_outbox", {}, undefined, bob)).result.length, 0);
});

test("another user's RFQ, carrier and offers cannot be reached by id", async () => {
  await asUser(alice, () =>
    submitOffer({
      rfqId: 1, carrierId: 1, dispatchId: null, price: 900, currency: "USD", transitDays: 5,
      validUntil: "", notes: "", source: "manual", files: [],
    }),
  );
  const asBob = (name: string, input: Record<string, unknown>) =>
    assert.rejects(call(name, input, undefined, bob), /tapılmadı/, name);
  await asBob("list_offers", { rfq_id: 1 });
  await asBob("compare_offers", { rfq_id: 1 });
  await asBob("select_winner", { rfq_id: 1 });
  await asBob("offer_history", { rfq_id: 1 });
  await asBob("get_quote_link", { rfq_id: 1, carrier_id: 1 });
  await asBob("send_rfq_to_carriers", { rfq_id: 1 });
  await asBob("record_offer", { rfq_id: 1, carrier_id: 1, price: 1, transit_days: 1 });
  await asBob("create_customer_quote", { rfq_id: 1 });
  await asBob("export_rfqs", { rfq_id: 1 });
  await assert.rejects(call("export_rfqs", {}, undefined, bob), /RFQ tapılmadı/);

  // Bob's own RFQ #2 cannot use Alice's carrier #1 either.
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 500 }, undefined, bob);
  await asBob("get_quote_link", { rfq_id: 2, carrier_id: 1 });
  assert.equal((await call("send_rfq_to_carriers", { rfq_id: 2, audience: "all" }, undefined, bob).catch((e) => e)).message.includes("daşıyıcı"), true);

  // Removing or reminding touches only the user's own records.
  assert.equal((await call("remove_carriers", { carrier_ids: [1] }, undefined, bob)).result.removed, 0);
  assert.equal((await call("send_reminders", { min_hours: 0, dry_run: true }, undefined, bob)).result.would_remind, 0);
  assert.equal((await call("send_reminders", { min_hours: 0, dry_run: true }, undefined, alice)).result.would_remind, 1);
  await assert.rejects(asUser(bob, () => getRfq(1)), /tapılmadı/);
});

test("panel numbers are per user", async () => {
  const a = await asUser(alice, () => dashboard(30));
  const b = await asUser(bob, () => dashboard(30));
  assert.equal(a.activeRfqs, 1);
  assert.equal(a.carriers, 1);
  assert.equal(a.statuses.find((s) => s.status === "delivered")!.count, 1);
  assert.equal(b.activeRfqs, 0);
  assert.equal(b.carriers, 0);
  assert.equal(b.statuses.reduce((n, s) => n + s.count, 0), 0);
});

test("two users can each have a carrier with the same email", async () => {
  const added = await call("add_carriers", { carriers: [{ name: "Bob Road", email: "ROAD@x.az" }] }, undefined, bob);
  assert.equal(added.result.added, 1);
  const alices = await call("list_carriers", {}, undefined, alice);
  assert.equal(alices.result.carriers[0].name, "Alice Road");
});

test("nothing runs without a signed-in user", async () => {
  const { tools } = await import("../agent/tools");
  const run = await tools.execute("list_rfqs", {});
  assert.equal(run.ok, false);
  assert.match(run.content, /signed-in user/);
});
