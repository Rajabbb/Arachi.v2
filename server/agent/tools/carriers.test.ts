import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import ExcelJS from "exceljs";
import { call, freshDb, textFile } from "../../test/helpers";
import { emptyContext } from "./registry";

beforeEach(freshDb);

test("add_carriers applies the default category and skips unusable rows", async () => {
  const { result } = await call("add_carriers", {
    carriers: [
      { name: "Caspian Trans", email: "info@caspian.az" },
      { name: "Sea Line", email: "ops@sealine.com", category: "sea", subcategory: "Avropa" },
      { name: "No Contact" },
    ],
  });
  assert.equal(result.added, 2);
  assert.equal(result.skipped.length, 1);
  const list = (await call("list_carriers")).result;
  assert.equal(list.carriers.find((c: { name: string }) => c.name === "Caspian Trans").category, "Quru");
  assert.equal((await call("list_carriers", { category: "Dəniz" })).result.count, 1);
});

test("import_carriers reads CSV with Azerbaijani headers and updates duplicates", async () => {
  await call("add_carriers", { carriers: [{ name: "Old", email: "a@x.az" }] });
  const csv = "Şirkət;E-poçt;Telefon;Kateqoriya;Alt kateqoriya\nAlfa;a@x.az;+994501112233;Quru;Türkiyə xətti\nBeta;b@x.az;;Hava;\n";
  const { result } = await call("import_carriers", {}, emptyContext([textFile("base.csv", csv, "text/csv")]));
  assert.deepEqual([result.added, result.updated, result.skipped.length], [1, 1, 0]);
  const alfa = (await call("list_carriers", { subcategory: "türkiyə xətti" })).result.carriers[0];
  assert.equal(alfa.name, "Alfa");
  assert.equal(alfa.phone, "+994501112233");
});

test("import_carriers reads Excel", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Base").addRows([["Name", "Email", "Category"], ["Gamma", "g@x.com", "Dəniz"]]);
  const data = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  const { result } = await call("import_carriers", {}, emptyContext([{ name: "base.xlsx", type: "", data }]));
  assert.equal(result.added, 1);
  await call("remove_carriers", { carrier_ids: [1] });
  assert.equal((await call("list_carriers")).result.count, 0);
});
