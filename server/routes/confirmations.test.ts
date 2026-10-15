import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { app } from "../app";
import { db } from "../db";
import { setProvider } from "../agent/providers";
import type { ModelProvider, ModelStep } from "../agent/providers/types";
import { call, freshDb, RFQ_DEFAULTS } from "../test/helpers";
import { arachiData, installFakeArachi, signIn } from "../test/fakeArachi";
import type { ChatResponse, ConfirmationResponse, ConversationData } from "../../shared/protocol";

/** Messages to carriers wait for the user's "Bəli"; the agent alone cannot send them. */

let server: Server;
let base: string;
let restore: () => void;

before(async () => {
  restore = installFakeArachi();
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  restore();
});
afterEach(() => setProvider(undefined));

type Msg = { fake: string };

/** On each user message: calls the given tool once, then answers; records what it was sent. */
function toolCallingProvider(name: string, input: Record<string, unknown>) {
  const seen: string[] = [];
  const provider: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(_system, messages): Promise<ModelStep<Msg>> {
      const last = messages[messages.length - 1].fake;
      seen.push(last);
      if (last.startsWith("user:")) return { kind: "tool_calls", message: { fake: "calls" }, calls: [{ id: "1", name, input }] };
      return { kind: "answer", message: { fake: "answer" }, text: "Bəli düyməsini basın." };
    },
    toolResults: (results) => ({ fake: `results:${results.map((r) => r.content).join("|")}` }),
    describeError: () => null,
  };
  setProvider(provider as ModelProvider);
  return seen;
}

let cookie: string;
let userId: number;
async function request<T>(method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as T };
}

beforeEach(async () => {
  await freshDb();
  await db().run("DELETE FROM users");
  ({ cookie, userId } = await signIn(1));
  await call("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Tbilisi", cargo_type: "Un", weight_kg: 500 }, undefined, userId);
  await call("add_carriers", { carriers: [{ name: "Road A", email: "a@road.az" }, { name: "Evil", email: "x@evil.example" }] }, undefined, userId);
});

test("the agent's send waits for Bəli, which sends exactly what was shown", async () => {
  const seen = toolCallingProvider("send_rfq_to_carriers", { rfq_id: 1 });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  assert.equal(chat.status, 200);
  assert.equal(arachiData.mails.length, 0, "nothing sent before Bəli");
  assert.match(seen[1], /waiting_for_user/);
  const [c] = chat.body.confirmations;
  assert.equal(c.status, "pending");
  assert.match(c.text, /2 daşıyıcıya/);
  assert.match(c.text, /x@evil\.example/, "the user sees every address");

  // A carrier added afterwards is not included: the confirmed list is frozen.
  await call("add_carriers", { carriers: [{ name: "Late", email: "late@x.az" }] }, undefined, userId);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.confirmation.status, "done");
  assert.match(yes.body.message!.text, /2 daşıyıcıya göndərildi/);
  assert.deepEqual(arachiData.mails.map((m) => m.to).sort(), ["a@road.az", "x@evil.example"]);

  // A second click cannot send again.
  assert.equal((await request("POST", `/api/confirmations/${c.id}`, { approve: true })).status, 409);
  assert.equal(arachiData.mails.length, 2);

  // The saved chat shows the card with its status, and the agent hears the outcome next turn.
  const saved = await request<ConversationData>("GET", `/api/conversations/${chat.body.conversationId}`);
  assert.equal(saved.body.messages[1].confirmations![0].status, "done");
  await request("POST", "/api/chat", { conversationId: chat.body.conversationId, message: { text: "sonra?", files: [] } });
  assert.match(seen.find((s) => s.includes("sonra?"))!, /pressed "Bəli".*2 daşıyıcıya göndərildi/s);
});

test("Xeyr sends nothing, and nobody else can answer the confirmation", async () => {
  toolCallingProvider("send_reminders", { rfq_id: 1 });
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, userId);
  arachiData.mails.length = 0;
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "xatırlat", files: [] } });
  const [c] = chat.body.confirmations;
  assert.match(c.text, /2 daşıyıcıya xatırlatma/);

  const mine = cookie;
  cookie = (await signIn(2, "Başqa MMC")).cookie;
  assert.equal((await request("POST", `/api/confirmations/${c.id}`, { approve: true })).status, 404);
  cookie = mine;

  const no = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: false });
  assert.equal(no.body.confirmation.status, "declined");
  assert.equal(arachiData.mails.length, 0);
});

test("confirming after the arachi.co session ended fails cleanly and sends nothing", async () => {
  toolCallingProvider("send_rfq_to_carriers", { rfq_id: 1 });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  arachiData.failWith = 401;
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${chat.body.confirmations[0].id}`, { approve: true });
  arachiData.failWith = 0;
  assert.equal(yes.body.confirmation.status, "failed");
  assert.match(yes.body.message!.text, /Alınmadı.*yenidən/);
  assert.equal(arachiData.mails.length, 0);
});

test("selecting a winner runs at once, with no confirmation card", async () => {
  await call("send_rfq_to_carriers", { rfq_id: 1 }, undefined, userId);
  const q = arachiData.quotes[0];
  Object.assign(q, { price: 900, transit_time_days: 5, currency: "USD" });
  toolCallingProvider("select_winner", { rfq_id: 1, offer_id: q.id });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "qalibi seç", files: [] } });
  assert.equal(chat.body.confirmations.length, 0);
  assert.equal(arachiData.rfqs[0].status, "closed");
});

test("asking for the same send twice in one turn shows one card", async () => {
  const twice: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (_t): _t is Msg[] => true,
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(_s, messages): Promise<ModelStep<Msg>> {
      const calls = messages.filter((m) => m.fake === "calls").length;
      if (calls < 2) return { kind: "tool_calls", message: { fake: "calls" }, calls: [{ id: "1", name: "send_rfq_to_carriers", input: { rfq_id: 1 } }] };
      return { kind: "answer", message: { fake: "answer" }, text: "ok" };
    },
    toolResults: () => ({ fake: "results" }),
    describeError: () => null,
  };
  setProvider(twice as ModelProvider);
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  assert.equal(chat.body.confirmations.length, 1);
  assert.equal(Number((await db().get<{ n: number }>("SELECT count(*) AS n FROM confirmations"))!.n), 1);
});

test("result cards show what was done: with the reply, saved with it, and for what Bəli ran", async () => {
  // An RFQ created in chat comes with a card of its fields to check.
  toolCallingProvider("create_rfq", {
    ...RFQ_DEFAULTS, origin: "Bakı", destination: "Milan", volume_unit: "CBM", volume_amount: 3, incoterm: "FOB", adr: "Klass 3",
  });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "sorğu yarat", files: [] } });
  assert.equal(chat.body.cards.length, 0, "nothing was created yet: the RFQ waits for Bəli");
  assert.equal(chat.body.confirmations.length, 1);
  assert.match(chat.body.confirmations[0].text, /Yükləmə yeri: Bakı/);
  const created = await request<ConfirmationResponse>("POST", `/api/confirmations/${chat.body.confirmations[0].id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(created.body.message!.cards!.length, 1);
  const card = created.body.message!.cards![0];
  assert.match(card.title, /RFQ #2 yaradıldı/);
  const rows = Object.fromEntries((card.rows ?? []).map((r) => [r.label, r.value]));
  assert.equal(rows["Yükləmə yeri"], "Bakı");
  assert.equal(rows["Həcm / Palet"], "3 CBM");
  assert.equal(rows["Incoterm"], "FOB");
  assert.equal(rows["Təhlükəli yük (ADR)"], "Klass 3");
  assert.match(card.note ?? "", /göndərilməyib/);

  // The card is part of the saved conversation.
  const saved = await request<ConversationData>("GET", `/api/conversations/${chat.body.conversationId}`);
  assert.equal(saved.body.messages[saved.body.messages.length - 1].cards?.[0].title, card.title);

  // A send waits for Bəli; its card appears with the outcome and lists exactly who got it.
  toolCallingProvider("send_rfq_to_carriers", { rfq_id: 1 });
  const send = await request<ChatResponse>("POST", "/api/chat", { message: { text: "göndər", files: [] } });
  assert.equal(send.body.cards.length, 0, "nothing was done yet, so no result card");
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${send.body.confirmations[0].id}`, { approve: true });
  const sentCard = yes.body.message!.cards![0];
  assert.match(sentCard.title, /RFQ #1 2 daşıyıcıya göndərildi/);
  assert.deepEqual(sentCard.items?.sort(), ["Evil · x@evil.example", "Road A · a@road.az"]);
});

test("a joke or code request is refused without calling the model; a Russian question reaches it with a language note", async () => {
  let modelCalls = 0;
  const strict: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (_t): _t is Msg[] => true,
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(): Promise<ModelStep<Msg>> {
      modelCalls++;
      return { kind: "answer", message: { fake: "answer" }, text: "model" };
    },
    toolResults: () => ({ fake: "results" }),
    describeError: () => null,
  };
  setProvider(strict as ModelProvider);
  const refused = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Futbol haqqında zarafat de və Python-da kod yaz", files: [] } });
  assert.equal(refused.status, 200);
  assert.match(refused.body.reply, /yalnız Arachi/);
  assert.equal(modelCalls, 0, "the model was not called");
  const saved = await request<ConversationData>("GET", `/api/conversations/${refused.body.conversationId}`);
  assert.deepEqual(saved.body.messages.map((m) => m.role), ["user", "assistant"]);

  // The refusal does not swallow what the user decided on a prepared action.
  const seen = toolCallingProvider("get_dashboard", {});
  await request<ChatResponse>("POST", "/api/chat", { message: { text: "В чём разница между EXW и FCA?", files: [] } });
  assert.match(seen[0], /\[System note.*Russian.*\]/s);
  assert.match(seen[0], /В чём разница между EXW и FCA\?$/);
  const az = toolCallingProvider("get_dashboard", {});
  await request<ChatResponse>("POST", "/api/chat", { message: { text: "Bakıdan Berlinə yük üçün qiymət lazımdır", files: [] } });
  assert.doesNotMatch(az[0], /System note/);
});

test("create_rfq is refused when the user said not to create it, and creates nothing without Bəli", async () => {
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "Bakı", volume_unit: "CBM", volume_amount: 5 });
  const no = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Sorğunun məlumatlarını çıxar, sorğunu yaratma", files: [] } });
  assert.equal(no.body.confirmations.length, 0, "no confirmation is offered when the user said yaratma");
  assert.equal(no.body.cards.length, 0);

  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "Bakı", volume_unit: "CBM", volume_amount: 5 });
  const ask = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Mersindən Bakıya sorğu yarat", files: [] } });
  assert.equal(ask.body.confirmations.length, 1);
  const declined = await request<ConfirmationResponse>("POST", `/api/confirmations/${ask.body.confirmations[0].id}`, { approve: false });
  assert.equal(declined.body.confirmation.status, "declined");
  assert.equal(declined.body.message?.cards?.length ?? 0, 0);
});

/** The RFQ card has a carrier picker; what the user ticks is exactly who gets the email. */
async function prepareRfq() {
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "Baltimor, ABŞ", volume_unit: "Palet", volume_amount: 40, transport_mode: "Dəniz", container_type: "20DC", container_count: 2, loading_date: "2026-10-13", delivery_deadline: "2026-10-30" });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "sorğu yarat, daşıyıcını seçəcəm", files: [] } });
  return chat.body.confirmations[0];
}

test("a new RFQ card offers the carrier base, container and warnings", async () => {
  const c = await prepareRfq();
  assert.equal(c.tool, "create_rfq");
  assert.deepEqual(c.choices!.carriers.map((x) => x.email).sort(), ["a@road.az", "x@evil.example"]);
  assert.match(c.text, /Konteyner: 2 × 20DC/);
  assert.match(c.text, /⚠.*17 gün/s, "17 days by sea to a far place is flagged");
  assert.match(c.text, /⚠.*40 palet/s, "40 pallets do not fit 2 × 20 ft");
  assert.doesNotMatch(c.text, /daşıyıcılara göndərilmir/);
  assert.equal(arachiData.mails.length, 0);
  assert.equal(arachiData.rfqs.length, 1, "nothing created before the user chooses");
});

test("create and send goes only to the ticked carrier", async () => {
  const c = await prepareRfq();
  const a = c.choices!.carriers.find((x) => x.email === "a@road.az")!;
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "send", carrierIds: [a.id] });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.confirmation.status, "done");
  assert.equal(arachiData.rfqs.length, 2);
  assert.deepEqual(arachiData.mails.map((m) => m.to), ["a@road.az"], "the unticked carrier got nothing");
  assert.match(yes.body.message!.text, /RFQ #\d+ yaradıldı\. 1 daşıyıcıya göndərildi: Road A \(a@road\.az\)/);
  assert.doesNotMatch(yes.body.message!.text, /evil/);
  const titles = (yes.body.message!.cards ?? []).map((x) => x.title);
  assert.ok(titles.some((t) => /yaradıldı/.test(t)) && titles.some((t) => /göndərildi/.test(t)));
  const rfqCard = yes.body.message!.cards!.find((x) => /yaradıldı/.test(x.title))!;
  assert.equal(rfqCard.note, undefined, "the card no longer says it was not sent");
});

test("only create sends nothing; link-only makes a link and sends nothing; cancel creates nothing", async () => {
  const only = await prepareRfq();
  const created = await request<ConfirmationResponse>("POST", `/api/confirmations/${only.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.match(created.body.message!.text, /yaradıldı/);
  assert.equal(arachiData.mails.length, 0);
  assert.equal(arachiData.rfqs.length, 2);

  const link = await prepareRfq();
  const made = await request<ConfirmationResponse>("POST", `/api/confirmations/${link.id}`, { approve: true, mode: "link", carrierIds: [] });
  assert.match(made.body.message!.text, /Heç bir daşıyıcıya email göndərilmədi. Ümumi link: http/);
  assert.equal(arachiData.mails.length, 0);
  assert.equal(arachiData.rfqs.length, 3);

  const cancel = await prepareRfq();
  const no = await request<ConfirmationResponse>("POST", `/api/confirmations/${cancel.id}`, { approve: false });
  assert.equal(no.body.confirmation.status, "declined");
  assert.equal(arachiData.rfqs.length, 3, "cancel creates no RFQ");
  assert.equal(arachiData.mails.length, 0);
});

test("a send with nobody ticked, or a carrier outside the list, is refused and stays pending", async () => {
  const c = await prepareRfq();
  const none = await request<{ error: string }>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "send", carrierIds: [] });
  assert.equal(none.status, 400);
  const foreign = await request<{ error: string }>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "send", carrierIds: [9999] });
  assert.equal(foreign.status, 400);
  const noMode = await request<{ error: string }>("POST", `/api/confirmations/${c.id}`, { approve: true });
  assert.equal(noMode.status, 400);
  assert.equal(arachiData.rfqs.length, 1);
  const saved = await request<ConversationData>("GET", `/api/conversations/${(await request<{ conversations: { id: number }[] }>("GET", "/api/conversations")).body.conversations[0].id}`);
  assert.equal(saved.body.messages.at(-1)!.confirmations![0].status, "pending");
  assert.ok(saved.body.messages.at(-1)!.confirmations![0].choices, "the picker survives a reload");
  // The user can still make a valid choice afterwards.
  const ok = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(ok.status, 200);
});

test("sea freight: the port is asked for, a truck type becomes a reefer container", async () => {
  // "Vaşinqton, ABŞ" is not a port: nothing is prepared and the model is told to ask which one.
  await assert.rejects(
    call("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin, Türkiyə", destination: "Vaşinqton, ABŞ", transport_mode: "Dəniz" }, undefined, userId),
    /liman.hava limanı olmalıdır.*Baltimor/s,
  );
  await assert.rejects(call("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "ABŞ", transport_mode: "Dəniz" }, undefined, userId), /yalnız ölkədir/);
  await assert.rejects(call("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Washington", transport_mode: "Hava" }, undefined, userId), /hava limanını/);

  // A named port, or any road/rail route, is fine.
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "Baltimor, ABŞ", transport_mode: "Dəniz", truck_type: "Refrijerator", container_type: "20DC", container_count: 2, temperature: "+3 °C" });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "sorğu yarat", files: [] } });
  const c = chat.body.confirmations[0];
  assert.match(c.text, /Konteyner: 2 × 20 reefer/);
  assert.doesNotMatch(c.text, /Maşın növü/);
  await request("POST", `/api/confirmations/${c.id}`, { approve: false });

  // Cold cargo at sea without a container size: ask.
  await assert.rejects(
    call("create_rfq", { ...RFQ_DEFAULTS, origin: "Mersin", destination: "Baltimor", transport_mode: "Dəniz", temperature: "+3 °C" }, undefined, userId),
    /20 ft yoxsa 40 ft/,
  );
});

test("with a carrier picker the plain carrier-list card is left out", async () => {
  const seen: string[] = [];
  const provider: ModelProvider<Msg> = {
    name: "anthropic",
    model: "fake",
    ownsTranscript: (t): t is Msg[] => t.every((m) => typeof m === "object" && m !== null && "fake" in m),
    userMessage: (text) => ({ fake: `user:${text}` }),
    dropAttachments: (m) => m,
    async generate(_s, messages): Promise<ModelStep<Msg>> {
      const last = messages[messages.length - 1].fake;
      seen.push(last);
      if (last.startsWith("user:")) {
        return {
          kind: "tool_calls",
          message: { fake: "calls" },
          calls: [
            { id: "1", name: "list_carriers", input: {} },
            { id: "2", name: "create_rfq", input: { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Tbilisi" } },
          ],
        };
      }
      return { kind: "answer", message: { fake: "answer" }, text: "Seçin." };
    },
    toolResults: (results) => ({ fake: `results:${results.length}` }),
    describeError: () => null,
  };
  setProvider(provider as ModelProvider);
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "daşıyıcıları göstər və sorğu yarat", files: [] } });
  assert.equal(chat.body.confirmations.length, 1);
  assert.ok(chat.body.confirmations[0].choices);
  assert.equal(chat.body.cards.some((x) => /Daşıyıcı bazası/.test(x.title)), false, "the carrier list is shown once, in the picker");
});

/** A new RFQ prepared from attached files: the user may show one of them to carriers. */
const b64 = (text: string) => Buffer.from(text).toString("base64");
async function prepareWithFiles(files: { name: string; type: string; data: string }[]) {
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Tbilisi" });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "bu fayldan sorğu yarat", files } });
  return chat.body.confirmations[0];
}

test("the card lists attachable files by name only, and keeps no file that arachi.co would refuse", async () => {
  const c = await prepareWithFiles([
    { name: "rfq.xlsx", type: "", data: b64("PK") },
    { name: "macro.xlsm", type: "", data: b64("PK") },
    { name: "notes.txt", type: "text/plain", data: b64("salam") },
  ]);
  assert.deepEqual(c.files!.map((f) => f.name), ["rfq.xlsx", "notes.txt"]);
  assert.equal(JSON.stringify(c).includes(b64("salam")), false, "contents are never sent back to the browser");
  assert.equal(arachiData.uploads.length, 0, "nothing is uploaded before the user chooses");
});

test("a chosen file is uploaded and shown to carriers; otherwise nothing is uploaded", async () => {
  const withFile = await prepareWithFiles([{ name: "rfq.pdf", type: "application/pdf", data: b64("%PDF") }]);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${withFile.id}`, { approve: true, mode: "create", carrierIds: [], attachFile: 0 });
  assert.equal(yes.status, 200);
  assert.deepEqual(arachiData.uploads.map((u) => u.name), ["rfq.pdf"]);
  assert.equal(arachiData.uploads[0].type, "application/pdf");
  const stored = arachiData.rfqs[arachiData.rfqs.length - 1] as Record<string, unknown>;
  assert.equal(stored.attachment_url, "/uploads/uuid-rfq.pdf");
  assert.match(yes.body.message!.text, /Fayl daşıyıcılara görünür: rfq.pdf/);
  const row = await db().get<{ files: string | null }>("SELECT files FROM confirmations WHERE id = ?", withFile.id);
  assert.equal(row!.files, null, "the file is not kept after the card was answered");

  arachiData.uploads.length = 0;
  const without = await prepareWithFiles([{ name: "rfq2.pdf", type: "application/pdf", data: b64("%PDF") }]);
  await request<ConfirmationResponse>("POST", `/api/confirmations/${without.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(arachiData.uploads.length, 0);
  assert.equal((arachiData.rfqs[arachiData.rfqs.length - 1] as Record<string, unknown>).attachment_url, undefined);
});

test("a bad file index is refused, a refused upload still creates the RFQ and says so", async () => {
  const c = await prepareWithFiles([{ name: "rfq.pdf", type: "application/pdf", data: b64("%PDF") }]);
  const bad = await request<{ error: string }>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [], attachFile: 5 });
  assert.equal(bad.status, 400);

  const refused = await prepareWithFiles([{ name: "bad.pdf", type: "application/pdf", data: b64("%PDF") }]);
  const before = arachiData.rfqs.length;
  const res = await request<ConfirmationResponse>("POST", `/api/confirmations/${refused.id}`, { approve: true, mode: "create", carrierIds: [], attachFile: 0 });
  assert.equal(res.status, 200);
  assert.equal(arachiData.rfqs.length, before + 1, "the RFQ is still created");
  assert.match(res.body.message!.text, /Fayl əlavə olunmadı/);
  assert.equal((arachiData.rfqs[arachiData.rfqs.length - 1] as Record<string, unknown>).attachment_url, undefined);
});

/** The RFQ card with a subject (group) the agent filled from what the user said. */
async function prepareRfqWithSubject(subject: string) {
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Poti", volume_unit: "CBM", volume_amount: 20, subject });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Bakıdan Potiyə sorğu yarat", files: [] } });
  return chat.body.confirmations[0];
}

const lastRfq = () => arachiData.rfqs[arachiData.rfqs.length - 1] as unknown as Record<string, unknown>;

test("the subject is shown on the card and goes to arachi.co with the RFQ, not into the notes", async () => {
  const c = await prepareRfqWithSubject("Sifarişçi: Azersun");
  assert.equal(c.fields?.subject, "Sifarişçi: Azersun");
  assert.match(c.text, /Başlıq \(qrup\): Sifarişçi: Azersun/);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(yes.body.confirmation.status, "done");
  assert.equal(lastRfq().subject, "Sifarişçi: Azersun");
  assert.doesNotMatch(String(lastRfq().additional_notes ?? ""), /Azersun/);
});

test("the subject can be changed or cleared on the card before pressing the button", async () => {
  const edited = await prepareRfqWithSubject("Köhnə qrup");
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${edited.id}`, {
    approve: true, mode: "create", carrierIds: [], edits: { subject: "  Gürcüstan" + String.fromCharCode(10) + "  yükləri " },
  });
  assert.equal(yes.body.confirmation.status, "done");
  assert.equal(lastRfq().subject, "Gürcüstan yükləri");

  const cleared = await prepareRfqWithSubject("Silinəcək");
  await request<ConfirmationResponse>("POST", `/api/confirmations/${cleared.id}`, { approve: true, mode: "create", carrierIds: [], edits: { subject: "" } });
  assert.equal(lastRfq().subject, "");
});

test("a card without a subject offers an empty field, and a long subject is cut to 120 characters", async () => {
  toolCallingProvider("create_rfq", { ...RFQ_DEFAULTS, origin: "Bakı", destination: "Poti", volume_unit: "CBM", volume_amount: 20 });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Bakıdan Potiyə sorğu yarat", files: [] } });
  const c = chat.body.confirmations[0];
  assert.equal(c.fields?.subject, "");
  assert.doesNotMatch(c.text, /Başlıq/);
  await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [], edits: { subject: "x".repeat(300) } });
  assert.equal(String(lastRfq().subject ?? "").length, 120);
});

test("only origin, destination and cargo type are mandatory: weight, volume and transport mode may be missing", async () => {
  toolCallingProvider("create_rfq", { origin: "Bakı", destination: "Poti", cargo_type: "alma" });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Bakıdan Potiyə alma üçün sorğu yarat", files: [] } });
  assert.equal(chat.body.confirmations.length, 1, "the card is offered without weight, volume or mode");
  const c = chat.body.confirmations[0];
  assert.doesNotMatch(c.text, /Çəki|Həcm|Daşınma növü/);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(yes.body.confirmation.status, "done");
  const rfq = lastRfq();
  assert.equal(rfq.cargo_type, "alma");
  assert.equal(Number(rfq.weight_kg ?? 0), 0);
  assert.equal(rfq.transportation_mode, "");
  assert.ok(!(rfq.required_fields as string[]).some((l) => /Həcm \/ Palet/.test(l)), "no volume line when none was given");
});

test("a missing origin, destination or cargo type still asks the user (no card)", async () => {
  toolCallingProvider("create_rfq", { origin: "Bakı", destination: "Poti", cargo_type: "" });
  const chat = await request<ChatResponse>("POST", "/api/chat", { message: { text: "Bakıdan Potiyə sorğu yarat", files: [] } });
  assert.equal(chat.body.confirmations.length, 0);
});

test("fields changed on the card are applied and checked before the RFQ is created", async () => {
  const c = await prepareRfqWithSubject("Qrup A");
  assert.equal(c.fields?.origin, "Bakı");
  assert.equal(c.fields?.weight_kg, RFQ_DEFAULTS.weight_kg);
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, {
    approve: true, mode: "create", carrierIds: [],
    edits: { origin: "Gəncə, Azərbaycan", cargo_type: "Un", weight_kg: 1500, volume_amount: 12, volume_unit: "Palet", transport_mode: "Quru", notes: "Səhər çatsın", hs_code: "1101.00" },
  });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.confirmation.status, "done");
  const rfq = lastRfq();
  assert.equal(rfq.origin, "Gəncə, Azərbaycan");
  assert.equal(rfq.cargo_type, "Un");
  assert.equal(rfq.weight_kg, 1500);
  assert.equal(rfq.transportation_mode, "Quru (Road)");
  assert.equal(rfq.additional_notes, "Səhər çatsın");
  const lines = rfq.required_fields as string[];
  assert.ok(lines.includes("Həcm / Palet: 12 Palet") && lines.includes("HS Code: 1101.00"), lines.join(" | "));
  assert.equal(rfq.subject, "Qrup A", "fields that were not touched keep the prepared value");
});

test("a bad edit is refused on the card: nothing is created and the card stays pending", async () => {
  const c = await prepareRfqWithSubject("Qrup B");
  const before = arachiData.rfqs.length;
  for (const bad of [{ origin: "" }, { cargo_type: "   " }, { weight_kg: -5 }, { quote_deadline: "2020-01-01T10:00" }, { loading_date: "dünən" }, { transport_mode: "Gəmi" }]) {
    const no = await request<{ error: string }>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [], edits: bad });
    assert.equal(no.status, 400, JSON.stringify(bad));
    assert.ok(no.body.error);
  }
  assert.equal(arachiData.rfqs.length, before, "no RFQ was created");
  const again = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, { approve: true, mode: "create", carrierIds: [] });
  assert.equal(again.body.confirmation.status, "done", "the card could still be confirmed");
});

test("fields the card does not show cannot be changed through edits", async () => {
  const c = await prepareRfqWithSubject("Qrup C");
  const yes = await request<ConfirmationResponse>("POST", `/api/confirmations/${c.id}`, {
    approve: true, mode: "create", carrierIds: [], edits: { auto_reminder: false, customer_id: 999, status: "closed", origin: "Mingəçevir" },
  });
  assert.equal(yes.body.confirmation.status, "done");
  const rfq = lastRfq();
  assert.equal(rfq.origin, "Mingəçevir");
  assert.equal(rfq.status, "open");
  assert.notEqual(rfq.customer_id, 999);
});
