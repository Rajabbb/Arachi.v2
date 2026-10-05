import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";

beforeEach(freshDb);

test("create_rfq fills standard parameters and numbers the RFQ", async () => {
  const { result, overrides } = await call("create_rfq", {
    origin: "Bakı",
    destination: "İstanbul",
    cargo_type: "Tekstil",
    weight_kg: 12000,
  });
  assert.equal(result.id, 1);
  assert.equal(result.transport_type, "Quru");
  assert.equal(result.currency, "USD");
  assert.equal(result.status, "open");
  assert.match(result.offer_deadline, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(overrides.sort(), ["cargo_type", "destination", "origin", "weight_kg"]);
});

test("create_rfq applies user overrides and validates input", async () => {
  const { result } = await call("create_rfq", {
    origin: "Bakı", destination: "Hamburq", cargo_type: "Mebel", weight_kg: 800,
    transport_type: "Dəniz", currency: "EUR", loading_date: "2026-11-02",
  });
  assert.equal(result.transport_type, "Dəniz");
  assert.equal(result.currency, "EUR");
  await assert.rejects(call("create_rfq", { origin: "A", destination: "B", cargo_type: "X", weight_kg: -1 }));
  await assert.rejects(call("create_rfq", { origin: "A", destination: "B", cargo_type: "X", weight_kg: 1, loading_date: "02.11.2026" }));
});

test("list_rfqs filters by status", async () => {
  await call("create_rfq", { origin: "A", destination: "B", cargo_type: "X", weight_kg: 1 });
  assert.equal((await call("list_rfqs")).result.length, 1);
  assert.equal((await call("list_rfqs", { status: "awarded" })).result.length, 0);
});
