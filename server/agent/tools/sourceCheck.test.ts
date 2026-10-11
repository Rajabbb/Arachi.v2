import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { checkRfq, numberSupported } from "./sourceCheck";
import { toAttachment } from "../files";

const base = { transport_mode: "Quru", shipment_type: "", truck_type: "", stackable: "", incoterm: "", adr: "", notes: "", volume_amount: 10, container_type: "" };
const file = (text: string) => ({ text, fromFile: true });

test("the shipment type must fit the transport mode, whatever the source says", () => {
  assert.equal(checkRfq({ ...base, transport_mode: "Hava", shipment_type: "LCL" }, null).params.shipment_type, "");
  assert.equal(checkRfq({ ...base, transport_mode: "Quru", shipment_type: "FCL" }, null).params.shipment_type, "");
  assert.equal(checkRfq({ ...base, transport_mode: "Dəniz", shipment_type: "FCL", container_type: "20DC" }, null).params.shipment_type, "FCL");
  const air = checkRfq({ ...base, transport_mode: "Hava", truck_type: "Refrijerator" }, null);
  assert.equal(air.params.truck_type, "");
  assert.match(String(air.params.notes), /Nəqliyyat vasitəsi: Refrijerator/);
});

test("from a document: invented incoterm, stackable and shipment type are removed", () => {
  const src = file("Frankfurt → Sumqayıt, hava, 680 kq, 10 palet. Sığorta opsiyası. FCA Frankfurt.");
  const r = checkRfq({ ...base, transport_mode: "Quru", shipment_type: "LTL", stackable: "Non-stackable", incoterm: "CIP" }, src);
  assert.equal(r.params.incoterm, "");
  assert.equal(r.params.stackable, "");
  assert.equal(r.params.shipment_type, "");
  assert.equal(r.warnings.length, 3);
  assert.equal(checkRfq({ ...base, incoterm: "FCA" }, src).params.incoterm, "FCA");
});

test("from a document: dangerous goods that must be verified are not confirmed", () => {
  const src = file("A02 litium-ion batareya, UN3481 ola bilər, DG statusu SDS və UN38.3 ilə yoxlanmalıdır. 10 palet");
  const r = checkRfq({ ...base, adr: "Klass 9 (UN3481)" }, src);
  assert.equal(r.params.adr, "");
  assert.match(String(r.params.notes), /DG statusu təsdiqlənməyib/);
  assert.ok(r.warnings.some((w) => /yoxlanmalıdır/.test(w)));
  const confirmed = checkRfq({ ...base, adr: "Klass 3" }, file("Boya, ADR Klass 3, UN1263, 10 palet"));
  assert.equal(confirmed.params.adr, "Klass 3");
});

test("a volume the document does not state is refused, a lot total is accepted", () => {
  const doc = "Lot 1: 20 m³\nLot 2: 21.6 m³\nÇəki 12 500 kq";
  assert.equal(numberSupported(41.6, doc), true, "sum of two lot volumes");
  assert.equal(numberSupported(20, doc), true);
  assert.equal(numberSupported(130, doc), false);
  assert.throws(() => checkRfq({ ...base, volume_amount: 130 }, file(doc)), /faylda yazılmayıb/);
  assert.doesNotThrow(() => checkRfq({ ...base, volume_amount: 41.6 }, file(doc)));
  // Plain chat is not checked: details may be in earlier messages.
  assert.doesNotThrow(() => checkRfq({ ...base, volume_amount: 130 }, { text: "sorğu yarat", fromFile: false }));
});

test("every sheet of an Excel file reaches the model, .xlsm too", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Yukler").addRow(["Marşrut", "Bursa → Bakı"]);
  wb.addWorksheet("HS").addRow(["HS", "6907.21"]);
  wb.addWorksheet("Telebler").addRow(["Temperatur", "+5…+25°C"]);
  const data = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  for (const name of ["rfq.xlsx", "rfq.xlsm"]) {
    const a = await toAttachment({ name, type: "", data });
    assert.equal(a.kind, "text");
    const text = (a as { text: string }).text;
    assert.match(text, /# Yukler[\s\S]*# HS[\s\S]*# Telebler/);
    assert.match(text, /6907\.21/);
    assert.match(text, /\+5…\+25°C/);
  }
});

test("a file that cannot be read becomes a note, not data", async () => {
  const a = await toAttachment({ name: "x.xlsx", type: "", data: Buffer.from("zzz").toString("base64") });
  assert.equal(a.kind, "note");
});
