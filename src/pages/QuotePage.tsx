import { useEffect, useState, type FormEvent } from "react";
import type { ChatError, QuotePageData, QuoteSubmission } from "../../shared/protocol";
import { formatSize, toUploadedFile } from "../lib/agent";

type Lang = "az" | "en";

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
    revise: "Yeni versiya göndər",
    sending: "Göndərilir...",
    sent: "Təklifiniz qəbul edildi. Təşəkkür edirik!",
    closed: "Bu sorğu üzrə təkliflər artıq qəbul edilmir.",
    history: "Göndərdiyiniz təkliflər",
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
    revise: "Send a new version",
    sending: "Sending...",
    sent: "Your offer has been received. Thank you!",
    closed: "This request is no longer accepting offers.",
    history: "Your offers",
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
  const [done, setDone] = useState(false);
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
      });
      setData(d);
      setDone(true);
      setFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const rfq = data?.rfq;
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

            {done && <p className="success">{s.sent}</p>}

            {rfq.open ? (
              <form className="card form" onSubmit={submit}>
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
                  {busy ? s.sending : data!.offers.length ? s.revise : s.submit}
                </button>
              </form>
            ) : (
              <p className="muted">{s.closed}</p>
            )}

            {data!.offers.length > 0 && (
              <section className="card">
                <h3>{s.history}</h3>
                <ul className="history">
                  {[...data!.offers].reverse().map((o) => (
                    <li key={o.version}>
                      <strong>v{o.version}</strong> · {o.price} {o.currency} · {o.transit_days} {s.days}
                      {o.valid_until && ` · ${s.valid}: ${o.valid_until}`}
                      {o.notes && <div className="muted">{o.notes}</div>}
                      {o.documents.map((d) => (
                        <a key={d.url} className="chip" href={d.url}>📎 {d.name}</a>
                      ))}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
