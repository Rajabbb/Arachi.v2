import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb, textFile } from "../../test/helpers";
import { emptyContext } from "./registry";
import { dispatchFromToken, markViewed } from "../../domain/dispatches";

beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "Aktau", cargo_type: "Boru", weight_kg: 20000, currency: "EUR" });
  await call("add_carriers", {
    carriers: [
      { name: "A", email: "a@x.az" },
      { name: "B", email: "b@x.az" },
      { name: "C", whatsapp: "+994500000000" },
      { name: "D", email: "d@x.az", category: "Hava" },
    ],
  });
});

test("statuses follow each carrier from sent to offer", async () => {
  const sent = (await call("send_rfq_to_carriers", { rfq_id: 1 })).result;
  const b = sent.results.find((r: { name: string }) => r.name === "B");
  await markViewed((await dispatchFromToken(b.link.split("/quote/")[1]))!);
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2100, transit_days: 4 });

  const { result } = await call("list_offers", { rfq_id: 1 });
  assert.deepEqual(result.counts, { "Göndərildi": 0, "Çatdırıldı": 0, "Baxıldı": 1, "Təklif alındı": 1, "Çatdırılmadı": 1 });
  const a = result.carriers.find((c: { carrier: string }) => c.carrier === "A");
  assert.equal(a.offers[0].currency, "EUR");
  assert.equal((await call("list_offers", { rfq_id: 1, status: "failed" })).result.carriers[0].carrier, "C");
});

test("manual offers for carriers never sent to, with attached documents", async () => {
  const ctx = emptyContext([textFile("teklif.txt", "1900 EUR")]);
  await call("record_offer", { rfq_id: 1, carrier_id: 4, price: 1900, transit_days: 2, attach_files: true }, ctx);
  const { result } = await call("list_offers", { rfq_id: 1 });
  assert.equal(result.offers_received, 1);
  assert.equal(result.manual_offers[0].carrier_id, 4);
});

test("a carrier can send a second offer or update an earlier one", async () => {
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2100, transit_days: 4 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 1900, transit_days: 9 });
  const updated = (await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2000, transit_days: 4, offer_no: 1 })).result;
  assert.deepEqual([updated.offer_no, updated.version], [1, 2]);
  await assert.rejects(call("record_offer", { rfq_id: 1, carrier_id: 1, price: 1, transit_days: 1, offer_no: 5 }), /№5/);

  const { result } = await call("list_offers", { rfq_id: 1 });
  assert.equal(result.offers_received, 2);
  assert.equal(result.carriers_responded, 1);
  const a = result.manual_offers.filter((o: { carrier_id: number }) => o.carrier_id === 1);
  assert.deepEqual(
    a.map((o: { offer_no: number; version: number; price: number }) => [o.offer_no, o.version, o.price]),
    [[2, 1, 1900], [1, 2, 2000]],
  );
});
