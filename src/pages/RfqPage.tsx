import { Fragment, useEffect, useState } from "react";
import type { RfqDetailData } from "../../shared/protocol";
import UserMenu from "../components/UserMenu";
import { getJson, money } from "../lib/api";
import type { User } from "../lib/auth";
import { offerTag } from "../lib/offers";

const channelLabels: Record<string, string> = {
  email: "E-poçt",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  link: "Link",
};

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const dateTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

/** One RFQ's page: its parameters, carriers and delivery, offers and their versions, the winner. */
export default function RfqPage({ user, id }: { user: User; id: number }) {
  const [data, setData] = useState<RfqDetailData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<RfqDetailData>(`/api/rfqs/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const rfq = data?.rfq;
  const winner = data?.offers.find((o) => o.winner);
  const details: [string, string][] = rfq
    ? [
        ["Yük", rfq.cargo_type],
        ["Çəki", `${rfq.weight_kg.toLocaleString("az-AZ")} kq`],
        ["Həcm", rfq.volume_m3 ? `${rfq.volume_m3} m³` : "—"],
        ["Palet", rfq.pallets ? String(rfq.pallets) : "—"],
        ["Nəqliyyat", rfq.transport_type],
        ["Yükləmə tarixi", rfq.loading_date || "çevik"],
        ["Çatdırılma tarixi", rfq.delivery_date || "çevik"],
        ["Valyuta", rfq.currency],
        ["Təklif son tarixi", rfq.offer_deadline],
        ["Yaradılıb", date(rfq.created_at)],
        ["Cavab verən daşıyıcılar", `${rfq.carriersResponded} / ${rfq.carriersSent}`],
        ["Ən yaxşı qiymət", rfq.bestPrice ? money(rfq.bestPrice.price, rfq.bestPrice.currency) : "—"],
      ]
    : [];

  return (
    <div className="page">
      <header className="header">
        <a className="logo" href="/">Arachi</a>
        <span className="badge">V2</span>
        <nav className="nav">
          <a href="/">Söhbət</a>
          <a href="/panel" aria-current="page">Panel</a>
        </nav>
        <UserMenu user={user} />
      </header>
      <main className="page-body">
        <a className="back-link" href="/panel">← Panelə qayıt</a>
        {error && <p className="error">Xəta: {error}</p>}
        {!data && !error && <p className="muted">Yüklənir...</p>}
        {data && rfq && (
          <>
            <div className="panel-head">
              <h1>
                RFQ #{rfq.id} · {rfq.origin} → {rfq.destination}
              </h1>
              <span className={`pill pill-${rfq.status}`}>{rfq.statusLabel}</span>
            </div>

            <dl className="details">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {rfq.notes && (
              <section className="card">
                <h3>Qeydlər</h3>
                <p className="pre">{rfq.notes}</p>
              </section>
            )}

            {winner && (
              <section className="card winner-card">
                <h3>Qalib</h3>
                <p>
                  <strong>{winner.carrier}</strong> · {money(winner.price, winner.currency)} · {winner.transit_days} gün
                  <span className="muted"> · {offerTag(winner)}</span>
                  {rfq.awarded_at && <span className="muted"> · seçilib {date(rfq.awarded_at)}</span>}
                </p>
              </section>
            )}

            <section className="card">
              <h3>Təkliflərin müqayisəsi</h3>
              {data.offers.length === 0 ? (
                <p className="muted">Hələ təklif yoxdur.</p>
              ) : (
                <>
                  {data.mixedCurrencies && (
                    <p className="muted small">
                      Təkliflər fərqli valyutalardadır: "ən ucuz" yalnız {rfq.currency} təklifləri arasında seçilib.
                    </p>
                  )}
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Daşıyıcı</th>
                          <th className="num">Qiymət</th>
                          <th className="num">Tranzit</th>
                          <th>Etibarlıdır</th>
                          <th>Qeydlər</th>
                          <th>Sənədlər</th>
                          <th>Tarix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.offers.map((o) => (
                          <Fragment key={o.id}>
                            <tr className={o.winner ? "row-winner" : undefined}>
                              <td>
                                {o.carrier} <span className="muted">{offerTag(o)}</span>
                                {o.winner && <span className="winner"> ✓ qalib</span>}
                              </td>
                              <td className="num">
                                {money(o.price, o.currency)}
                                {o.cheapest && <span className="tag tag-good">ən ucuz</span>}
                              </td>
                              <td className="num">
                                {o.transit_days} gün
                                {o.fastest && <span className="tag tag-good">ən sürətli</span>}
                              </td>
                              <td>
                                {o.valid_until || "—"}
                                {o.expired && <span className="tag tag-bad">vaxtı keçib</span>}
                              </td>
                              <td className="wrap">{o.notes || "—"}</td>
                              <td>
                                {o.documents.length === 0
                                  ? "—"
                                  : o.documents.map((d) => (
                                      <a key={d.url} className="chip download" href={d.url}>
                                        {d.name}
                                      </a>
                                    ))}
                              </td>
                              <td>{date(o.created_at)}</td>
                            </tr>
                            {o.previous.map((p) => (
                              <tr key={p.id} className="row-old">
                                <td>
                                  <span className="muted">↳ əvvəlki versiya v{p.version}</span>
                                </td>
                                <td className="num muted">{money(p.price, p.currency)}</td>
                                <td className="num muted">{p.transit_days} gün</td>
                                <td />
                                <td className="wrap muted">{p.notes || "—"}</td>
                                <td />
                                <td className="muted">{date(p.created_at)}</td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className="card">
              <h3>Daşıyıcılar və göndərmə statusu</h3>
              {data.carriers.length === 0 ? (
                <p className="muted">Sorğu hələ heç bir daşıyıcıya göndərilməyib.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Daşıyıcı</th>
                        <th>Kanal</th>
                        <th>Status</th>
                        <th>Göndərilib</th>
                        <th>Baxılıb</th>
                        <th>Xatırlatma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.carriers.map((c) => (
                        <tr key={c.carrier_id}>
                          <td>
                            <a href={`/panel/carrier/${c.carrier_id}`}>{c.name}</a>
                            {c.email && <div className="muted small">{c.email}</div>}
                          </td>
                          <td>{channelLabels[c.channel] ?? c.channel}</td>
                          <td className="wrap">
                            <span className={`pill pill-${c.status}`}>{c.statusLabel}</span>
                            {c.error && <div className="error small">{c.error}</div>}
                          </td>
                          <td>{dateTime(c.sent_at)}</td>
                          <td>{dateTime(c.viewed_at)}</td>
                          <td>
                            {c.reminder_count === 0
                              ? "—"
                              : `${c.reminder_count} dəfə, son: ${dateTime(c.last_reminder_at)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
