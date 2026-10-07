import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { app } from "./app";
import { config } from "./config";
import { call, freshDb } from "./test/helpers";

/** Defenses around the HTTP layer: foreign origins, body caps, downloads, the page's CSP. */

let server: Server;
let base: string;
let dir: string;
const originalStatic = config.staticDir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "arachi-security-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
  config.staticDir = dir;
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  config.staticDir = originalStatic;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => freshDb());

const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers, body });

test("a POST from another site is refused before anything runs", async () => {
  const res = await post("/api/auth/login", JSON.stringify({ email: "a@b.az", password: "x" }), {
    origin: "https://evil.arachi.co",
  });
  assert.equal(res.status, 403);
  // The app's own address, the request's own host, and no Origin at all still work.
  for (const origin of [new URL(config.publicBaseUrl).origin, base, undefined]) {
    const ok = await post("/api/auth/login", JSON.stringify({ email: "a@b.az", password: "x" }), origin ? { origin } : {});
    assert.equal(ok.status, 401, String(origin));
  }
});

test("login and webhook bodies are capped well below the upload limit", async () => {
  const big = JSON.stringify({ email: "a@b.az", password: "x".repeat(300 * 1024) });
  assert.equal((await post("/api/auth/login", big)).status, 413);
  assert.equal((await post("/api/webhooks/resend", big)).status, 413);
});

test("downloads cannot run as a page, whatever type the uploader claimed", async () => {
  await call("create_rfq", { origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 500 });
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }] });
  const { result } = await call("get_quote_link", { rfq_id: 1, carrier_id: 1 });
  const token = result.link.split("/quote/")[1];
  const html = Buffer.from("<script>alert(1)</script>").toString("base64");
  const submit = (files: unknown[]) =>
    post(`/api/quote/${token}`, JSON.stringify({ price: 900, currency: "USD", transit_days: 5, files }));

  const page = (await (await submit([{ name: "x.html", type: "text/html", data: html }])).json()) as any;
  const url = page.offers[0].versions[0].documents[0].url as string;
  const file = await fetch(base + url);
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-disposition")!, /^attachment/);
  assert.equal(file.headers.get("x-content-type-options"), "nosniff");
  assert.match(file.headers.get("content-security-policy")!, /sandbox/);

  const tooMany = Array.from({ length: 11 }, (_, i) => ({ name: `${i}.txt`, type: "text/plain", data: "" }));
  assert.equal((await submit(tooMany)).status, 400);
});

test("the page is served with a content security policy", async () => {
  const res = await fetch(`${base}/panel`);
  const csp = res.headers.get("content-security-policy")!;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
