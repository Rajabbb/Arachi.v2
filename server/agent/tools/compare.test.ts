import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";

beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "Berlin", cargo_type: "Avadanlıq", weight_kg: 9000 });
  await call("add_carriers", { carriers: [{ name: "Cheap", email: "c@x.az" }, { name: "Fast", email: "f@x.az" }, { name: "Euro", email: "e@x.az" }] });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 3000, transit_days: 12 });
  await call("record_offer", { rfq_id: 1, carrier_id: 2, price: 3300, transit_days: 6 });
  await call("record_offer", { rfq_id: 1, carrier_id: 3, price: 2900, transit_days: 9, currency: "EUR" });
});

const order = (offers: { carrier: string }[]) => offers.map((o) => o.carrier);

test("ranks by price, transit or a balanced score", async () => {
  let r = (await call("compare_offers", { rfq_id: 1 })).result;
  assert.equal(r.mixed_currencies_without_rate, true);
  assert.deepEqual(order(r.offers), ["Cheap", "Fast", "Euro"]);
  r = (await call("compare_offers", { rfq_id: 1, eur_usd_rate: 1.1 })).result;
  assert.deepEqual(order(r.offers), ["Cheap", "Euro", "Fast"]);
  r = (await call("compare_offers", { rfq_id: 1, criterion: "transit" })).result;
  assert.equal(r.offers[0].carrier, "Fast");
  r = (await call("compare_offers", { rfq_id: 1, criterion: "balanced", price_weight: 0.5 })).result;
  assert.equal(r.offers[0].carrier, "Fast");
});

test("select_winner picks the best offer, closes the RFQ and notifies the winner", async () => {
  const { result } = await call("select_winner", { rfq_id: 1 });
  assert.equal(result.winner.carrier, "Cheap");
  assert.deepEqual(result.notified, [{ carrier: "Cheap", channel: "email", delivered: true }]);
  await assert.rejects(call("select_winner", { rfq_id: 1 }));
  await assert.rejects(call("record_offer", { rfq_id: 1, carrier_id: 2, price: 1, transit_days: 1 }));
  assert.equal((await call("compare_offers", { rfq_id: 1 })).result.winner_offer_id, result.winner.offer_id);
});

test("offers all in another currency still compare and can win", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Paris", cargo_type: "Xalça", weight_kg: 500 });
  await call("record_offer", { rfq_id: 2, carrier_id: 1, price: 900, transit_days: 5, currency: "EUR" });
  await call("record_offer", { rfq_id: 2, carrier_id: 2, price: 800, transit_days: 5, currency: "EUR" });
  const { result } = await call("select_winner", { rfq_id: 2, notify_winner: false });
  assert.equal(result.winner.carrier, "Fast");
});
