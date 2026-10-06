import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";
import { dispatchFromToken } from "../../domain/dispatches";

beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "İstanbul", cargo_type: "Tekstil", weight_kg: 12000 });
  await call("add_carriers", {
    carriers: [
      { name: "Road A", email: "a@road.az" },
      { name: "Road B", whatsapp: "+994 50 111 22 33", subcategory: "Türkiyə xətti" },
      { name: "Sea C", email: "c@sea.az", category: "Dəniz" },
    ],
  });
});

test("default sends to carriers matching the transport type, by email", async () => {
  const { result } = await call("send_rfq_to_carriers", { rfq_id: 1 });
  assert.equal(result.sent, 2);
  const a = result.results.find((r: { name: string }) => r.name === "Road A");
  assert.equal(a.status, "Çatdırıldı");
  assert.equal((await dispatchFromToken(a.link.split("/quote/")[1]))?.carrier_id, 1);
  // Road B has no email, so the email stub cannot deliver.
  const b = result.results.find((r: { name: string }) => r.name === "Road B");
  assert.equal(b.status, "Çatdırılmadı");
  assert.equal((await call("list_outbox")).result.length, 2);
});

test("channel preference, category audience and no double sending", async () => {
  const { result } = await call("send_rfq_to_carriers", {
    rfq_id: 1, audience: "category", category: "Quru", subcategory: "Türkiyə xətti", channels: ["email", "whatsapp"],
  });
  assert.equal(result.sent, 1);
  assert.equal(result.results[0].channel, "whatsapp");
  assert.match(result.results[0].share_link, /^https:\/\/wa\.me\/994501112233\?text=/);
  const again = await call("send_rfq_to_carriers", { rfq_id: 1, audience: "specific", carrier_ids: [2, 3] });
  assert.equal(again.result.sent, 1);
  assert.equal(again.result.skipped, 1);
});
