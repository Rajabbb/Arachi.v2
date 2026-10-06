import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";

beforeEach(freshDb);

test("offer_history lists versions with the change from the previous one", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Kiyev", cargo_type: "Kimya", weight_kg: 4000 });
  await call("add_carriers", { carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }] });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2000, transit_days: 7 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 1800, transit_days: 8, offer_no: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2500, transit_days: 3 }); // a second, separate offer
  await call("record_offer", { rfq_id: 1, carrier_id: 2, price: 2100, transit_days: 5 });

  const { result } = await call("offer_history", { rfq_id: 1 });
  const a = result.carriers[0];
  assert.deepEqual(a.offers.map((o: { offer_no: number }) => o.offer_no), [1, 2]);
  const first = a.offers[0];
  assert.deepEqual(first.versions.map((v: { version: string }) => v.version), ["v1", "v2"]);
  assert.deepEqual(first.versions[1].change, { price: -200, price_percent: -10, transit_days: 1 });
  assert.deepEqual(a.offers[1].versions.map((v: { version: string; price: number }) => [v.version, v.price]), [["v1", 2500]]);
  assert.equal((await call("offer_history", { rfq_id: 1, carrier_id: 2 })).result.carriers.length, 1);
});
