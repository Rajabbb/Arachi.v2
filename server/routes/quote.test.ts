import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { call, freshDb } from "../test/helpers";
import { handleQuote } from "./quote";
import { handleFile } from "./files";
import { HttpError, send } from "../http";
import type { QuotePageData } from "../../shared/protocol";

let server: Server;
let base: string;

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = req.url ?? "";
      if (path.startsWith("/api/files/")) return await handleFile(res, path.slice(11));
      await handleQuote(req, res, path.slice("/api/quote/".length));
    } catch (err) {
      send(res, err instanceof HttpError ? err.status : 500, { error: String(err) });
    }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

let token: string;
beforeEach(async () => {
  await freshDb();
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Şərab", weight_kg: 5000 });
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az", language: "en" }] });
  const { result } = await call("get_quote_link", { rfq_id: 1, carrier_id: 1 });
  token = result.link.split("/quote/")[1];
});

test("carrier opens the link: status becomes viewed", async () => {
  const page = (await (await fetch(`${base}/api/quote/${token}`)).json()) as QuotePageData;
  assert.equal(page.rfq.origin, "Bakı");
  assert.equal(page.carrier.language, "en");
  assert.equal(page.status, "Baxıldı");
  assert.equal((await fetch(`${base}/api/quote/${token}x`)).status, 404);
});

test("carrier submits and revises an offer with a document", async () => {
  const post = (body: unknown) =>
    fetch(`${base}/api/quote/${token}`, { method: "POST", body: JSON.stringify(body) });
  const doc = { name: "terms.txt", type: "text/plain", data: Buffer.from("şərtlər").toString("base64") };
  let page = (await (await post({ price: 1500, currency: "USD", transit_days: 3, files: [doc] })).json()) as QuotePageData;
  assert.equal(page.status, "Təklif alındı");
  page = (await (await post({ price: 1400, currency: "USD", transit_days: 4, notes: "endirim", offer_no: 1 })).json()) as QuotePageData;
  assert.deepEqual(page.offers.map((o) => [o.offer_no, o.versions.map((v) => [v.version, v.price])]), [[1, [[1, 1500], [2, 1400]]]]);
  const file = await fetch(`${base}${page.offers[0].versions[0].documents[0].url}`);
  assert.equal(await file.text(), "şərtlər");
  const bad = await post({ price: -1, currency: "USD", transit_days: 3 });
  assert.equal(bad.status, 400);
});

test("carrier sends a new separate offer or updates a chosen earlier one", async () => {
  const post = (body: unknown) =>
    fetch(`${base}/api/quote/${token}`, { method: "POST", body: JSON.stringify(body) });
  await post({ price: 322, currency: "USD", transit_days: 3 });
  await post({ price: 280, currency: "USD", transit_days: 6, notes: "yavaş, ucuz" }); // a second offer
  let page = (await (await post({ price: 300, currency: "USD", transit_days: 3, offer_no: 1 })).json()) as QuotePageData;
  page = (await (await post({ price: 275, currency: "USD", transit_days: 6, offer_no: 2 })).json()) as QuotePageData;
  assert.deepEqual(
    page.offers.map((o) => [o.offer_no, o.versions.map((v) => [v.version, v.price])]),
    [[1, [[1, 322], [2, 300]]], [2, [[1, 280], [2, 275]]]],
  );

  // An offer the carrier never sent cannot be updated; nothing is recorded.
  const missing = await post({ price: 1, currency: "USD", transit_days: 1, offer_no: 3 });
  assert.equal(missing.status, 400);
  assert.equal((await post({ price: 1, currency: "USD", transit_days: 1, offer_no: 1.5 })).status, 400);
  page = (await (await fetch(`${base}/api/quote/${token}`)).json()) as QuotePageData;
  assert.equal(page.offers.length, 2);
});

test("a carrier cannot update another carrier's offer through its own link", async () => {
  await call("add_carriers", { carriers: [{ name: "Road B", email: "b@road.az" }] });
  const other = (await call("get_quote_link", { rfq_id: 1, carrier_id: 2 })).result.link.split("/quote/")[1];
  const post = (t: string, body: unknown) =>
    fetch(`${base}/api/quote/${t}`, { method: "POST", body: JSON.stringify(body) });
  await post(token, { price: 500, currency: "USD", transit_days: 3 });
  // B has no offer 1 of its own, so offer_no 1 is not A's offer.
  assert.equal((await post(other, { price: 1, currency: "USD", transit_days: 1, offer_no: 1 })).status, 400);
  const a = (await (await fetch(`${base}/api/quote/${token}`)).json()) as QuotePageData;
  assert.deepEqual(a.offers[0].versions.map((v) => v.price), [500]);
});
