import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";
import { arachiData, installFakeArachi } from "../../test/fakeArachi";
import { tools } from ".";
import { emptyContext } from "./registry";
import { asUser } from "../../auth/current";
import { fakeJwt } from "../../test/fakeArachi";

let restore: () => void;
before(() => {
  restore = installFakeArachi();
});
after(() => restore());
beforeEach(freshDb);

const rfqInput = { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 500 };

/** An offer arriving on arachi.co (a carrier filled in the quote page). */
function offerFrom(carrierId: number, rfqId: number, price: number, days: number, currency = "USD") {
  const q = arachiData.quotes.find((x) => x.carrier_id === carrierId && x.request_id === rfqId)!;
  Object.assign(q, { price, transit_time_days: days, currency });
  return q;
}

async function setup() {
  const { result: rfq } = await call("create_rfq", rfqInput);
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Road B", email: "b@road.az" }] });
  const carriers = (await call("list_carriers")).result.carriers as { id: number; name: string }[];
  return { rfq, carriers };
}

test("create_rfq creates the RFQ on arachi.co and sends nothing", async () => {
  const { result } = await call("create_rfq", { ...rfqInput, notes: "10 palet" });
  assert.equal(result.origin, "Bakı");
  assert.equal(result.status, "open");
  assert.equal(arachiData.rfqs.length, 1);
  assert.equal(arachiData.rfqs[0].send_option, "none");
  assert.equal(arachiData.rfqs[0].additional_notes, "10 palet");
  assert.equal(arachiData.mails.length, 0);
  assert.equal(((await call("list_rfqs")).result as unknown[]).length, 1);
  assert.equal(((await call("list_rfqs", { status: "closed" })).result as unknown[]).length, 0);
});

test("carriers are added once per email and listed", async () => {
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }] });
  await call("add_carriers", { carriers: [{ name: "Again", email: "a@road.az" }, { name: "", email: "c@road.az" }] });
  const { result } = await call("list_carriers");
  assert.equal(result.total, 2);
  assert.deepEqual(result.carriers.map((c: { name: string }) => c.name), ["Road A", "Daşıyıcı"]);
  assert.equal((await call("list_carriers", { search: "c@road" })).result.total, 1);
  await assert.rejects(call("add_carriers", { carriers: [{ name: "No mail", email: "" }] }), /email/);
});

test("send_rfq_to_carriers asks first, then reaches exactly the shown carriers, once", async () => {
  const { rfq } = await setup();
  const asked: string[] = [];
  const ctx = emptyContext();
  ctx.askUser = async (_tool, _params, summary) => {
    asked.push(summary);
    return { id: "c1", text: summary, status: "pending", result: "" };
  };
  const plan = await call("send_rfq_to_carriers", { rfq_id: rfq.id }, ctx);
  assert.equal(JSON.parse(plan.content).status, "waiting_for_user");
  assert.match(asked[0], /2 daşıyıcıya/);
  assert.match(asked[0], /a@road\.az/);
  assert.equal(arachiData.mails.length, 0, "nothing sent before Bəli");

  const sent = await call("send_rfq_to_carriers", { rfq_id: rfq.id });
  assert.equal(sent.result.sent, 2);
  assert.equal(arachiData.mails.length, 2);
  // Everyone has it already: nothing to confirm and nothing to send.
  await assert.rejects(call("send_rfq_to_carriers", { rfq_id: rfq.id }), /yeni daşıyıcı yoxdur/);
});

test("sending to specific carriers only reaches those", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id, audience: "specific", carrier_ids: [carriers[1].id] });
  assert.deepEqual(arachiData.mails.map((m) => m.to), ["b@road.az"]);
});

test("a closed RFQ cannot be sent, an unknown one is not found", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id, audience: "specific", carrier_ids: [carriers[0].id] });
  offerFrom(carriers[0].id, rfq.id, 100, 3);
  const q = arachiData.quotes[0];
  await call("select_winner", { rfq_id: rfq.id, offer_id: q.id });
  await assert.rejects(call("send_rfq_to_carriers", { rfq_id: rfq.id }), /artıq açıq deyil/);
  await assert.rejects(call("list_offers", { rfq_id: 999 }), /tapılmadı/);
});

test("list_offers shows offers and each carrier's status; compare ranks them", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id });
  offerFrom(carriers[0].id, rfq.id, 900, 5);
  const { result } = await call("list_offers", { rfq_id: rfq.id });
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].carrier, "Road A");
  const statuses = Object.fromEntries(result.carriers.map((c: { carrier: string; status: string }) => [c.carrier, c.status]));
  assert.deepEqual(statuses, { "Road A": "Təklif alındı", "Road B": "Göndərilir" });

  offerFrom(carriers[1].id, rfq.id, 700, 8);
  const byPrice = (await call("compare_offers", { rfq_id: rfq.id })).result.rankings[0];
  assert.deepEqual(byPrice.offers.map((o: { carrier: string }) => o.carrier), ["Road B", "Road A"]);
  const byDays = (await call("compare_offers", { rfq_id: rfq.id, criterion: "transit" })).result.rankings[0];
  assert.deepEqual(byDays.offers.map((o: { carrier: string }) => o.carrier), ["Road A", "Road B"]);
});

test("offers in different currencies are ranked per currency, never mixed", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id });
  offerFrom(carriers[0].id, rfq.id, 900, 5, "EUR");
  offerFrom(carriers[1].id, rfq.id, 800, 5, "USD");
  const { rankings } = (await call("compare_offers", { rfq_id: rfq.id })).result;
  assert.equal(rankings.length, 2);
  assert.deepEqual(rankings.map((r: { currency: string }) => r.currency).sort(), ["EUR", "USD"]);
  assert.equal((await call("compare_offers", { rfq_id: 1 })).result.rankings.length, 2);
});

test("select_winner closes the RFQ on arachi.co and rejects an offer of another RFQ", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id });
  offerFrom(carriers[0].id, rfq.id, 900, 5);
  await assert.rejects(call("select_winner", { rfq_id: rfq.id, offer_id: 424242 }), /tapılmadı/);
  const q = arachiData.quotes.find((x) => x.carrier_id === carriers[0].id)!;
  const { result } = await call("select_winner", { rfq_id: rfq.id, offer_id: q.id });
  assert.equal(result.winner.is_winner, false, "the view is of the offer before the change");
  assert.equal(arachiData.rfqs[0].status, "closed");
  assert.equal(q.is_winner, true);
});

test("send_reminders only reminds carriers who did not answer, and only on the user's own RFQ", async () => {
  const { rfq, carriers } = await setup();
  await call("send_rfq_to_carriers", { rfq_id: rfq.id });
  offerFrom(carriers[0].id, rfq.id, 900, 5);
  arachiData.mails.length = 0;
  const ctx = emptyContext();
  const shown: string[] = [];
  ctx.askUser = async (_t, _p, summary) => (shown.push(summary), { id: "c", text: summary, status: "pending", result: "" });
  await call("send_reminders", { rfq_id: rfq.id }, ctx);
  assert.match(shown[0], /1 daşıyıcıya/);
  assert.match(shown[0], /b@road\.az/);
  assert.doesNotMatch(shown[0], /a@road\.az/);
  assert.equal(arachiData.mails.length, 0);

  // Even if quote ids of other carriers are passed, the answered one is never reminded.
  const answered = arachiData.quotes.find((q) => q.carrier_id === carriers[0].id)!;
  const pending = arachiData.quotes.find((q) => q.carrier_id === carriers[1].id)!;
  await call("send_reminders", { rfq_id: rfq.id, quote_ids: [answered.id, pending.id] });
  assert.deepEqual(arachiData.mails.map((m) => [m.to, m.reminder]), [["b@road.az", true]]);
});

test("quote link and dashboard numbers come from arachi.co", async () => {
  const { rfq } = await setup();
  const link = (await call("get_quote_link", { rfq_id: rfq.id })).result.link as string;
  assert.match(link, /carrier_quote\/quote\?token=.*public=1/);
  const stats = (await call("get_dashboard")).result;
  assert.equal(stats.active_rfqs, 1);
  assert.equal(stats.carriers_count, 2);
});

test("one customer never reaches another customer's data, even by RFQ number", async () => {
  const { rfq } = await setup();
  const asOther = <T>(fn: () => Promise<T>) => asUser(99, fn, fakeJwt(2));
  const run = async (name: string, input: Record<string, unknown>) => (await asOther(() => tools.execute(name, input))).content;
  assert.match(await run("list_offers", { rfq_id: rfq.id }), /tapılmadı/);
  assert.match(await run("send_rfq_to_carriers", { rfq_id: rfq.id }), /tapılmadı/);
  assert.match(await run("get_quote_link", { rfq_id: rfq.id }), /tapılmadı/);
  assert.match(await run("send_reminders", { rfq_id: rfq.id }), /tapılmadı/);
  assert.equal(JSON.parse(await run("list_rfqs", {})).length, 0);
  assert.equal(JSON.parse(await run("list_carriers", {})).total, 0);
});

test("an ended arachi.co session is explained, not shown as a crash", async () => {
  arachiData.failWith = 401;
  await assert.rejects(call("list_rfqs"), /yenidən 'Aİ istifadə et'/);
  arachiData.failWith = 500;
  await assert.rejects(call("list_rfqs"), /arachi\.co/);
});
