import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { asUser } from "../auth/current";
import { insertRfq } from "../domain/rfqs";
import { hashPassword, verifyPassword } from "../auth/password";
import { addUser, call, freshDb } from "../test/helpers";

let server: Server;
let base: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

beforeEach(async () => {
  await freshDb();
  // These tests manage accounts themselves.
  await db().run("DELETE FROM users");
});

/** A browser: keeps the session cookie between requests. */
function browser() {
  let cookie = "";
  return async (path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: cookie ? { cookie } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, setCookie: set, body: (await res.json()) as Record<string, any> };
  };
}

test("passwords are hashed with scrypt and verified", async () => {
  const hash = await hashPassword("düzgün-şifrə");
  assert.match(hash, /^scrypt\$/);
  assert.ok(!hash.includes("düzgün"));
  assert.equal(await verifyPassword("düzgün-şifrə", hash), true);
  assert.equal(await verifyPassword("səhv-şifrə", hash), false);
});

test("register, me, logout, login", async () => {
  const b = browser();
  assert.equal((await b("/api/auth/me")).status, 401);

  const reg = await b("/api/auth/register", { email: " Rajab@Example.com ", password: "parol1234", name: "Rajab" });
  assert.equal(reg.status, 200);
  assert.deepEqual(reg.body.user, { id: reg.body.user.id, email: "rajab@example.com", name: "Rajab" });
  assert.match(reg.setCookie!, /HttpOnly/);
  assert.match(reg.setCookie!, /SameSite=Lax/);
  const stored = await db().get<{ password_hash: string }>("SELECT password_hash FROM users");
  assert.ok(!stored!.password_hash.includes("parol1234"));

  assert.equal((await b("/api/auth/me")).body.user.email, "rajab@example.com");
  assert.equal((await b("/api/auth/logout", {})).status, 200);
  assert.equal((await b("/api/auth/me")).status, 401);

  assert.equal((await b("/api/auth/login", { email: "rajab@example.com", password: "yanlış-parol" })).status, 401);
  const ok = await b("/api/auth/login", { email: "RAJAB@example.com", password: "parol1234" });
  assert.equal(ok.status, 200);
  assert.equal((await b("/api/auth/me")).body.user.name, "Rajab");
});

test("registration checks email, password length and duplicates", async () => {
  const b = browser();
  assert.equal((await b("/api/auth/register", { email: "yox", password: "parol1234" })).status, 400);
  assert.equal((await b("/api/auth/register", { email: "a@b.az", password: "qısa" })).status, 400);
  assert.equal((await b("/api/auth/register", { email: "a@b.az", password: "parol1234" })).status, 200);
  assert.equal((await browser()("/api/auth/register", { email: "A@b.az", password: "parol5678" })).status, 409);
});

test("chat and panel need a login; the quote page does not", async () => {
  const b = browser();
  assert.equal((await b("/api/chat", { transcript: [], message: { text: "salam", files: [] } })).status, 401);
  assert.equal((await b("/api/dashboard?days=30")).status, 401);
  await b("/api/auth/register", { email: "a@b.az", password: "parol1234" });
  const panel = await b("/api/dashboard?days=30");
  assert.equal(panel.status, 200);
  assert.equal(panel.body.activeRfqs, 0);
  assert.equal((await fetch(`${base}/api/quote/yanlis.token`)).status, 404);
});

test("a forged or expired session cookie is rejected", async () => {
  const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: "arachi_session=uydurma" } });
  assert.equal(res.status, 401);
  const b = browser();
  await b("/api/auth/register", { email: "a@b.az", password: "parol1234" });
  await db().run("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await b("/api/auth/me")).status, 401);
});

test("too many wrong passwords lock the login for a while", async () => {
  const b = browser();
  await b("/api/auth/register", { email: "a@b.az", password: "parol1234" });
  for (let i = 0; i < 10; i++) {
    assert.equal((await b("/api/auth/login", { email: "a@b.az", password: `səhv${i}` })).status, 401);
  }
  assert.equal((await b("/api/auth/login", { email: "a@b.az", password: "parol1234" })).status, 429);
});

test("password reset by email link", async () => {
  const old = browser();
  await old("/api/auth/register", { email: "a@b.az", password: "parol1234", name: "Aysel" });

  // Unknown email: same answer, nothing sent.
  assert.equal((await browser()("/api/auth/forgot", { email: "yoxdur@b.az" })).status, 200);
  assert.equal((await db().all("SELECT * FROM outbox")).length, 0);

  assert.equal((await browser()("/api/auth/forgot", { email: "A@b.az" })).status, 200);
  const mail = (await db().get<{ recipient: string; body: string; user_id: number }>("SELECT * FROM outbox"))!;
  assert.equal(mail.recipient, "a@b.az");
  const token = mail.body.match(/\/reset\/([\w-]+)/)![1];

  const b = browser();
  assert.equal((await b("/api/auth/reset", { token, password: "qısa" })).status, 400);
  assert.equal((await b("/api/auth/reset", { token: "uydurma", password: "yeni-parol1" })).status, 400);
  const reset = await b("/api/auth/reset", { token, password: "yeni-parol1" });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.name, "Aysel");
  assert.equal((await b("/api/auth/me")).status, 200);

  // The link works once, the old password and old sessions stop working.
  assert.equal((await browser()("/api/auth/reset", { token, password: "başqa-parol" })).status, 400);
  assert.equal((await old("/api/auth/me")).status, 401);
  assert.equal((await browser()("/api/auth/login", { email: "a@b.az", password: "parol1234" })).status, 401);
  assert.equal((await browser()("/api/auth/login", { email: "a@b.az", password: "yeni-parol1" })).status, 200);
});

test("the first account takes over data from before accounts; later ones start empty", async () => {
  // A carrier and an RFQ saved before accounts existed have no owner.
  const legacy = await addUser("legacy@x.az");
  await call("add_carriers", { carriers: [{ name: "Köhnə", email: "old@road.az" }] }, undefined, legacy);
  await asUser(legacy, () =>
    insertRfq({
      origin: "Bakı", destination: "Gəncə", cargo_type: "Un", weight_kg: 1000, volume_m3: 0, pallets: 0,
      transport_type: "Quru", loading_date: "", delivery_date: "", currency: "USD", offer_deadline: "", notes: "", source: "chat",
    }),
  );
  await db().run("UPDATE rfqs SET user_id = NULL");
  await db().run("UPDATE carriers SET user_id = NULL");
  await db().run("DELETE FROM users");

  const first = browser();
  const { body } = await first("/api/auth/register", { email: "first@b.az", password: "parol1234" });
  const second = browser();
  const other = await second("/api/auth/register", { email: "second@b.az", password: "parol1234" });

  assert.equal((await first("/api/dashboard?days=30")).body.activeRfqs, 1);
  assert.equal((await first("/api/dashboard?days=30")).body.carriers, 1);
  assert.equal((await second("/api/dashboard?days=30")).body.activeRfqs, 0);
  assert.equal((await call("list_rfqs", {}, undefined, body.user.id)).result.length, 1);
  assert.equal((await call("list_rfqs", {}, undefined, other.body.user.id)).result.length, 0);
});
