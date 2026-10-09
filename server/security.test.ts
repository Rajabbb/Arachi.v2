import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { app } from "./app";
import { config } from "./config";
import { freshDb } from "./test/helpers";

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

test("login bodies are capped well below the upload limit", async () => {
  const big = JSON.stringify({ email: "a@b.az", password: "x".repeat(300 * 1024) });
  assert.equal((await post("/api/auth/login", big)).status, 413);
});

test("the page is served with a content security policy", async () => {
  const res = await fetch(`${base}/panel`);
  const csp = res.headers.get("content-security-policy")!;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test("working on top of arachi.co, only arachi.co may frame the page", async () => {
  const saved = { api: config.arachiApiUrl, secret: config.ssoSecret };
  config.arachiApiUrl = "http://arachi.test";
  config.ssoSecret = "shared-secret-for-tests-0123456789";
  try {
    const csp = (await fetch(`${base}/panel`)).headers.get("content-security-policy")!;
    assert.match(csp, /frame-ancestors https:\/\/arachi\.co(;|$)/);
    assert.ok(!csp.includes("frame-ancestors *"));
  } finally {
    config.arachiApiUrl = saved.api;
    config.ssoSecret = saved.secret;
  }
});
