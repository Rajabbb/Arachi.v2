import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import ExcelJS from "exceljs";
import { call, freshDb, textFile } from "../../test/helpers";
import { emptyContext } from "./registry";
import { matchCategory } from "../../domain/carriers";
import { parseCarrierLines, tableCarriers } from "./carrierParse";

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
  assert.deepEqual(result.category_defaulted, { count: 1, category: "Quru", names: ["Caspian Trans"] });
  const list = (await call("list_carriers")).result;
  assert.equal(list.carriers.find((c: { name: string }) => c.name === "Caspian Trans").category, "Quru");
  assert.equal((await call("list_carriers", { category: "Dəniz" })).result.count, 1);
});

test("import_carriers reads CSV with Azerbaijani headers and skips carriers already in the base", async () => {
  await call("add_carriers", { carriers: [{ name: "Alfa", email: "a@x.az" }] });
  const csv = "Şirkət;E-poçt;Telefon;Kateqoriya;Alt kateqoriya\nALFA ;A@x.az;+994501112233;Quru;Türkiyə xətti\nBeta;b@x.az;;Hava;\n";
  const { result } = await call("import_carriers", {}, emptyContext([textFile("base.csv", csv, "text/csv")]));
  assert.deepEqual([result.added, result.skipped.length], [1, 1]);
  assert.match(result.skipped[0].reason, /artıq bazada var/);
  // The carrier already in the base is left as it was.
  const alfa = (await call("list_carriers")).result.carriers.find((c: { name: string }) => c.name === "Alfa");
  assert.deepEqual([alfa.phone, alfa.subcategory], ["", ""]);
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

test("a carrier is not added twice: same email or same name, in the base or in the list", async () => {
  await call("add_carriers", { carriers: [{ name: "Caspian Trans", email: "info@caspian.az" }, { name: "Phone Only", phone: "+994" }] });
  const { result } = await call("add_carriers", {
    carriers: [
      { name: "caspian  trans", email: "INFO@caspian.az" }, // same carrier
      { name: "Other Name", email: "info@caspian.az" }, // email of another carrier
      { name: "Caspian Trans", email: "new@caspian.az" }, // name of another carrier
      { name: "Phone only", phone: "+995" }, // same name, no email on either
      { name: "New One", email: "n@x.az" },
      { name: "New One", email: "n@x.az" }, // repeated in the list
      { name: "Second", email: "N@x.az" }, // email repeated in the list
    ],
  });
  assert.equal(result.added, 1);
  assert.deepEqual(
    result.skipped.map((s: { row: number; reason: string }) => [s.row, s.reason]),
    [
      [1, "artıq bazada var"],
      [2, "bu email bazada «Caspian Trans» adı ilə var"],
      [3, "bu ad bazada başqa email ilə var (info@caspian.az)"],
      [4, "artıq bazada var"],
      [6, "bu siyahıda təkrarlanır (5-ci sətir)"],
      [7, "bu email bu siyahının 5-ci sətrində «New One» adı ilə var"],
    ],
  );
  assert.equal((await call("list_carriers")).result.count, 3);
});

test("a removed carrier added again is restored, not duplicated", async () => {
  await call("add_carriers", { carriers: [{ name: "Gone", email: "g@x.az" }] });
  await call("remove_carriers", { carrier_ids: [1] });
  const { result } = await call("add_carriers", { carriers: [{ name: "Gone", email: "g@x.az", category: "Hava" }] });
  assert.deepEqual([result.added, result.restored], [0, 1]);
  const list = (await call("list_carriers")).result;
  assert.deepEqual([list.count, list.carriers[0].id, list.carriers[0].category], [1, 1, "Hava"]);
});

test("each carrier keeps its own category; the default only fills the gaps", async () => {
  const { result } = await call("add_carriers", {
    category: "Dəniz",
    carriers: [
      { name: "A", email: "a@x.az", category: "HAVA" },
      { name: "B", email: "b@x.az", category: "Авиа" },
      { name: "C", email: "c@x.az" },
      { name: "D", email: "d@x.az", category: "Türkiyə xətti" },
    ],
  });
  assert.deepEqual(result.by_category, [
    { category: "Hava", subcategory: "", count: 2 },
    { category: "Dəniz", subcategory: "", count: 1 },
    { category: "Türkiyə xətti", subcategory: "", count: 1 },
  ]);
  assert.equal(result.category_defaulted.count, 1);
  assert.deepEqual(result.new_categories, ["Türkiyə xətti"]);
  assert.match(result.note, /update_carriers/);
});

test("category words in Azerbaijani, English, Russian and Turkish", () => {
  const cases: [string, string | null][] = [
    ["DƏNİZ", "Dəniz"], ["Dəniz yolu", "Dəniz"], ["Sea freight", "Dəniz"], ["Морской", "Dəniz"], ["Konteyner", "Dəniz"],
    ["Hava", "Hava"], ["Air cargo", "Hava"], ["Авиа", "Hava"], ["Havayolu", "Hava"],
    ["Dəmir yolu", "Dəmiryolu"], ["Railway", "Dəmiryolu"], ["Ж/Д", "Dəmiryolu"], ["Вагон", "Dəmiryolu"],
    ["Quru", "Quru"], ["TIR", "Quru"], ["Avtomobil", "Quru"], ["Trailer", null], ["Фура", "Quru"], ["Karayolu", "Quru"],
    ["", null], ["Türkiyə xətti", null], ["Repair", null],
  ];
  for (const [value, category] of cases) assert.equal(matchCategory(value), category, value);
});

test("import_carriers takes the category from the column, a section row or the sheet name", async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Hava").addRows([["Daşıyıcılar"], ["Ad", "Email"], ["Sky", "s@x.az"]]);
  wb.addWorksheet("Siyahı").addRows([
    ["Şirkət", "Email", "Daşıma növü", "Xətt"],
    ["Road", "r@x.az", "Quru", "Türkiyə"],
    ["Ship", "sh@x.az", "Dəniz", "Avropa"],
    ["Plain", "p@x.az", "", ""],
  ]);
  const data = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
  const { result } = await call("import_carriers", {}, emptyContext([{ name: "base.xlsx", type: "", data }]));
  assert.equal(result.added, 4);
  const byName = Object.fromEntries(
    (await call("list_carriers")).result.carriers.map((c: { name: string; category: string; subcategory: string }) => [c.name, `${c.category}/${c.subcategory}`]),
  );
  assert.deepEqual(byName, { Plain: "Quru/", Road: "Quru/Türkiyə", Ship: "Dəniz/Avropa", Sky: "Hava/" });
  assert.deepEqual(result.category_defaulted.names, ["Plain"]);

  const sections = tableCarriers("", [
    ["Name", "Email"], ["Dəniz daşıyıcıları"], ["S1", "s1@x.az"], ["Hava"], ["A1", "a1@x.az"],
  ]);
  assert.deepEqual(sections!.map((c: { name: string; category?: string }) => [c.name, c.category]), [["S1", "Dəniz"], ["A1", "Hava"]]);
});

test("update_carriers changes the category of several carriers and refuses a duplicate name or email", async () => {
  await call("add_carriers", { carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }] });
  const { result } = await call("update_carriers", { carrier_ids: [1, 2], category: "dəniz", subcategory: "Avropa" });
  assert.deepEqual(result.carriers.map((c: { category: string; subcategory: string }) => `${c.category}/${c.subcategory}`), ["Dəniz/Avropa", "Dəniz/Avropa"]);
  await assert.rejects(call("update_carriers", { carrier_ids: [2], email: "A@x.az" }), /artıq bu ad və ya email/);
  assert.equal((await call("update_carriers", { carrier_ids: [2], category: "vip kateqoriyası" })).result.carriers[0].category, "vip");
  assert.equal((await call("update_carriers", { carrier_ids: [2], subcategory: "-" })).result.carriers[0].subcategory, "");
});

// Typical lists users type in chat: what each line must become.
const typedLines: [string, { name: string; email?: string; phone?: string; category?: string }][] = [
  ["Asim Logistics - asim@x.az - Dəniz", { name: "Asim Logistics", email: "asim@x.az", category: "Dəniz" }],
  ["Asim Logistics, asim@x.az, Hava", { name: "Asim Logistics", email: "asim@x.az", category: "Hava" }],
  ["Asim Logistics; asim@x.az; +994 50 111 22 33; Quru", { name: "Asim Logistics", email: "asim@x.az", phone: "+994 50 111 22 33", category: "Quru" }],
  ["Asim Logistics\tasim@x.az\tDəmir yolu", { name: "Asim Logistics", email: "asim@x.az", category: "Dəmir yolu" }],
  ["1. Asim Logistics asim@x.az Dəniz", { name: "Asim Logistics", email: "asim@x.az", category: "Dəniz" }],
  ["- Blue Sea Shipping <ops@bluesea.com>", { name: "Blue Sea Shipping", email: "ops@bluesea.com" }],
  ["Ad: Asim Logistics, email: asim@x.az, kateqoriya: sea freight", { name: "Asim Logistics", email: "asim@x.az", category: "sea freight" }],
  ["asim@x.az Asim Logistics", { name: "Asim Logistics", email: "asim@x.az" }],
  ["Asim Logistics | asim@x.az | Морской", { name: "Asim Logistics", email: "asim@x.az", category: "Морской" }],
];

test("typed carrier lines: name, email, phone and category in any common layout", () => {
  for (const [line, want] of typedLines) {
    const [got] = parseCarrierLines(line);
    assert.deepEqual(
      { name: got.name, email: got.email, phone: got.phone, category: got.category },
      { phone: undefined, category: undefined, ...want },
      line,
    );
  }
  const sectioned = parseCarrierLines("Bu daşıyıcıları əlavə et:\nDəniz daşıyıcıları:\nA - a@x.az\nB - b@x.az\nHava:\nC - c@x.az");
  assert.deepEqual(sectioned.map((c) => [c.name, c.category]), [["A", "Dəniz"], ["B", "Dəniz"], ["C", "Hava"]]);
});

test("add_carriers fixes a name or category the model dropped, from the user's own message", async () => {
  const text = "Bu daşıyıcıları bazaya əlavə et:\nAsim Logistics - asim@x.az - Dəniz\nKapital Trans - kt@x.az - Hava\nRoad Co - road@x.az";
  // What a small model may send: the email as the name, no categories.
  const { result } = await call(
    "add_carriers",
    { carriers: [{ name: "asim@x.az", email: "asim@x.az" }, { name: "", email: "kt@x.az" }, { name: "Road Co", email: "road@x.az" }] },
    emptyContext([], text),
  );
  assert.equal(result.added, 3);
  const rows = (await call("list_carriers")).result.carriers.map((c: { name: string; email: string; category: string }) => [c.name, c.email, c.category]);
  assert.deepEqual(rows, [
    ["Asim Logistics", "asim@x.az", "Dəniz"],
    ["Kapital Trans", "kt@x.az", "Hava"],
    ["Road Co", "road@x.az", "Quru"],
  ]);
  assert.deepEqual(result.category_defaulted.names, ["Road Co"]);
});

test("add_carriers with an empty list adds what the user typed", async () => {
  const { result } = await call("add_carriers", { carriers: [] }, emptyContext([], "Asim Logistics, asim@x.az, Dəniz"));
  assert.equal(result.added, 1);
  assert.equal((await call("list_carriers", { category: "Dəniz" })).result.carriers[0].name, "Asim Logistics");
});

test("import_carriers finds name, email and category by content when headers are unknown or missing", async () => {
  const noHeader = "Asim Logistics;asim@x.az;Dəniz\nKapital Trans;kt@x.az;Hava\n";
  let { result } = await call("import_carriers", {}, emptyContext([textFile("a.csv", noHeader, "text/csv")]));
  assert.equal(result.added, 2);
  const unknownHeaders = "Firma adı,Elektron ünvan,Daşıma\nRoad Co,road@x.az,Quru\nSky Co,sky@x.az,Air\n";
  ({ result } = await call("import_carriers", {}, emptyContext([textFile("b.csv", unknownHeaders, "text/csv")])));
  assert.equal(result.added, 2);
  const upper = "ŞİRKƏT;EMAİL;KATEQORİYA\nBlue Sea Shipping;ops@bluesea.com;DƏNİZ\n";
  ({ result } = await call("import_carriers", {}, emptyContext([textFile("c.csv", upper, "text/csv")])));
  assert.equal(result.added, 1);
  const rows = (await call("list_carriers")).result.carriers.map((c: { name: string; category: string }) => `${c.name}/${c.category}`);
  assert.deepEqual(rows, ["Asim Logistics/Dəniz", "Blue Sea Shipping/Dəniz", "Kapital Trans/Hava", "Road Co/Quru", "Sky Co/Hava"]);
});

test("the user's own categories (A, B) are categories, not subcategories under Quru", async () => {
  // The user's example: Ogullar in A, BABALAR in B.
  const text = "Bu daşıyıcıları əlavə et:\nOgullar - burzuyevrcb5@gmail.com - A kateqoriyası\nBABALAR - memetorres057@gmail.com - B kateqoriyası";
  // A model that put the label in subcategory and left the category to the default.
  const { result } = await call(
    "add_carriers",
    {
      carriers: [
        { name: "Ogullar", email: "burzuyevrcb5@gmail.com", subcategory: "A kateqoriyası" },
        { name: "BABALAR", email: "memetorres057@gmail.com", subcategory: "B kateqoriyası" },
      ],
    },
    emptyContext([], text),
  );
  assert.deepEqual(result.new_categories, ["A", "B"]);
  assert.equal(result.category_defaulted, undefined);
  // "a" and "A" are one category; a new carrier joins it.
  await call("add_carriers", { carriers: [{ name: "Yeni", email: "y@x.az", category: "a" }] });
  const rows = (await call("list_carriers")).result.carriers.map((c: { name: string; category: string }) => `${c.name}/${c.category}`);
  assert.deepEqual(rows, ["BABALAR/B", "Ogullar/A", "Yeni/A"]);
  assert.equal((await call("list_carriers", { category: "A kateqoriyası" })).result.count, 2);
});

test("typed lines and files carry the user's own categories", () => {
  const lines = parseCarrierLines("A kateqoriyası:\nOgullar - o@x.az\nB:\nBABALAR, b@x.az, kateqoriya: B\nVip Co - v@x.az - VIP");
  assert.deepEqual(lines.map((c) => [c.name, c.category]), [["Ogullar", "A"], ["BABALAR", "B"], ["Vip Co", "VIP"]]);
  const rows = tableCarriers("", [["Ad", "Email", "Kateqoriya"], ["Ogullar", "o@x.az", "A kateqoriyası"]]);
  assert.equal(rows![0].category, "A kateqoriyası");
});

test("subcategory_to_category repairs carriers saved as Quru with the category in the subcategory", async () => {
  await call("add_carriers", {
    carriers: [
      { name: "Ogullar", email: "o@x.az", category: "Quru", subcategory: "A kateqoriyası" },
      { name: "BABALAR", email: "b@x.az", category: "Quru", subcategory: "B kateqoriyası" },
      { name: "Avto Trans", email: "t@x.az", category: "Quru", subcategory: "Türkiyə xətti" },
    ],
  });
  const { result } = await call("subcategory_to_category", { subcategories: ["A kateqoriyası", "b"] });
  assert.deepEqual(result.carriers.map((c: { name: string; category: string }) => `${c.name}/${c.category}`), ["Ogullar/A", "BABALAR/B"]);
  const avto = (await call("list_carriers", { category: "Quru" })).result.carriers;
  assert.deepEqual(avto.map((c: { name: string; subcategory: string }) => `${c.name}/${c.subcategory}`), ["Avto Trans/Türkiyə xətti"]);
});
