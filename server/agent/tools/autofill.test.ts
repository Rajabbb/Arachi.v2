import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import ExcelJS from "exceljs";
import { call, freshDb } from "../../test/helpers";
import { parseDate, parseTransport, parseWeightKg } from "./autofill";
import { fileToBlock } from "../files";

beforeEach(freshDb);

test("normalises weights, dates and transport names", () => {
  assert.equal(parseWeightKg("12 t"), 12000);
  assert.equal(parseWeightKg("12,5 ton"), 12500);
  assert.equal(parseWeightKg("1.200 kg"), 1200);
  assert.equal(parseWeightKg("800 kq"), 800);
  assert.equal(parseWeightKg(450), 450);
  assert.equal(parseDate("02.11.2026"), "2026-11-02");
  assert.equal(parseDate("2026-11-02"), "2026-11-02");
  assert.equal(parseDate("31.02.2026"), undefined);
  assert.equal(parseTransport("TIR"), "Quru");
  assert.equal(parseTransport("40ft container"), "Dəniz");
  assert.equal(parseTransport("air freight"), "Hava");
});

test("autofill_rfq creates the RFQ when the document is complete", async () => {
  const { result } = await call("autofill_rfq", {
    fields: { origin: "Bakı", destination: "Milan", cargo_type: "Xalça", weight: "3 t", loading_date: "10.11.2026", transport_type: "truck" },
    source_file: "sifaris.pdf",
  });
  assert.equal(result.created, true);
  assert.equal(result.rfq.weight_kg, 3000);
  assert.equal(result.rfq.loading_date, "2026-11-10");
  assert.equal(result.rfq.source, "file:sifaris.pdf");
});

test("autofill_rfq returns the draft and what is missing", async () => {
  const { result } = await call("autofill_rfq", { fields: { origin: "Bakı", cargo_type: "Xalça" } });
  assert.equal(result.created, false);
  assert.deepEqual(result.missing, ["destination", "weight_kg"]);
});

test("Excel attachments reach the model as text", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("RFQ").addRows([["Haradan", "Haraya"], ["Bakı", "Tbilisi"]]);
  const data = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  const block = await fileToBlock({ name: "rfq.xlsx", type: "", data });
  assert.equal(block.type, "document");
  assert.match(JSON.stringify(block), /Bakı,Tbilisi/);
});
