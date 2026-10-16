import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb, RFQ_DEFAULTS } from "../../test/helpers";
import { arachiData, installFakeArachi } from "../../test/fakeArachi";
import { tools } from ".";
import { emptyContext, resolveParams } from "./registry";
import { customerPrice } from "./documentTools";
import { panelDate } from "./arachiTools";

let restore: () => void;
before(() => {
  restore = installFakeArachi();
});
after(() => restore());
beforeEach(freshDb);

const stored = () => arachiData.rfqs[arachiData.rfqs.length - 1] as Record<string, unknown>;

test("only origin, destination and cargo type are mandatory for the agent; the rest is optional", async () => {
  const tool = tools.get("create_rfq")!;
  const missing = resolveParams(tool, { origin: "Bakı", destination: "Tbilisi" });
  assert.ok("error" in missing && /cargo_type/.test(missing.error));
  const minimal = resolveParams(tool, { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un" });
  assert.ok(!("error" in minimal));
  assert.ok(!("error" in minimal) && minimal.params.weight_kg === 0 && minimal.params.volume_amount === 0 && minimal.params.transport_mode === "");
  // An empty mandatory field is refused with a message that makes the agent ask the user.
  await assert.rejects(call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: " " }), /yükün növü/);
  const noUnit = resolveParams(tool, { ...RFQ_DEFAULTS, origin: "A", destination: "B", volume_unit: undefined });
  assert.ok(!("error" in noUnit) && noUnit.params.volume_unit === "CBM");
  const badUnit = resolveParams(tool, { ...RFQ_DEFAULTS, origin: "A", destination: "B", volume_unit: "m3" });
  assert.ok("error" in badUnit);
  const badMode = resolveParams(tool, { ...RFQ_DEFAULTS, origin: "A", destination: "B", transport_mode: "Qatar" });
  assert.ok("error" in badMode);
  assert.ok(!("error" in resolveParams(tool, { ...RFQ_DEFAULTS, origin: "A", destination: "B" })));
});

test("a full RFQ is written exactly like the panel writes it", async () => {
  const { result } = await call("create_rfq", {
    origin: "Bakı, Azərbaycan",
    destination: "İstanbul, Türkiyə",
    cargo_type: "Tekstil",
    weight_kg: 1200,
    volume_amount: 15,
    volume_unit: "Palet",
    transport_mode: "Quru",
    loading_date: "2026-10-12T10:30",
    delivery_deadline: "2026-10-20",
    truck_type: "Tentli",
    hs_code: "6109.10",
    stackable: "Non-stackable",
    shipment_type: "LTL",
    incoterm: "FOB",
    adr: "Klass 3",
    temperature: "+2 to +8 °C",
    notes: "Çox ehtiyatla",
  });
  assert.equal(result.number, 1);
  const row = stored();
  assert.equal(row.volume_m3, 15, "the amount goes to the volume field, the unit to the text line (as in the panel)");
  assert.equal(row.transportation_mode, "Quru (Road)");
  assert.equal(row.stackable, "Non-stackable");
  assert.equal(row.shipment_type, "LTL");
  assert.equal(row.deadline, "2026-10-12T10:30");
  assert.equal(row.send_option, "none");
  assert.deepEqual(row.required_fields, [
    "Loading Date: 2026-10-12 10:30 AM",
    "Truck Type: Tentli",
    "HS Code: 6109.10",
    "Stackable / Non-stackable: Non-stackable",
    "Shipment Type: LTL",
    "Incoterm: FOB",
    "Dangerous Goods (ADR): Klass 3",
    "Temperature Requirement: +2 to +8 °C",
    "Delivery Deadline: 2026-10-20",
    "Additional Information: Çox ehtiyatla",
    "Həcm / Palet: 15 Palet",
  ]);
});

test("a minimal RFQ only carries what was given, and the unit line is always there", async () => {
  await call("create_rfq", { ...RFQ_DEFAULTS, origin: "A", destination: "B", volume_unit: "CBM", volume_amount: 2.5, transport_mode: "Hava" });
  const row = stored();
  assert.deepEqual(row.required_fields, ["Həcm / Palet: 2.5 CBM"]);
  assert.equal(row.transportation_mode, "Hava (Air)");
  assert.equal(row.stackable, "");
  assert.equal(row.truck_type, "");
});

test("bad numbers and dates are refused before anything is created", async () => {
  const base = { ...RFQ_DEFAULTS, origin: "A", destination: "B" };
  await assert.rejects(call("create_rfq", { ...base, volume_amount: -1 }), /miqdarı/);
  await assert.rejects(call("create_rfq", { ...base, weight_kg: -3 }), /Çəki/);
  await assert.rejects(call("create_rfq", { ...base, loading_date: "12.10.2026" }), /YYYY-MM-DD/);
  await assert.rejects(call("create_rfq", { ...base, delivery_deadline: "2026-13-45" }), /YYYY-MM-DD/);
  assert.equal(arachiData.rfqs.length, 0);
});

test("the agent can read every field of an RFQ back", async () => {
  await call("create_rfq", { ...RFQ_DEFAULTS, origin: "A", destination: "B", incoterm: "DAP", stackable: "Stackable" });
  const { result } = await call("list_rfqs");
  const first = result.rfqs[0];
  assert.equal(first.stackable, "Stackable");
  assert.ok((first.details as string[]).includes("Incoterm: DAP"));
  assert.ok((first.details as string[]).includes("Həcm / Palet: 10 Palet"));
});

test("panelDate writes dates the way the panel does", () => {
  assert.equal(panelDate("x", "2026-10-12"), "2026-10-12");
  assert.equal(panelDate("x", "2026-10-12T00:05"), "2026-10-12 12:05 AM");
  assert.equal(panelDate("x", "2026-10-12T12:00"), "2026-10-12 12:00 PM");
  assert.equal(panelDate("x", "2026-10-12 18:45"), "2026-10-12 06:45 PM");
  assert.throws(() => panelDate("x", "tomorrow"), /YYYY-MM-DD/);
});

test("customer quote: a fixed fee replaces the percentage, and chosen terms are saved", async () => {
  const { result: rfq } = await call("create_rfq", { ...RFQ_DEFAULTS, origin: "A", destination: "B" });
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }] });
  await call("send_rfq_to_carriers", { rfq_id: rfq.number });
  Object.assign(arachiData.quotes[0], { price: 1000, currency: "USD", transit_time_days: 5 });

  const fixed = (await call("create_customer_quote", { rfq_id: rfq.number, service_fee_amount: 150, terms: ["customs", "dimensions"] })).result;
  assert.equal(fixed.customer_total, "1,150.00 USD");
  assert.match(fixed.service_fee, /150\.00 USD \(sabit\)/);
  assert.deepEqual(fixed.terms, ["customs", "dimensions"]);
  const saved = arachiData.customerQuotes.at(-1)!;
  assert.equal(saved.margin_type, "fixed");
  assert.equal(saved.margin_value, 150);
  assert.equal(saved.final_price, 1150);
  assert.match(String(saved.terms_conditions), /Gömrük rüsumları.*\|.*Təklif verilən qiymət/s);

  const pct = (await call("create_customer_quote", { rfq_id: rfq.number, service_fee_percent: 12 })).result;
  assert.equal(pct.customer_total, "1,120.00 USD");
  assert.equal(arachiData.customerQuotes.at(-1)!.margin_type, "percent");
  assert.deepEqual(pct.terms, []);

  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, service_fee_amount: -5 }), /mənfi/);
});

test("customerPrice: fixed fee in cents, percent unchanged", () => {
  assert.deepEqual(customerPrice(100, "USD", "USD", 10, 0, 0), { cost: 100, fee: 10, total: 110 });
  assert.deepEqual(customerPrice(100, "USD", "USD", 10, 0, 7.5), { cost: 100, fee: 7.5, total: 107.5 });
});

test("cards list exactly who was added and who was skipped", async () => {
  const { emptyContext } = await import("./registry");
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }] });
  const ctx = emptyContext();
  await call("add_carriers", { carriers: [{ name: "Again", email: "a@road.az" }, { name: "Road B", email: "b@road.az" }, { name: "Road C", email: "c@road.az" }] }, ctx);
  const card = ctx.cards[0];
  assert.equal(card.title, "2 daşıyıcı əlavə edildi");
  assert.deepEqual(card.items, ["Road B · b@road.az", "Road C · c@road.az"]);
  assert.match(card.note ?? "", /atlandı \(1\).*a@road\.az/);

  const none = emptyContext();
  await call("add_carriers", { carriers: [{ name: "Road B", email: "b@road.az" }] }, none);
  assert.equal(none.cards[0].title, "Yeni daşıyıcı əlavə olunmadı");
  assert.equal(none.cards[0].tone, "warning");
});

test("a card is made for every tool that reports, and read tools show what they found", async () => {
  const { emptyContext } = await import("./registry");
  const { cardFor } = await import("./toolCards");
  for (const name of Object.keys(cardFor)) assert.ok(tools.get(name), `${name} is a registered tool`);
  const ctx = emptyContext();
  await call("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Berlin" }, ctx);
  await call("list_rfqs", {}, ctx);
  await call("get_dashboard", {}, ctx);
  assert.deepEqual(ctx.cards.map((c) => c.title.split(":")[0].replace(/ \d+.*/, "")), ["RFQ #1 yaradıldı", "RFQ siyahısı", "Ümumi göstəricilər"].map((t) => t.split(":")[0].replace(/ \d+.*/, "")));
  assert.match(ctx.cards[1].items![0], /#1 · Bakı → Berlin/);
});

test("several different cargo items go into one RFQ; totals and the combined name are computed", async () => {
  const asked: string[] = [];
  const ctx = emptyContext();
  ctx.askUser = async (_t, _p, summary) => {
    asked.push(summary);
    return { id: "c1", text: summary, status: "pending", result: "" };
  };
  const items = [
    { name: "Meyvə", weight_kg: 5000, hs_code: "0808" },
    { name: "Xalça", weight_kg: 3000.5, pallets: 4, stackable: "Non-stackable" },
    { name: "Mebel", volume_m3: 10, incoterm: "fob" },
    { name: "  " },
  ];
  const plan = await call("create_rfq", { origin: "Bakı", destination: "Moskva", cargo_type: "x", incoterm: "DAP", cargo_items: items }, ctx);
  assert.equal(JSON.parse(plan.content).status, "waiting_for_user");
  assert.match(asked[0], /Yük 1: Meyvə — 5000 kq · HS 0808 · DAP/);
  assert.match(asked[0], /Yük 3: Mebel — 10 m³ · FOB/);
  assert.match(asked[0], /Çəki: 8000\.5 kq \(cəmi\)/);

  await call("create_rfq", { origin: "Bakı", destination: "Moskva", cargo_type: "x", incoterm: "DAP", cargo_items: items });
  const r = stored();
  assert.equal((r.cargo_items as unknown[]).length, 3);
  assert.equal(r.cargo_type, "Meyvə + Xalça + Mebel");
  assert.equal(r.weight_kg, 8000.5);
  assert.deepEqual((r.cargo_items as { incoterm?: string }[]).map((i) => i.incoterm), ["DAP", "DAP", "FOB"]);
});

test("a single cargo item is an ordinary RFQ", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 900, cargo_items: [{ name: "Un", weight_kg: 5 }] });
  const r = stored();
  assert.equal(r.cargo_type, "Un");
  assert.equal(r.weight_kg, 900);
  assert.ok(!r.cargo_items);
});
