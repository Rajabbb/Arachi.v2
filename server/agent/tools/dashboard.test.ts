import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";

beforeEach(freshDb);

test("get_dashboard counts RFQs, carriers, offers and statuses", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Minsk", cargo_type: "Meyvə", weight_kg: 10000 });
  await call("create_rfq", { origin: "Bakı", destination: "Praqa", cargo_type: "Şüşə", weight_kg: 6000 });
  await call("add_carriers", { carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }, { name: "C", phone: "+994" }] });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2000, transit_days: 7 });
  await call("select_winner", { rfq_id: 1, notify_winner: false });

  const { result } = await call("get_dashboard");
  assert.equal(result.activeRfqs, 1);
  assert.equal(result.awardedRfqs, 1);
  assert.equal(result.carriers, 3);
  assert.equal(result.offersReceived, 1);
  assert.equal(result.responseRate, 33.3);
  assert.deepEqual(result.awardedValue, [{ currency: "USD", total: 2000 }]);
  assert.equal(result.statuses.find((s: { status: string }) => s.status === "failed").count, 1);
  assert.equal(result.recentOffers[0].winner, true);
  assert.match(result.panel_url, /\/panel\?days=30$/);
});

test("delivery statuses are a funnel: an offer also counts as viewed, delivered and sent", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Minsk", cargo_type: "Meyvə", weight_kg: 10000 });
  await call("add_carriers", {
    carriers: [{ name: "A", email: "a@x.az" }, { name: "B", email: "b@x.az" }, { name: "C", email: "c@x.az" }, { name: "D", phone: "+994" }],
  });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 1, price: 2000, transit_days: 7 });
  const { result: link } = await call("get_quote_link", { rfq_id: 1, carrier_id: 2 });
  const { dispatchFromToken, markViewed } = await import("../../domain/dispatches");
  await markViewed((await dispatchFromToken(link.link.split("/quote/")[1]))!);

  const { result } = await call("get_dashboard");
  const count = Object.fromEntries(result.statuses.map((s: { status: string; count: number }) => [s.status, s.count]));
  // D has no email, so nothing was sent to it.
  assert.deepEqual(count, { sent: 3, delivered: 3, viewed: 2, offered: 1, failed: 1 });
});
