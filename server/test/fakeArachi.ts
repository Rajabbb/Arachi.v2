import { config } from "../config";
import { upsertArachiUser, createSession } from "../auth/accounts";

/**
 * A small in-memory arachi.co for tests: just the endpoints the agent's tools call,
 * with the same response shapes and the same ownership rule (a customer only sees
 * their own data, taken from the token). Installed as global fetch for http://arachi.test.
 */

interface Carrier { id: number; customer_id: number; company_name: string; email: string; category_id?: number | null; sub_category_id?: number | null }
interface Category { id: number; customer_id?: number; category_id?: number; name: string }
interface Rfq { id: number; customer_id: number; status: string; [k: string]: unknown }
interface Quote {
  id: number; request_id: number; carrier_id: number; token: string; mail_status: string; is_viewed: boolean;
  price: number | null; currency: string; transit_time_days: number | null; is_winner: boolean;
  extra_details: Record<string, unknown>; quote_history: unknown[];
}

export const arachiData = {
  carriers: [] as Carrier[],
  rfqs: [] as Rfq[],
  quotes: [] as Quote[],
  categories: [] as Category[],
  subCategories: [] as Category[],
  customerQuotes: [] as Record<string, unknown>[],
  mails: [] as { to: string; quoteId: number; reminder: boolean }[],
  calls: [] as string[],
  next: 1,
  /** When set, every call fails with this status (e.g. 401 = arachi.co session ended). */
  failWith: 0,
};

export function resetArachi() {
  arachiData.carriers = [];
  arachiData.rfqs = [];
  arachiData.quotes = [];
  arachiData.mails = [];
  arachiData.categories = [];
  arachiData.subCategories = [];
  arachiData.customerQuotes = [];
  arachiData.calls = [];
  arachiData.next = 1;
  arachiData.failWith = 0;
}

/** An arachi.co-looking JWT for a customer id (the V2 server only reads `sub`; arachi.co verifies it). */
export function fakeJwt(customerId: number): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: String(customerId), via: "ai" })}.sig`;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function handle(method: string, path: string, body: any, customerId: number, form?: FormData): Response | Promise<Response> {
  arachiData.calls.push(`${method} ${path}`);
  const own = (rid: number) => arachiData.rfqs.find((r) => r.id === rid && r.customer_id === customerId);
  let m: RegExpMatchArray | null;

  if (method === "GET" && (m = path.match(/^\/requests\/customer\/(\d+)$/))) {
    if (Number(m[1]) !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    const requests = arachiData.rfqs
      .filter((r) => r.customer_id === customerId)
      .map((r) => ({ ...r, quotes_count: arachiData.quotes.filter((q) => q.request_id === r.id && q.price !== null).length }))
      .reverse();
    return json(200, { status: "success", requests });
  }
  if (method === "POST" && path === "/requests/create") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    const rfq: Rfq = { id: arachiData.next++, customer_id: customerId, status: "open", ...body, created_at: "2026-01-01" };
    arachiData.rfqs.push(rfq);
    if (body.send_option !== "none") throw new Error("the agent must create RFQs without sending");
    return json(200, { status: "success", emailed_count: 0, request_details: rfq });
  }
  if (method === "GET" && (m = path.match(/^\/carriers\/customer\/(\d+)$/))) {
    if (Number(m[1]) !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    return json(200, arachiData.carriers.filter((c) => c.customer_id === customerId));
  }
  if (method === "POST" && path === "/carriers/manual") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    let added = 0;
    for (const c of body.carriers as { name: string; email: string }[]) {
      if (arachiData.carriers.some((x) => x.customer_id === customerId && x.email === c.email)) continue;
      arachiData.carriers.push({ id: arachiData.next++, customer_id: customerId, company_name: c.name, email: c.email });
      added++;
    }
    return json(200, { status: "success", message: `${added} daşıyıcı əlavə edildi.` });
  }
  if (method === "POST" && (m = path.match(/^\/requests\/(\d+)\/send$/))) {
    const rfq = own(Number(m[1]));
    if (!rfq) return json(403, { detail: "İcazə rədd edildi." });
    const sent = [];
    for (const id of (body.carrier_ids ?? []) as number[]) {
      const carrier = arachiData.carriers.find((c) => c.id === id && c.customer_id === customerId);
      if (!carrier || arachiData.quotes.some((q) => q.request_id === rfq.id && q.carrier_id === id)) continue;
      const quote: Quote = {
        id: arachiData.next++, request_id: rfq.id, carrier_id: id, token: `tok-${id}`, mail_status: "pending", is_viewed: false,
        price: null, currency: "AZN", transit_time_days: null, is_winner: false, extra_details: {}, quote_history: [],
      };
      arachiData.quotes.push(quote);
      arachiData.mails.push({ to: carrier.email, quoteId: quote.id, reminder: false });
      sent.push({ carrier_id: id, company_name: carrier.company_name, email: carrier.email });
    }
    if (sent.length === 0) return json(400, { detail: "Göndəriləcək yeni daşıyıcı tapılmadı." });
    return json(200, { status: "success", request_id: rfq.id, sent, skipped_already_sent: [] });
  }
  if (method === "POST" && (m = path.match(/^\/requests\/(\d+)\/public-link$/))) {
    const rfq = own(Number(m[1]));
    if (!rfq) return json(403, { detail: "İcazə rədd edildi." });
    return json(200, { status: "success", public_link: `https://arachi.test/carrier_quote/quote?token=pub-${rfq.id}&public=1` });
  }
  if (method === "GET" && (m = path.match(/^\/requests\/carriers-status\/(\d+)$/))) {
    if (!own(Number(m[1]))) return json(403, { detail: "İcazə rədd edildi." });
    const carriers = arachiData.quotes
      .filter((q) => q.request_id === Number(m![1]))
      .map((q) => {
        const c = arachiData.carriers.find((x) => x.id === q.carrier_id)!;
        return {
          quote_id: q.id, carrier_id: q.carrier_id, company_name: c.company_name, email: c.email, mail_status: q.mail_status,
          is_viewed: q.is_viewed, has_submitted: q.price !== null, token: q.token, is_public: false,
        };
      });
    return json(200, { status: "success", carriers, has_public_link: false });
  }
  if (method === "GET" && (m = path.match(/^\/quotes\/request\/(\d+)$/))) {
    if (!own(Number(m[1]))) return json(403, { detail: "İcazə rədd edildi." });
    const quotes = arachiData.quotes
      .filter((q) => q.request_id === Number(m![1]) && q.price !== null)
      .map((q) => ({ ...q, carrier_company: arachiData.carriers.find((c) => c.id === q.carrier_id)!.company_name }));
    return json(200, { status: "success", quotes });
  }
  if (method === "POST" && path === "/quotes/select-winner") {
    if (!own(body.request_id)) return json(403, { detail: "İcazə rədd edildi." });
    for (const q of arachiData.quotes.filter((q) => q.request_id === body.request_id)) q.is_winner = q.id === body.quote_id;
    own(body.request_id)!.status = "closed";
    return json(200, { status: "success", message: "Təklif qalib olaraq seçildi!" });
  }
  if (method === "POST" && path === "/quotes/reminder-batch") {
    for (const id of body.quote_ids as number[]) {
      const q = arachiData.quotes.find((x) => x.id === id);
      const c = q && arachiData.carriers.find((x) => x.id === q.carrier_id);
      if (q && c) arachiData.mails.push({ to: c.email, quoteId: q.id, reminder: true });
    }
    return json(200, { status: "success", message: "ok" });
  }
  if (method === "GET" && (m = path.match(/^\/customer\/stats\/(\d+)$/))) {
    if (Number(m[1]) !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    const mine = arachiData.rfqs.filter((r) => r.customer_id === customerId);
    return json(200, {
      status: "success",
      active_rfqs: mine.filter((r) => r.status === "open").length,
      incoming_quotes: arachiData.quotes.filter((q) => q.price !== null && mine.some((r) => r.id === q.request_id)).length,
      completed_shipments: mine.filter((r) => r.status === "closed").length,
      carriers_count: arachiData.carriers.filter((c) => c.customer_id === customerId).length,
    });
  }
  if (method === "GET" && (m = path.match(/^\/categories\/customer\/(\d+)$/))) {
    if (Number(m[1]) !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    return json(200, { status: "success", categories: arachiData.categories.filter((c) => c.customer_id === customerId) });
  }
  if (method === "POST" && path === "/categories/create") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    const category = { id: arachiData.next++, customer_id: customerId, name: body.name };
    arachiData.categories.push(category);
    return json(200, { status: "success", category });
  }
  const ownCat = (id: number) => arachiData.categories.some((c) => c.id === id && c.customer_id === customerId);
  if (method === "GET" && (m = path.match(/^\/carrier-sub-categories\/(\d+)$/))) {
    if (!ownCat(Number(m[1]))) return json(403, { detail: "İcazə rədd edildi." });
    return json(200, { status: "success", data: arachiData.subCategories.filter((c) => c.category_id === Number(m![1])) });
  }
  if (method === "POST" && path === "/carrier-sub-categories") {
    if (!ownCat(body.category_id)) return json(403, { detail: "İcazə rədd edildi." });
    const sub = { id: arachiData.next++, category_id: body.category_id, name: body.name };
    arachiData.subCategories.push(sub);
    return json(200, { status: "success", data: sub });
  }
  if (method === "POST" && path === "/carriers/bulk-set-category") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    if (body.category_id > 0 && !ownCat(body.category_id)) return json(403, { detail: "İcazə rədd edildi." });
    for (const c of arachiData.carriers.filter((x) => x.customer_id === customerId && body.carrier_ids.includes(x.id))) {
      c.category_id = body.category_id > 0 ? body.category_id : null;
      c.sub_category_id = body.sub_category_id > 0 ? body.sub_category_id : null;
    }
    return json(200, { status: "success" });
  }
  if (method === "POST" && path === "/carriers/bulk-delete") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    arachiData.carriers = arachiData.carriers.filter((c) => !(c.customer_id === customerId && body.carrier_ids.includes(c.id)));
    return json(200, { status: "success", message: "silindi" });
  }
  if (method === "POST" && path === "/carriers/upload-excel") {
    // The fake reads the file as CSV text: "name,email" lines.
    const file = form?.get("file") as File | null;
    if (!file || Number(form?.get("customer_id")) !== customerId) return json(400, { detail: "Fayl oxunarkən xəta" });
    return file.text().then((csv) => {
      let added = 0;
      for (const line of csv.split("\n").slice(1)) {
        const [name, email] = line.split(",").map((x) => x.trim());
        if (!email || arachiData.carriers.some((c) => c.customer_id === customerId && c.email === email)) continue;
        arachiData.carriers.push({ id: arachiData.next++, customer_id: customerId, company_name: name || "Daşıyıcı", email });
        added++;
      }
      return json(200, { status: "success", message: `${added} yeni daşıyıcı uğurla əlavə edildi!` });
    });
  }
  if (method === "POST" && (m = path.match(/^\/quotes\/cancel-winner\/(\d+)$/))) {
    const q = arachiData.quotes.find((x) => x.id === Number(m![1]));
    if (!q || !own(q.request_id)) return json(403, { detail: "İcazə rədd edildi." });
    for (const x of arachiData.quotes.filter((x) => x.request_id === q.request_id)) x.is_winner = false;
    own(q.request_id)!.status = "open";
    return json(200, { status: "success" });
  }
  if (method === "POST" && path === "/reports/generate") {
    if (body.customer_id !== customerId) return json(403, { detail: "İcazə rədd edildi." });
    const mine = arachiData.rfqs.filter((r) => r.customer_id === customerId).sort((a, b) => b.id - a.id);
    const disp = (id: number) => mine.length - mine.findIndex((r) => r.id === id);
    const picked = mine.filter((r) => body.report_type !== "selected" || (body.rfq_ids as number[]).includes(r.id));
    const data =
      body.report_category === "rfq"
        ? picked.map((r) => ({ "Sorğu ID": `RFQ #${disp(r.id)}`, "Marşrut": `${r.origin} -> ${r.destination}`, "Yük Növü": (r.cargo_type as string) || "Qeyd edilməyib", "Status": r.status.toUpperCase() }))
        : picked.flatMap((r) =>
            arachiData.quotes.filter((q) => q.request_id === r.id && q.price !== null).map((q) => ({
              "Sorğu ID": `RFQ #${disp(r.id)}`,
              "Marşrut": `${r.origin} -> ${r.destination}`,
              "Daşıyıcı Şirkət": arachiData.carriers.find((c) => c.id === q.carrier_id)!.company_name,
              "Qiymət": q.price,
              "Valyuta": q.currency,
            })),
          );
    return json(200, { status: "success", data, category: body.report_category });
  }
  if (method === "POST" && path === "/customer-quotes/create") {
    if (body.customer_id !== customerId || !own(body.request_id)) return json(403, { detail: "İcazə rədd edildi." });
    arachiData.customerQuotes.push(body);
    return json(200, { status: "success" });
  }
  return json(404, { detail: `fake arachi: ${method} ${path}` });
}

/** Wraps fetch so http://arachi.test goes to the fake; returns the restore function. */
export function installFakeArachi(): () => void {
  const realFetch = globalThis.fetch;
  config.arachiApiUrl = "http://arachi.test";
  config.ssoSecret = "shared-secret-for-tests-0123456789";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "http://arachi.test") return realFetch(input, init);
    if (arachiData.failWith) return json(arachiData.failWith, { detail: "simulated failure" });
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    let customerId = 0;
    try {
      customerId = Number(JSON.parse(Buffer.from(auth.replace("Bearer ", "").split(".")[1], "base64url").toString()).sub);
    } catch {
      return json(401, { detail: "Token etibarsızdır." });
    }
    const form = init?.body instanceof FormData ? init.body : undefined;
    const body = init?.body && !form ? JSON.parse(String(init.body)) : undefined;
    return handle(init?.method ?? "GET", url.pathname, body, customerId, form);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** A signed-in V2 user for an arachi.co customer; returns the session cookie and ids. */
export async function signIn(customerId: number, name = "Pro MMC") {
  const user = await upsertArachiUser({ customerId, name });
  const session = await createSession(user.id, { token: fakeJwt(customerId), expiresInSeconds: 3600 });
  return { userId: user.id, cookie: `arachi_session=${session.token}`, token: fakeJwt(customerId) };
}
