import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatError, QuotePageData, QuoteSubmission } from "../../shared/protocol";
import { formatSize, toUploadedFile } from "../lib/agent";

type Lang = "az" | "en";
type CarrierOffer = QuotePageData["offers"][number];

const latestOf = (o: CarrierOffer) => o.versions[o.versions.length - 1];

const t = {
  az: {
    title: "Qiymət təklifi",
    loading: "Yüklənir...",
    route: "Marşrut",
    cargo: "Yük",
    weight: "Çəki",
    volume: "Həcm",
    pallets: "Palet",
    transport: "Nəqliyyat",
    loading_date: "Yükləmə tarixi",
    delivery_date: "Çatdırılma tarixi",
    deadline: "Təklif son tarixi",
    notes: "Qeydlər",
    flexible: "çevik",
    status: "Status",
    price: "Qiymət",
    currency: "Valyuta",
    transit: "Tranzit müddəti (gün)",
    valid: "Təklif etibarlıdır (tarixədək)",
    yourNotes: "Qeydlər / şərtlər",
    docs: "Sənədlər",
    addDocs: "Sənəd əlavə et",
    submit: "Təklifi göndər",
    submitNew: "Yeni təklif göndər",
    update: (n: number, v: number) => `Təklif №${n}-i yenilə (v${v})`,
    mode: "Nə etmək istəyirsiniz?",
    modeNew: "Yeni, ayrıca təklif göndərmək",
    modeUpdate: (n: number, summary: string) => `Təklif №${n}-i yeniləmək (${summary})`,
    modeHint: "Əvvəlki təklifi yeniləsəniz, o təklifin yeni versiyası yaranır. Yeni təklif isə ayrıca təklif kimi qəbul edilir.",
    updateThis: "Bu təklifi yenilə",
    sending: "Göndərilir...",
    sent: "Təklifiniz qəbul edildi. Təşəkkür edirik!",
    updated: (n: number, v: number) => `Təklif №${n} yeniləndi (v${v}). Təşəkkür edirik!`,
    closed: "Bu sorğu üzrə təkliflər artıq qəbul edilmir.",
    history: "Göndərdiyiniz təkliflər",
    offer: (n: number) => `Təklif №${n}`,
    current: "cari",
    previous: "əvvəlki versiyalar",
    days: "gün",
    kg: "kq",
    error: "Xəta",
  },
  en: {
    title: "Price offer",
    loading: "Loading...",
    route: "Route",
    cargo: "Cargo",
    weight: "Weight",
    volume: "Volume",
    pallets: "Pallets",
    transport: "Transport",
    loading_date: "Loading date",
    delivery_date: "Delivery date",
    deadline: "Offer deadline",
    notes: "Notes",
    flexible: "flexible",
    status: "Status",
    price: "Price",
    currency: "Currency",
    transit: "Transit time (days)",
    valid: "Offer valid until",
    yourNotes: "Notes / terms",
    docs: "Documents",
    addDocs: "Add documents",
    submit: "Send offer",
    submitNew: "Send a new offer",
    update: (n: number, v: number) => `Update offer #${n} (v${v})`,
    mode: "What would you like to do?",
    modeNew: "Send a new, separate offer",
    modeUpdate: (n: number, summary: string) => `Update offer #${n} (${summary})`,
    modeHint: "Updating an earlier offer adds a new version of it. A new offer is received as a separate offer.",
    updateThis: "Update this offer",
    sending: "Sending...",
    sent: "Your offer has been received. Thank you!",
    updated: (n: number, v: number) => `Offer #${n} updated (v${v}). Thank you!`,
    closed: "This request is no longer accepting offers.",
    history: "Your offers",
    offer: (n: number) => `Offer #${n}`,
    current: "current",
    previous: "earlier versions",
    days: "days",
    kg: "kg",
    error: "Error",
  },
};

const statusEn: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  viewed: "Viewed",
  offered: "Offer received",
  failed: "Not delivered",
};

const transportEn: Record<string, string> = { Quru: "Road", "Dəniz": "Sea", Hava: "Air", "Dəmiryolu": "Rail" };

async function request(token: string, body?: QuoteSubmission): Promise<QuotePageData> {
  const res = await fetch(`/api/quote/${token}`, body ? { method: "POST", body: JSON.stringify(body) } : undefined);
  const data = (await res.json().catch(() => null)) as QuotePageData | ChatError | null;
  if (!res.ok || !data || "error" in data) {
    throw new Error(data && "error" in data ? data.error : "Serverlə əlaqə qurulmadı.");
  }
  return data;
}

/** The page a carrier opens from their personal link: no login, AZ/EN, mobile friendly. */
export default function QuotePage({ token }: { token: string }) {
  const [data, setData] = useState<QuotePageData | null>(null);
  const [lang, setLang] = useState<Lang>("az");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  /** The offer being updated; 0 = a new, separate offer. */
  const [offerNo, setOfferNo] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [transit, setTransit] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    request(token)
      .then((d) => {
        setData(d);
        setLang(d.carrier.language);
        setCurrency(d.rfq.currency);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const s = t[lang];

  function fillForm(o: CarrierOffer["versions"][number] | null) {
    setPrice(o ? String(o.price) : "");
    setCurrency(o ? o.currency : (data?.rfq.currency ?? "USD"));
    setTransit(o ? String(o.transit_days) : "");
    setValidUntil(o ? o.valid_until : "");
    setNotes(o ? o.notes : "");
    setFiles([]);
  }

  /** Switches between a new offer and updating one; an update starts from that offer's latest values. */
  function chooseOffer(n: number) {
    setOfferNo(n);
    setDone("");
    const offer = data?.offers.find((o) => o.offer_no === n);
    fillForm(offer ? latestOf(offer) : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await request(token, {
        price: Number(price.replace(",", ".")),
        currency,
        transit_days: Number(transit),
        valid_until: validUntil,
        notes,
        files: await Promise.all(files.map(toUploadedFile)),
        offer_no: offerNo,
      });
      setData(d);
      const updated = d.offers.find((o) => o.offer_no === offerNo);
      setDone(updated ? s.updated(offerNo, latestOf(updated).version) : s.sent);
      setOfferNo(0);
      fillForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const rfq = data?.rfq;
  const chosen = data?.offers.find((o) => o.offer_no === offerNo);
  const submitLabel = chosen
    ? s.update(chosen.offer_no, latestOf(chosen).version + 1)
    : data?.offers.length ? s.submitNew : s.submit;
  const rows: [string, string][] = rfq
    ? [
        [s.route, `${rfq.origin} → ${rfq.destination}`],
        [s.cargo, rfq.cargo_type],
        [s.weight, `${rfq.weight_kg} ${s.kg}`],
        ...(rfq.volume_m3 ? [[s.volume, `${rfq.volume_m3} m³`] as [string, string]] : []),
        ...(rfq.pallets ? [[s.pallets, String(rfq.pallets)] as [string, string]] : []),
        [s.transport, lang === "en" ? (transportEn[rfq.transport_type] ?? rfq.transport_type) : rfq.transport_type],
        [s.loading_date, rfq.loading_date || s.flexible],
        [s.delivery_date, rfq.delivery_date || s.flexible],
        [s.deadline, rfq.offer_deadline],
        ...(rfq.notes ? [[s.notes, rfq.notes] as [string, string]] : []),
        [s.status, lang === "en" ? (statusEn[data!.statusCode] ?? data!.status) : data!.status],
      ]
    : [];

  return (
    <div className="page">
      <header className="header">
        <span className="logo">Arachi</span>
        <span className="header-title">{rfq ? `${s.title} · RFQ #${rfq.id}` : s.title}</span>
        <div className="lang-switch" role="group" aria-label="Language">
          {(["az", "en"] as const).map((l) => (
            <button key={l} type="button" className={l === lang ? "active" : ""} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="page-body">
        {!data && !error && <p className="muted">{s.loading}</p>}
        {error && <p className="error">{s.error}: {error}</p>}

        {rfq && (
          <>
            {data!.carrier.name && <h2 className="carrier-name">{data!.carrier.name}</h2>}
            <dl className="details">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>

            {done && <p className="success">{done}</p>}

            {rfq.open ? (
              <form className="card form" onSubmit={submit} ref={formRef}>
                {data!.offers.length > 0 && (
                  <label>
                    {s.mode}
                    <select value={offerNo} onChange={(e) => chooseOffer(Number(e.target.value))}>
                      <option value={0}>{s.modeNew}</option>
                      {data!.offers.map((o) => {
                        const v = latestOf(o);
                        return (
                          <option key={o.offer_no} value={o.offer_no}>
                            {s.modeUpdate(o.offer_no, `${v.price} ${v.currency}, ${v.transit_days} ${s.days}, v${v.version}`)}
                          </option>
                        );
                      })}
                    </select>
                    <span className="small">{s.modeHint}</span>
                  </label>
                )}
                <div className="form-row">
                  <label>
                    {s.price}
                    <input inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} />
                  </label>
                  <label>
                    {s.currency}
                    <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option>USD</option>
                      <option>EUR</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label>
                    {s.transit}
                    <input type="number" min={1} step={1} required value={transit} onChange={(e) => setTransit(e.target.value)} />
                  </label>
                  <label>
                    {s.valid}
                    <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </label>
                </div>
                <label>
                  {s.yourNotes}
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <label>
                  {s.docs}
                  <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} aria-label={s.addDocs} />
                </label>
                {files.length > 0 && (
                  <ul className="attachments">
                    {files.map((f) => (
                      <li key={f.name} className="chip">📎 {f.name} <span className="muted">({formatSize(f.size)})</span></li>
                    ))}
                  </ul>
                )}
                <button type="submit" className="send-button" disabled={busy}>
                  {busy ? s.sending : submitLabel}
                </button>
              </form>
            ) : (
              <p className="muted">{s.closed}</p>
            )}

            {data!.offers.length > 0 && (
              <section className="card">
                <h3>{s.history}</h3>
                <ul className="history">
                  {[...data!.offers].reverse().map((o) => {
                    const versions = [...o.versions].reverse();
                    const [latest, ...older] = versions;
                    return (
                      <li key={o.offer_no} className={o.offer_no === offerNo ? "offer-chosen" : undefined}>
                        <div className="offer-head">
                          <strong>{s.offer(o.offer_no)}</strong>
                          {rfq.open && o.offer_no !== offerNo && (
                            <button
                              type="button"
                              className="link-button"
                              onClick={() => {
                                chooseOffer(o.offer_no);
                                formRef.current?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              {s.updateThis}
                            </button>
                          )}
                        </div>
                        <OfferVersion v={latest} s={s} label={`v${latest.version} · ${s.current}`} />
                        {older.length > 0 && (
                          <details>
                            <summary className="muted small">{s.previous} ({older.length})</summary>
                            {older.map((v) => (
                              <OfferVersion key={v.version} v={v} s={s} label={`v${v.version}`} muted />
                            ))}
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function OfferVersion({ v, s, label, muted }: {
  v: CarrierOffer["versions"][number];
  s: (typeof t)[Lang];
  label: string;
  muted?: boolean;
}) {
  return (
    <div className={muted ? "offer-version muted" : "offer-version"}>
      <strong>{label}</strong> · {v.price} {v.currency} · {v.transit_days} {s.days}
      {v.valid_until && ` · ${s.valid}: ${v.valid_until}`}
      {v.notes && <div className="muted">{v.notes}</div>}
      {v.documents.map((d) => (
        <a key={d.url} className="chip" href={d.url}>📎 {d.name}</a>
      ))}
    </div>
  );
}
