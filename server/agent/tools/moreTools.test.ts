import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb, textFile } from "../../test/helpers";
import { arachiData, fakeJwt, installFakeArachi } from "../../test/fakeArachi";
import { tools } from ".";
import { emptyContext } from "./registry";
import { asUser } from "../../auth/current";
import { fileFromToken } from "../../domain/files";
import { customerPrice } from "./documentTools";

let restore: () => void;
before(() => {
  restore = installFakeArachi();
});
after(() => restore());
beforeEach(freshDb);

/** Three carriers and one open RFQ (panel number 1), all sent. */
async function setup() {
  const { result: rfq } = await call("create_rfq", { origin: "Bakı", destination: "Berlin", cargo_type: "Xalça", weight_kg: 1200 });
  await call("add_carriers", {
    carriers: [
      { name: "Road A", email: "a@road.az" },
      { name: "Road B", email: "b@road.az" },
      { name: "Road C", email: "c@road.az" },
    ],
  });
  const carriers = (await call("list_carriers")).result.carriers as { id: number; name: string }[];
  return { rfq, carriers };
}

function ask() {
  const ctx = emptyContext();
  const shown: { summary: string; params: Record<string, unknown> }[] = [];
  ctx.askUser = async (_t, params, summary) => (shown.push({ summary, params }), { id: "c", text: summary, status: "pending", result: "" });
  return { ctx, shown };
}

async function downloaded(url: string) {
  const file = await fileFromToken(url.replace("/api/files/", ""));
  assert.ok(file, "the download link works");
  return file!;
}

test("categories: carriers are put into (new) categories and subcategories, listed, and cleared", async () => {
  const { carriers } = await setup();
  const set = await call("set_carrier_category", { carrier_ids: [carriers[0].id, carriers[1].id], category: "VIP", subcategory: "Türkiyə" });
  assert.equal(set.result.updated, 2);
  assert.equal(arachiData.categories.length, 1);
  // Same names again reuse them (case-insensitive) instead of creating copies.
  await call("set_carrier_category", { carrier_ids: [carriers[2].id], category: "vip", subcategory: "türkiyə" });
  assert.equal(arachiData.categories.length, 1);
  assert.equal(arachiData.subCategories.length, 1);

  const cats = (await call("list_categories")).result;
  assert.deepEqual(cats.categories.map((c: { name: string; carriers: number }) => [c.name, c.carriers]), [["VIP", 3]]);
  assert.equal(cats.categories[0].subcategories[0].carriers, 3);
  const listed = (await call("list_carriers", { category: "vip" })).result;
  assert.equal(listed.total, 3);
  assert.equal(listed.carriers[0].category, "VIP");
  assert.equal(listed.carriers[0].subcategory, "Türkiyə");

  await call("set_carrier_category", { carrier_ids: [carriers[0].id] });
  assert.equal((await call("list_carriers", { category: "VIP" })).result.total, 2);
  assert.equal((await call("list_categories")).result.carriers_without_category, 1);

  await assert.rejects(call("set_carrier_category", { carrier_ids: [] , category: "A" }), /seçilməyib/);
  await assert.rejects(call("set_carrier_category", { carrier_ids: [carriers[0].id], subcategory: "x" }), /kateqoriya adı/);
  await assert.rejects(call("set_carrier_category", { carrier_ids: [9999], category: "A" }), /daşıyıcı yoxdur/);
});

test("sending by category reaches only that category, after Bəli, and says which categories exist when the name is wrong", async () => {
  const { rfq, carriers } = await setup();
  await call("set_carrier_category", { carrier_ids: [carriers[0].id, carriers[2].id], category: "A" });
  const { ctx, shown } = ask();
  await call("send_rfq_to_carriers", { rfq_id: rfq.number, audience: "category", category: "a" }, ctx);
  assert.match(shown[0].summary, /2 daşıyıcıya/);
  assert.match(shown[0].summary, /a@road\.az/);
  assert.match(shown[0].summary, /c@road\.az/);
  assert.doesNotMatch(shown[0].summary, /b@road\.az/);
  assert.equal(arachiData.mails.length, 0);
  // What runs after Bəli is exactly the carriers shown.
  await call("send_rfq_to_carriers", shown[0].params);
  assert.deepEqual(arachiData.mails.map((m) => m.to).sort(), ["a@road.az", "c@road.az"]);
  await assert.rejects(call("send_rfq_to_carriers", { rfq_id: rfq.number, audience: "category", category: "Z" }, ask().ctx), /Mövcud kateqoriyalar: A/);
});

test("remove_carriers asks first, deletes exactly what was shown, and never someone else's carrier", async () => {
  const { carriers } = await setup();
  const { ctx, shown } = ask();
  const plan = await call("remove_carriers", { carrier_ids: [carriers[0].id, carriers[1].id] }, ctx);
  assert.equal(JSON.parse(plan.content).status, "waiting_for_user");
  assert.match(shown[0].summary, /2 daşıyıcı bazadan SİLİNƏCƏK/);
  assert.equal(arachiData.carriers.length, 3, "nothing deleted before Bəli");
  const done = await call("remove_carriers", shown[0].params);
  assert.equal(done.result.removed, 2);
  assert.deepEqual(arachiData.carriers.map((c) => c.company_name), ["Road C"]);
  await assert.rejects(call("remove_carriers", { carrier_ids: [carriers[0].id] }), /daşıyıcı yoxdur/);

  // Another customer's carrier id is rejected before anything is sent to arachi.co.
  const other = <T>(fn: () => Promise<T>) => asUser(99, fn, fakeJwt(2));
  const res = await other(() => tools.execute("remove_carriers", { carrier_ids: [carriers[2].id] }));
  assert.equal(res.ok, false);
  assert.equal(arachiData.carriers.length, 1);
});

test("import_carriers adds the carriers of an attached file once and can file them in a category", async () => {
  await call("add_carriers", { carriers: [{ name: "Old", email: "old@road.az" }] });
  const csv = "name,email\nNew One,new1@road.az\nNew Two,new2@road.az\nOld again,old@road.az\n";
  const ctx = emptyContext([textFile("list.csv", csv, "text/csv")]);
  const { result } = await call("import_carriers", { category: "Yeni" }, ctx);
  assert.equal(result.added, 2);
  assert.equal(result.category, "Yeni");
  const listed = (await call("list_carriers", { category: "Yeni" })).result;
  assert.deepEqual(listed.carriers.map((c: { email: string }) => c.email), ["new1@road.az", "new2@road.az"]);
  assert.equal((await call("list_categories")).result.carriers_without_category, 1, "the old carrier is untouched");
  await assert.rejects(call("import_carriers", {}, emptyContext([textFile("notes.txt", "x")])), /Excel\/CSV faylı tapılmadı/);
  await assert.rejects(call("import_carriers", {}), /Excel\/CSV faylı tapılmadı/);
});

test("cancel_winner reopens the RFQ; offer_history shows earlier versions", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.number });
  const quote = arachiData.quotes.find((q) => q.carrier_id === carriers[0].id)!;
  Object.assign(quote, {
    price: 800,
    currency: "USD",
    transit_time_days: 5,
    quote_history: [{ version: 1, price: 950, currency: "USD", transit_time_days: 6, date: "2026-10-01T10:00:00" }],
  });
  await assert.rejects(call("cancel_winner", { rfq_id: rfq.number }), /qalib yoxdur/);
  await call("select_winner", { rfq_id: rfq.number, offer_id: quote.id });
  assert.equal(arachiData.rfqs[0].status, "closed");
  const back = await call("cancel_winner", { rfq_id: rfq.number });
  assert.equal(back.result.was_winner, "Road A");
  assert.equal(arachiData.rfqs[0].status, "open");
  assert.equal(quote.is_winner, false);

  const history = (await call("offer_history", { rfq_id: rfq.number })).result;
  assert.equal(history.carriers.length, 1);
  assert.equal(history.carriers[0].current.price, 800);
  assert.deepEqual(history.carriers[0].earlier_versions.map((v: { price: number }) => v.price), [950]);
  assert.equal((await call("offer_history", { rfq_id: rfq.number, carrier: "nobody" })).result.carriers.length, 0);
});

test("export_rfqs makes an Excel or PDF file from arachi.co's report, by panel number, and rejects bad input", async () => {
  const { rfq, carriers } = await setup();
  await call("create_rfq", { origin: "Bakı", destination: "Milan" });
  await call("send_rfq_to_carriers", { rfq_id: rfq.number });
  Object.assign(arachiData.quotes.find((q) => q.carrier_id === carriers[0].id)!, { price: 700, currency: "EUR", transit_time_days: 4 });

  const xlsx = (await call("export_rfqs", {}, emptyContext())).result;
  assert.equal(xlsx.rows, 2);
  const file = await downloaded(xlsx.download.url);
  assert.match(file.name, /^RFQ-hesabati-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(Buffer.from(file.data).subarray(0, 2).toString(), "PK", "an xlsx is a zip");

  const pdf = (await call("export_rfqs", { what: "offers", format: "pdf" })).result;
  assert.equal(pdf.rows, 1);
  assert.equal(Buffer.from((await downloaded(pdf.download.url)).data).subarray(0, 4).toString(), "%PDF");

  // "selected" takes panel numbers: RFQ #2 is Milan, whatever its database id.
  const ctx = emptyContext();
  await call("export_rfqs", { period: "selected", rfq_ids: [2] }, ctx);
  assert.equal(ctx.downloads.length, 1);
  await assert.rejects(call("export_rfqs", { period: "selected", rfq_ids: [] }), /nömrələri verilməyib/);
  await assert.rejects(call("export_rfqs", { period: "selected", rfq_ids: [77] }), /tapılmadı/);
  await assert.rejects(call("export_rfqs", { period: "date_range" }), /start_date/);
  await assert.rejects(call("export_rfqs", { period: "date_range", start_date: "12.10.2026" }), /YYYY-MM-DD/);
  await assert.rejects(call("export_rfqs", { what: "offers", period: "selected", rfq_ids: [2] }), /təklif tapılmadı/);
});

test("customer quote: fee on top, saved on arachi.co, PDF made, winner preferred, validity and currency checked", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.number });
  const [qa, qb] = [carriers[0].id, carriers[1].id].map((id) => arachiData.quotes.find((q) => q.carrier_id === id)!);
  Object.assign(qa, { price: 1000, currency: "USD", transit_time_days: 5 });
  Object.assign(qb, { price: 900, currency: "USD", transit_time_days: 8 });

  // No winner yet: the cheapest offer is the base.
  const cheap = (await call("create_customer_quote", { rfq_id: rfq.number }, emptyContext())).result;
  assert.equal(cheap.offer_id, qb.id);
  assert.equal(cheap.carrier_price, "900.00 USD");
  assert.equal(cheap.customer_total, "990.00 USD");
  assert.equal(cheap.quote_number, `Q-1-${qb.id}`);
  assert.match(cheap.validity_note, /standart 7 gün/);
  assert.equal(Buffer.from((await downloaded(cheap.download.url)).data).subarray(0, 4).toString(), "%PDF");
  const saved = arachiData.customerQuotes.at(-1)!;
  assert.deepEqual(
    [saved.request_id, saved.quote_id, saved.base_price, saved.margin_type, saved.margin_value, saved.final_price, saved.currency],
    [arachiData.rfqs[0].id, qb.id, 900, "percent", 10, 990, "USD"],
  );

  // With a winner, the winner is used; a chosen fee and date are respected.
  await call("select_winner", { rfq_id: rfq.number, offer_id: qa.id });
  const win = (await call("create_customer_quote", { rfq_id: rfq.number, service_fee_percent: 15, valid_until: "2999-01-01", language: "en", customer_name: "ACME" })).result;
  assert.equal(win.offer_id, qa.id);
  assert.equal(win.customer_total, "1,150.00 USD");
  assert.equal(win.valid_until, "2999-01-01");
  assert.equal(win.validity_note, undefined);

  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, valid_until: "2020-01-01" }), /əvvəl ola bilməz/);
  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, valid_until: "soon" }), /YYYY-MM-DD/);
  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, service_fee_percent: -1 }), /mənfi/);
  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, currency: "EUR" }), /eur_usd_rate/);
  const eur = (await call("create_customer_quote", { rfq_id: rfq.number, currency: "EUR", eur_usd_rate: 1.25, service_fee_percent: 0 })).result;
  assert.equal(eur.customer_total, "800.00 EUR");
  await assert.rejects(call("create_customer_quote", { rfq_id: rfq.number, offer_id: 424242 }), /tapılmadı/);

  // An RFQ with no priced offer cannot be quoted.
  const { result: empty } = await call("create_rfq", { origin: "A", destination: "B" });
  await assert.rejects(call("create_customer_quote", { rfq_id: empty.number }), /hələ qiymətli təklif yoxdur/);
});

test("customerPrice rounds to cents and refuses unsupported conversions", () => {
  assert.deepEqual(customerPrice(333.33, "USD", "USD", 10, 0), { cost: 333.33, fee: 33.33, total: 366.66 });
  assert.equal(customerPrice(100, "USD", "EUR", 0, 1.25).total, 80);
  assert.throws(() => customerPrice(100, "AZN", "USD", 0, 1.7), /EUR ↔ USD/);
});
