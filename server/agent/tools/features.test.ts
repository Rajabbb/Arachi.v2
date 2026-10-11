import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb, RFQ_DEFAULTS } from "../../test/helpers";
import { arachiData, installFakeArachi } from "../../test/fakeArachi";

let restore: () => void;
before(() => {
  restore = installFakeArachi();
});
after(() => restore());
beforeEach(freshDb);

const base = { ...RFQ_DEFAULTS, origin: "Bakı, Azərbaycan", destination: "Berlin, Almaniya" };
const stored = () => arachiData.rfqs[arachiData.rfqs.length - 1] as Record<string, unknown>;
const lines = () => (stored().required_fields as string[]) ?? [];

test("an offer deadline is stored as the Offer Due line, with the automatic reminder on by default", async () => {
  await call("create_rfq", { ...base, quote_deadline: "2099-01-01T17:00" });
  assert.ok(lines().includes("Offer Due: 2099-01-01 17:00"));
  assert.ok(!lines().some((l) => l.startsWith("Auto Reminder")));

  await call("create_rfq", { ...base, quote_deadline: "2099-01-01", auto_reminder: false });
  assert.ok(lines().includes("Offer Due: 2099-01-01 23:59"), "a date alone means the end of that day");
  assert.ok(lines().includes("Auto Reminder: off"));
});

test("a past or malformed offer deadline is refused before anything is created", async () => {
  await assert.rejects(call("create_rfq", { ...base, quote_deadline: "2020-01-01T10:00" }), /keçmişdədir/);
  await assert.rejects(call("create_rfq", { ...base, quote_deadline: "sabah axşam" }), /formatında olmalıdır/);
  assert.equal(arachiData.rfqs.length, 0);
});

test("duplicate_rfq copies the shipment and its conditions but not the dates", async () => {
  const { result: first } = await call("create_rfq", {
    ...base,
    cargo_type: "Tekstil",
    weight_kg: 1500,
    volume_amount: 12,
    volume_unit: "Palet",
    transport_mode: "Dəniz",
    origin: "Mersin limanı, Türkiyə",
    destination: "Poti limanı, Gürcüstan",
    loading_date: "2026-10-20",
    delivery_deadline: "2026-11-05",
    quote_deadline: "2099-01-01T17:00",
    hs_code: "6109.10",
    incoterm: "FOB",
    adr: "Klass 3",
    notes: "Ehtiyatla",
    stackable: "Non-stackable",
  });
  const { result: copy } = await call("duplicate_rfq", { rfq_id: first.number, loading_date: "2099-03-01" });
  assert.equal(arachiData.rfqs.length, 2);
  const row = stored();
  assert.equal(row.origin, "Mersin limanı, Türkiyə");
  assert.equal(row.cargo_type, "Tekstil");
  assert.equal(row.weight_kg, 1500);
  assert.equal(row.hs_code, "6109.10");
  assert.equal(row.transportation_mode, "Su/Dəniz (Sea)");
  assert.ok(lines().includes("Incoterm: FOB"));
  assert.ok(lines().includes("Dangerous Goods (ADR): Klass 3"));
  assert.ok(lines().includes("Həcm / Palet: 12 Palet"));
  assert.ok(lines().includes("Loading Date: 2099-03-01"), "the new date");
  assert.ok(!lines().includes("Loading Date: 2026-10-20"));
  assert.ok(!lines().some((l) => l.startsWith("Delivery Deadline")), "old dates are not copied");
  assert.ok(!lines().some((l) => l.startsWith("Offer Due")));
  assert.notEqual(copy.number, first.number);
  const original = arachiData.rfqs[0] as Record<string, unknown>;
  assert.ok((original.required_fields as string[]).includes("Loading Date: 2026-10-20"), "the original is untouched");
});

test("duplicate_rfq takes overrides and a new offer deadline", async () => {
  const { result: first } = await call("create_rfq", { ...base, weight_kg: 500 });
  await call("duplicate_rfq", { rfq_id: first.number, destination: "Hamburq, Almaniya", weight_kg: 800, quote_deadline: "2099-05-05T12:00" });
  const row = stored();
  assert.equal(row.destination, "Hamburq, Almaniya");
  assert.equal(row.weight_kg, 800);
  assert.ok(lines().includes("Offer Due: 2099-05-05 12:00"));
});

test("route_price_history summarises earlier offers on the same route, leaving the current RFQ out", async () => {
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Road B", email: "b@road.az" }] });
  const { result: old } = await call("create_rfq", base);
  const { result: now } = await call("create_rfq", { ...base, origin: "Baku" });
  const carriers = (await call("list_carriers")).result.carriers as { id: number }[];
  await call("send_rfq_to_carriers", { rfq_id: old.number, audience: "specific", carrier_ids: [carriers[0].id, carriers[1].id] });
  const oldDbId = arachiData.rfqs.find((r) => r.origin === "Bakı, Azərbaycan")!.id;
  const offers = arachiData.quotes.filter((q) => q.request_id === oldDbId);
  Object.assign(offers[0], { price: 1000, currency: "USD" }); // 1700 AZN
  Object.assign(offers[1], { price: 2000, currency: "AZN" });

  const h = (await call("route_price_history", { origin: "Bakı", destination: "Berlin", exclude_rfq_id: now.number })).result;
  assert.equal(h.offers, 2);
  assert.equal(h.stats.min_azn, 1700);
  assert.equal(h.stats.max_azn, 2000);
  assert.equal(h.stats.avg_azn, 1850);
  const none = (await call("route_price_history", { origin: "Bakı", destination: "Tokio" })).result;
  assert.match(none.message, /tapılmadı/);
});

test("offers carry what the price includes, and the automatic reminder shows in the status", async () => {
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Road B", email: "b@road.az" }] });
  const { result: rfq } = await call("create_rfq", base);
  const carriers = (await call("list_carriers")).result.carriers as { id: number }[];
  await call("send_rfq_to_carriers", { rfq_id: rfq.number, audience: "specific", carrier_ids: carriers.map((c) => c.id) });
  const [a, b] = arachiData.quotes;
  Object.assign(a, { price: 900, currency: "USD", extra_details: { Daxildir: "Sığorta, Terminal xərcləri", "Daxil deyil": "Gömrük rüsumları" } });
  Object.assign(b, { extra_details: { _auto_reminded_at: "2026-10-12T10:00" } });

  const cmp = (await call("compare_offers", { rfq_id: rfq.number })).result;
  assert.equal(cmp.rankings[0].offers[0].includes, "Sığorta, Terminal xərcləri");
  assert.equal(cmp.rankings[0].offers[0].excludes, "Gömrük rüsumları");

  const list = (await call("list_offers", { rfq_id: rfq.number })).result;
  const status = Object.fromEntries(list.carriers.map((c: { carrier: string; status: string }) => [c.carrier, c.status]));
  assert.match(status["Road B"], /avtomatik xatırlatma göndərilib/);
  assert.doesNotMatch(status["Road A"], /avtomatik/);
});
