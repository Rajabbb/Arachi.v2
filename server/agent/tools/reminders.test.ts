import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { call, freshDb } from "../../test/helpers";
import { db } from "../../db";

beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "Riga", cargo_type: "Qida", weight_kg: 7000 });
  await call("add_carriers", { carriers: [{ name: "Silent", email: "s@x.az" }, { name: "Offered", email: "o@x.az" }] });
  await call("send_rfq_to_carriers", { rfq_id: 1 });
  await call("record_offer", { rfq_id: 1, carrier_id: 2, price: 2500, transit_days: 8 });
  // Pretend the RFQ went out two days ago.
  await db().run("UPDATE dispatches SET sent_at = ?", new Date(Date.now() - 48 * 3600_000).toISOString());
});

test("reminds only non-responders, respecting the gap and the limit", async () => {
  const dry = (await call("send_reminders", { dry_run: true })).result;
  assert.equal(dry.would_remind, 1);
  assert.equal(dry.results[0].carrier, "Silent");

  const first = (await call("send_reminders", { rfq_id: 1 })).result;
  assert.equal(first.reminded, 1);
  // Just reminded: the 24 h gap holds the next one back.
  assert.equal((await call("send_reminders", { rfq_id: 1 })).result.reminded, 0);
  assert.equal((await call("send_reminders", { rfq_id: 1, min_hours: 0, max_reminders: 1 })).result.reminded, 0);
  const outbox = (await call("list_outbox")).result;
  assert.match(outbox[0].subject, /^Xatırlatma: RFQ #1/);
});
