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
  page = (await (await post({ price: 1400, currency: "USD", transit_days: 4, notes: "endirim" })).json()) as QuotePageData;
  assert.deepEqual(page.offers.map((o: { version: number; price: number }) => [o.version, o.price]), [[1, 1500], [2, 1400]]);
  const file = await fetch(`${base}${page.offers[0].documents[0].url}`);
  assert.equal(await file.text(), "şərtlər");
  const bad = await post({ price: -1, currency: "USD", transit_days: 3 });
  assert.equal(bad.status, 400);
});
