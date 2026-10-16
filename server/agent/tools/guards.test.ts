import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";
import { arachiData, installFakeArachi } from "../../test/fakeArachi";
import { emptyContext } from "./registry";
import { bakuToday, dateLine, oversizeWarnings, refusePastDate, totalMismatchWarning } from "./guards";

let restore: () => void;
before(() => {
  restore = installFakeArachi();
});
after(() => restore());
beforeEach(freshDb);

const NOON = Date.parse("2026-10-17T12:00:00Z");

test("today is Baku's date and the date line names the weekday", () => {
  assert.equal(bakuToday(Date.parse("2026-10-17T21:30:00Z")), "2026-10-18"); // already tomorrow in Baku
  assert.match(dateLine(NOON), /2026-10-17 \(şənbə\)/);
});

test("a loading or delivery date in the past is refused, today and later are fine", () => {
  assert.throws(() => refusePastDate("Yükləmə tarixi", "2025-10-30", NOON), /keçmişdədir/);
  assert.doesNotThrow(() => refusePastDate("Yükləmə tarixi", "2026-10-17T08:00", NOON));
  assert.doesNotThrow(() => refusePastDate("Yükləmə tarixi", "2026-11-05", NOON));
  assert.doesNotThrow(() => refusePastDate("Yükləmə tarixi", "dünən", NOON)); // not a date: other checks handle it
});

test("create_rfq refuses a past loading date and creates nothing", async () => {
  await assert.rejects(
    call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", loading_date: "2025-10-30" }),
    /Yükləmə tarixi \(2025-10-30\) keçmişdədir/,
  );
  assert.equal(arachiData.rfqs.length, 0);
});

test("oversize cargo is warned about; ordinary pallets are not", () => {
  assert.equal(oversizeWarnings("Ekskavator: 9.5 m x 3.4 m x 3.2 m").length, 1);
  assert.equal(oversizeWarnings("Çən 690×295×375 sm, 78 t").length, 1);
  assert.equal(oversizeWarnings("4,2×2,4×2,6 m").length, 1);
  assert.equal(oversizeWarnings("palet 120x80x150 cm, 48x40x50 inch").length, 0);
});

test("the stated total and the sum of the items must agree within 2%", () => {
  assert.match(totalMismatchWarning("Ümumi çəki 10 ton. Lotlar: A 3000 kq, B 4500 kq, C 4000 kq", 11500)!, /10000 kq.*11500 kq/);
  assert.equal(totalMismatchWarning("Cəmi 11,5 ton", 11500), null);
  assert.equal(totalMismatchWarning("çəki bilinmir", 11500), null);
});

test("a multi-cargo card warns when the stated total differs from the items", async () => {
  const ctx = emptyContext([], "Ümumi çəki 10 ton. A 3000 kq, B 4500 kq, C 4000 kq, İzmir→Bakı");
  const seen: string[] = [];
  ctx.askUser = async (_t, _p, summary) => {
    seen.push(summary);
    return { id: "c1", text: summary, status: "pending", result: "" };
  };
  await call(
    "create_rfq",
    { origin: "İzmir", destination: "Bakı", cargo_type: "x", cargo_items: [{ name: "A", weight_kg: 3000 }, { name: "B", weight_kg: 4500 }, { name: "C", weight_kg: 4000 }] },
    ctx,
  );
  assert.match(seen[0], /⚠ Mətndə ümumi çəki 10000 kq/);
});
