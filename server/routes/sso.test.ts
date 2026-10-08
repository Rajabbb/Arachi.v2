import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { config } from "../config";
import { asUser } from "../auth/current";
import { createSession } from "../auth/accounts";
import { ArachiError, arachi } from "../arachi/client";
import { openToken, sealToken } from "../arachi/vault";
import { addUser, freshDb } from "../test/helpers";

let server: Server;
let base: string;
const realFetch = globalThis.fetch;
const saved = { api: config.arachiApiUrl, secret: config.ssoSecret };

/** What the fake arachi.co answers; null = "not reachable". Calls it received are kept in `seen`. */
let arachiReply: ((url: string, init: RequestInit) => { status: number; body: unknown } | null) | null = null;
const seen: { url: string; init: RequestInit }[] = [];

before(async () => {
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("http://arachi.test")) return realFetch(input, init);
    seen.push({ url, init: init ?? {} });
    const reply = arachiReply?.(url, init ?? {});
    if (!reply) throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  config.arachiApiUrl = saved.api;
  config.ssoSecret = saved.secret;
});

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  config.arachiApiUrl = "http://arachi.test";
  config.ssoSecret = "shared-secret-for-tests-0123456789";
  seen.length = 0;
  arachiReply = (_url, init) => {
    const ticket = JSON.parse(String(init.body)).ticket as string;
    if (ticket === "good") return { status: 200, body: { status: "success", token: "ARACHI-JWT-1", expires_in: 43200, user: { id: 7, email: "pro@firma.az", name: "Pro MMC", plan: "pro" } } };
    if (ticket === "reused") return { status: 401, body: { detail: "Bu giriş bileti artıq istifadə edilib." } };
    if (ticket === "basic") return { status: 403, body: { detail: "Aİ funksiyası yalnız Pro plan üçün aktivdir." } };
    if (ticket === "evil") return { status: 403, body: { detail: "<script>alert(1)</script>" } };
    if (ticket === "down") return { status: 500, body: { detail: "boom" } };
    return { status: 401, body: { detail: "Etibarsız giriş bileti." } };
  };
});
afterEach(() => {
  arachiReply = null;
});

async function sso(ticket: string | null) {
  const query = ticket === null ? "" : `?ticket=${encodeURIComponent(ticket)}`;
  const res = await realFetch(`${base}/sso${query}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), cookie: res.headers.get("set-cookie"), csp: res.headers.get("content-security-policy"), html: await res.text() };
}

async function me(cookie: string) {
  const res = await realFetch(`${base}/api/auth/me`, { headers: { cookie } });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

test("a valid ticket signs the customer in and redirects to the chat", async () => {
  const r = await sso("good");
  assert.equal(r.status, 302);
  assert.equal(r.location, "/");
  assert.match(r.cookie!, /^arachi_session=/);
  assert.match(r.cookie!, /HttpOnly/);
  assert.match(r.cookie!, /SameSite=Lax/);
  assert.match(r.cookie!, /Max-Age=43200/);

  // arachi.co was called by the server with the shared secret, and nothing else
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://arachi.test/api/ai/exchange");
  assert.equal((seen[0].init.headers as Record<string, string>)["x-service-secret"], config.ssoSecret);
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { ticket: "good" });

  const cookie = r.cookie!.split(";")[0];
  const who = await me(cookie);
  assert.equal(who.status, 200);
  assert.equal(who.body.user.name, "Pro MMC");
});

test("the arachi.co token is stored sealed, never in plain text, and the user holds no usable password", async () => {
  await sso("good");
  const session = await db().get<{ arachi_token: string; arachi_expires_at: string }>("SELECT arachi_token, arachi_expires_at FROM sessions");
  assert.ok(session!.arachi_token.startsWith("v1."));
  assert.ok(!session!.arachi_token.includes("ARACHI-JWT-1"));
  assert.equal(openToken(session!.arachi_token), "ARACHI-JWT-1");
  const user = await db().get<{ email: string; password_hash: string; arachi_customer_id: number }>("SELECT email, password_hash, arachi_customer_id FROM users");
  assert.equal(Number(user!.arachi_customer_id), 7);
  assert.match(user!.email, /@sso\.invalid$/); // the real email stays in arachi.co
  assert.ok(!user!.password_hash.startsWith("scrypt$"));
});

test("the same customer keeps one account across sign-ins and the name follows arachi.co", async () => {
  await sso("good");
  arachiReply = () => ({ status: 200, body: { token: "T2", expires_in: 3600, user: { id: 7, email: "new@firma.az", name: "Yeni Ad MMC", plan: "pro" } } });
  await sso("good");
  const users = await db().all<{ name: string }>("SELECT name FROM users");
  assert.equal(users.length, 1);
  assert.equal(users[0].name, "Yeni Ad MMC");
  assert.equal((await db().all("SELECT id FROM sessions")).length, 2);
});

test("different customers get separate accounts even if their emails match an old account", async () => {
  await addUser("pro@firma.az"); // an old own-login account with the same email
  await sso("good");
  arachiReply = () => ({ status: 200, body: { token: "T3", expires_in: 3600, user: { id: 8, email: "pro@firma.az", name: "Başqa MMC", plan: "pro" } } });
  await sso("good");
  const rows = await db().all<{ arachi_customer_id: number | null }>("SELECT arachi_customer_id FROM users ORDER BY id");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => (r.arachi_customer_id === null ? null : Number(r.arachi_customer_id))), [null, 7, 8]);
});

test("rejected tickets show an error page, set no cookie and create nothing", async () => {
  for (const [ticket, status, text] of [
    ["reused", 401, "artıq istifadə edilib"],
    ["basic", 403, "Pro plan"],
    ["unknown", 401, "Etibarsız"],
    ["down", 502, "boom"],
  ] as const) {
    const r = await sso(ticket);
    assert.equal(r.status, status, ticket);
    assert.equal(r.cookie, null, ticket);
    assert.match(r.html, new RegExp(text), ticket);
    assert.match(r.html, /arachi\.co\/customer/, ticket); // a way back
  }
  assert.equal((await db().all("SELECT id FROM users")).length, 0);
  assert.equal((await db().all("SELECT id FROM sessions")).length, 0);
});

test("text from arachi.co is escaped on the error page", async () => {
  const r = await sso("evil");
  assert.ok(!r.html.includes("<script>alert(1)</script>"));
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.csp ?? "", /frame-ancestors .none./);
});

test("missing or oversized tickets are refused before arachi.co is called", async () => {
  assert.equal((await sso(null)).status, 400);
  assert.equal((await sso("")).status, 400);
  assert.equal((await sso("x".repeat(5000))).status, 400);
  assert.equal(seen.length, 0);
});

test("an unreachable arachi.co gives a clear error, not a sign-in", async () => {
  arachiReply = () => null;
  const r = await sso("good");
  assert.equal(r.status, 502);
  assert.match(r.html, /arachi\.co ilə əlaqə qurulmadı/);
  assert.equal(r.cookie, null);
});

test("own-login forms are closed when working on top of arachi.co, but logout still works", async () => {
  const post = (path: string, body: unknown) => realFetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });
  for (const action of ["login", "register", "forgot", "reset"]) {
    const res = await post(`/api/auth/${action}`, { email: "a@b.az", password: "parol1234", token: "x" });
    assert.equal(res.status, 410, action);
    assert.match(((await res.json()) as { error: string }).error, /arachi\.co/);
  }
  const r = await sso("good");
  const cookie = r.cookie!.split(";")[0];
  const out = await realFetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie }, body: "{}" });
  assert.equal(out.status, 200);
  assert.equal((await me(cookie)).status, 401);
});

test("sessions without an arachi.co token, or past its expiry, no longer count", async () => {
  const legacy = await addUser("legacy@x.az");
  const { token } = await createSession(legacy); // an old own-login session
  assert.equal((await me(`arachi_session=${token}`)).status, 401);

  const customer = await addUser("c@x.az");
  const expired = await createSession(customer, { token: "OLD", expiresInSeconds: -60 });
  assert.equal((await me(`arachi_session=${expired.token}`)).status, 401);

  const fine = await createSession(customer, { token: "NEW", expiresInSeconds: 600 });
  assert.equal((await me(`arachi_session=${fine.token}`)).status, 200);
});

test("without ARACHI_API_URL the server is not in arachi mode: /sso is a 404 page", async () => {
  config.arachiApiUrl = "";
  const r = await sso("good");
  assert.equal(r.status, 404);
  assert.equal(seen.length, 0);
});

test("a stolen database cannot reveal tokens: sealed values need the secret and detect tampering", () => {
  const sealed = sealToken("secret-jwt");
  assert.equal(openToken(sealed), "secret-jwt");
  assert.notEqual(sealToken("secret-jwt"), sealed); // fresh nonce each time
  const parts = sealed.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.equal(openToken(parts.join(".")), undefined);
  assert.equal(openToken("garbage"), undefined);
  config.ssoSecret = "another-secret-entirely-0123456789";
  assert.equal(openToken(sealed), undefined);
});

test("calls to arachi.co carry the signed-in user's token and map errors to readable messages", async () => {
  arachiReply = (url, init) => {
    if (url.endsWith("/ok")) return { status: 200, body: { hello: "world" } };
    if (url.endsWith("/expired")) return { status: 401, body: { detail: "Sessiyanın vaxtı bitib." } };
    if (url.endsWith("/invalid")) return { status: 422, body: { detail: [{ loc: ["body", "origin"], msg: "Field required" }] } };
    if (url.endsWith("/denied")) return { status: 403, body: { detail: "İcazə rədd edildi!" } };
    if (url.endsWith("/boom")) return { status: 500, body: { detail: "db yoxdur" } };
    if (url.includes("/echo")) return { status: 200, body: { auth: (init.headers as Record<string, string>).authorization, url } };
    return { status: 404, body: { detail: "Tapılmadı" } };
  };
  const as = <T>(fn: () => Promise<T>) => asUser(1, fn, "USER-TOKEN");

  assert.deepEqual(await as(() => arachi("GET", "/ok")), { hello: "world" });
  const echoed = await as(() => arachi<{ auth: string; url: string }>("GET", "/echo", { query: { a: 1, b: "", c: undefined, d: "x y" } }));
  assert.equal(echoed.auth, "Bearer USER-TOKEN");
  assert.equal(echoed.url, "http://arachi.test/echo?a=1&d=x+y");

  await assert.rejects(as(() => arachi("GET", "/expired")), (e: ArachiError) => e.status === 401 && /Aİ istifadə et/.test(e.message));
  await assert.rejects(as(() => arachi("POST", "/invalid", { json: {} })), (e: ArachiError) => e.status === 422 && e.message === "origin: Field required");
  await assert.rejects(as(() => arachi("GET", "/denied")), (e: ArachiError) => e.status === 403 && e.message === "İcazə rədd edildi!");
  await assert.rejects(as(() => arachi("GET", "/boom")), (e: ArachiError) => e.status === 502 && /db yoxdur/.test(e.message));
  await assert.rejects(as(() => arachi("GET", "/nope")), (e: ArachiError) => e.status === 404);

  // no arachi.co token in the context: nothing is sent
  const before = seen.length;
  await assert.rejects(asUser(1, () => arachi("GET", "/ok")), /arachi\.co sessiyası yoxdur/);
  assert.equal(seen.length, before);
});
