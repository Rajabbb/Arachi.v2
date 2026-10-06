import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { app } from "./app";
import { config } from "./config";

let server: Server;
let base: string;
let dir: string;
const original = config.staticDir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "arachi-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(join(dir, "assets", "main-abc123.js"), "console.log(1)");
  writeFileSync(join(tmpdir(), "outside.txt"), "secret");
  config.staticDir = dir;
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  config.staticDir = original;
  rmSync(dir, { recursive: true, force: true });
});

test("UI routes get index.html so links from emails open in production", async () => {
  for (const path of ["/", "/quote/abc.def", "/reset/xyz", "/panel", "/panel/rfq/3"]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type")!, /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.match(await res.text(), /id=root/);
  }
});

test("hashed assets are served with a long cache", async () => {
  const res = await fetch(`${base}/assets/main-abc123.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /javascript/);
  assert.match(res.headers.get("cache-control")!, /immutable/);
  assert.equal(await res.text(), "console.log(1)");
});

test("missing assets and unknown API paths are 404, not the page", async () => {
  assert.equal((await fetch(`${base}/assets/old-123.js`)).status, 404);
  const api = await fetch(`${base}/api/nope`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type")!, /json/);
});

test("paths cannot escape the build folder", async () => {
  for (const path of ["/../outside.txt", "/%2e%2e/outside.txt", "/..%2foutside.txt"]) {
    const res = await fetch(base + path);
    assert.notEqual(await res.text(), "secret", path);
  }
});

test("health check answers for the hosting platform", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
