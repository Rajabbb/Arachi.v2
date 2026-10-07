import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import ExcelJS from "exceljs";
import { call, freshDb } from "../../test/helpers";
import { emptyContext } from "./registry";
import { fileFromToken } from "../../domain/files";
import { addDays } from "../../domain/rfqs";
import { customerPrice, DEFAULT_QUOTE_VALIDITY_DAYS, quoteValidity } from "./customerQuote";

beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "Şəki", cargo_type: "Çay", weight_kg: 1500 });
  await call("add_carriers", { carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }] });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 1000, transit_days: 2 });
  await call("record_offer", { rfq_id: 1, carrier_id: 2, price: 900, transit_days: 3 });
});

const stored = async (url: string) => (await fileFromToken(url.split("/api/files/")[1]))!;

test("service fee and currency conversion", () => {
  assert.deepEqual(customerPrice(1000, "USD", "USD", 10, 0), { cost: 1000, fee: 100, total: 1100 });
  assert.deepEqual(customerPrice(1000, "EUR", "USD", 5, 1.1), { cost: 1100, fee: 55, total: 1155 });
  assert.throws(() => customerPrice(1000, "EUR", "USD", 10, 0));
});

test("customer quote PDF uses the cheapest offer plus 10% by default", async () => {
  const ctx = emptyContext();
  const { result } = await call("create_customer_quote", { rfq_id: 1 }, ctx);
  assert.equal(result.customer_total, "990.00 USD");
  assert.equal(ctx.downloads.length, 1);
  const file = await stored(result.download.url);
  assert.equal(file.type, "application/pdf");
  assert.equal(Buffer.from(file.data).subarray(0, 5).toString(), "%PDF-");
});

test("winner is preferred, fee is a parameter", async () => {
  await call("select_winner", { rfq_id: 1, offer_id: 1, notify_winner: false });
  const { result } = await call("create_customer_quote", { rfq_id: 1, service_fee_percent: 15, language: "en" });
  assert.equal(result.customer_total, "1,150.00 USD");
});

test("Excel export has RFQs, offers and statuses; PDF export works", async () => {
  const { result } = await call("export_rfqs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from((await stored(result.download.url)).data) as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["RFQ-lər", "Təkliflər", "Statuslar"]);
  assert.equal(wb.getWorksheet("Təkliflər")!.rowCount, 3);
  const pdf = (await call("export_rfqs", { rfq_id: 1, format: "pdf" })).result;
  assert.match(pdf.download.name, /^RFQ-1\.pdf$/);
});

test("quote validity: carrier date, else the standard period, user override wins with a warning", () => {
  const issued = "2026-10-07";
  assert.equal(DEFAULT_QUOTE_VALIDITY_DAYS, 7);
  assert.deepEqual(
    [quoteValidity(issued, "", 0, "").valid_until, quoteValidity(issued, "", 0, "").source],
    ["2026-10-14", "default"],
  );
  const carrier = quoteValidity(issued, "2026-10-20", 0, "");
  assert.deepEqual([carrier.valid_until, carrier.source, carrier.warning], ["2026-10-20", "carrier", ""]);
  const expired = quoteValidity(issued, "2026-10-01", 0, "");
  assert.deepEqual([expired.valid_until, expired.source], ["2026-10-14", "default"]);
  assert.match(expired.warning, /bitib/);
  const longer = quoteValidity(issued, "2026-10-12", 10, "");
  assert.deepEqual([longer.valid_until, longer.source], ["2026-10-17", "user"]);
  assert.match(longer.warning, /2026-10-12/);
  assert.equal(quoteValidity(issued, "2026-10-30", 10, "").warning, "");
  assert.equal(quoteValidity(issued, "", 10, "2026-11-01").valid_until, "2026-11-01");
  assert.throws(() => quoteValidity(issued, "", 0, "2026-10-01"));
  assert.throws(() => quoteValidity(issued, "", 0, "01.11.2026"));
});

test("customer quote takes the carrier's validity date, else 7 days", async () => {
  const today = new Date().toISOString().slice(0, 10);
  let { result } = await call("create_customer_quote", { rfq_id: 1 });
  assert.equal(result.valid_until, addDays(7, new Date(`${today}T00:00:00Z`)));
  assert.equal(result.validity_source, "default");
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 800, transit_days: 2, valid_until: addDays(20) });
  ({ result } = await call("create_customer_quote", { rfq_id: 1 }));
  assert.equal(result.customer_total, "880.00 USD");
  assert.deepEqual([result.valid_until, result.validity_source, result.warning], [addDays(20), "carrier", undefined]);
  ({ result } = await call("create_customer_quote", { rfq_id: 1, validity_days: 30 }));
  assert.equal(result.validity_source, "user");
  assert.match(result.warning, /Diqqət/);
});
