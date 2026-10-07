import { useEffect, useState } from "react";
import type { CarrierDetailData } from "../../shared/protocol";
import UserMenu from "../components/UserMenu";
import { getJson, money } from "../lib/api";
import type { User } from "../lib/auth";
import { offerTag } from "../lib/offers";
import PriceHistory from "../components/PriceHistory";

const channelLabels: Record<string, string> = {
  email: "E-poçt",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  link: "Link",
};

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const dateTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

/** One carrier's page: contacts, numbers and every RFQ it was sent, with delivery and its offers. */
export default function CarrierPage({ user, id }: { user: User; id: number }) {
  const [data, setData] = useState<CarrierDetailData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<CarrierDetailData>(`/api/carriers/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const c = data?.carrier;
  const details: [string, string][] = c
    ? [
        ["Email", c.email || "—"],
        ["Telefon", c.phone || "—"],
        ["WhatsApp", c.whatsapp || "—"],
        ["Telegram", c.telegram || "—"],
        ["Kateqoriya", c.subcategory ? `${c.category} · ${c.subcategory}` : c.category],
        ["Dil", c.language === "en" ? "İngilis" : "Azərbaycan"],
        ["Sorğu göndərilib", String(c.rfqsSent)],
        ["Cavab verib", c.responseRate === null ? `${c.rfqsAnswered}` : `${c.rfqsAnswered} / ${c.rfqsSent} (${c.responseRate}%)`],
        ["Qalib seçilib", String(c.rfqsWon)],
        ["Çatdırılmayan", String(c.failedDeliveries)],
        ["Son fəaliyyət", date(c.lastActivity)],
        ["Bazaya əlavə edilib", date(c.created_at)],
      ]
    : [];

  return (
    <div className="page page-wide">
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
        <a className="back-link" href="/panel?tab=carriers">← Daşıyıcı bazasına qayıt</a>
        {error && <p className="error" role="alert">Xəta: {error}</p>}
        {!data && !error && <p className="loading" role="status">Yüklənir...</p>}
        {data && c && (
          <>
            <div className="panel-head">
              <h1>{c.name}</h1>
              <span className={`pill ${c.active ? "pill-offered" : "pill-inactive"}`}>{c.active ? "aktiv" : "deaktiv"}</span>
            </div>

            <dl className="details">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <PriceHistory rfqs={data.rfqs} />

            <section className="card">
              <h3>Sorğu tarixçəsi</h3>
              {data.rfqs.length === 0 ? (
                <p className="empty">Bu daşıyıcıya hələ sorğu göndərilməyib.</p>
              ) : (
                <div className="carrier-rfqs">
                  {data.rfqs.map(({ rfq, dispatch, offers }) => (
                    <div key={rfq.id} className={`carrier-rfq${offers.some((o) => o.winner) ? " row-winner" : ""}`}>
                      <div className="offer-group-head">
                        <a href={`/panel/rfq/${rfq.id}`}>
                          RFQ #{rfq.id} · {rfq.origin} → {rfq.destination}
                        </a>
                        <span className={`pill pill-${rfq.status}`}>{rfq.statusLabel}</span>
                        <span className="muted small">
                          {rfq.cargo_type}, {rfq.weight_kg.toLocaleString("az-AZ")} kq · {date(rfq.created_at)}
                        </span>
                      </div>
                      {dispatch ? (
                        <p className="small carrier-rfq-status">
                          <span className={`pill pill-${dispatch.status}`}>{dispatch.statusLabel}</span>{" "}
                          <span className="muted">
                            {channelLabels[dispatch.channel] ?? dispatch.channel} · göndərilib {dateTime(dispatch.sent_at)}
                            {dispatch.viewed_at && ` · baxılıb ${dateTime(dispatch.viewed_at)}`}
                            {dispatch.reminder_count > 0 && ` · ${dispatch.reminder_count} xatırlatma`}
                          </span>
                          {dispatch.error && <span className="error small"> · {dispatch.error}</span>}
                        </p>
                      ) : (
                        <p className="muted small carrier-rfq-status">Təklif əl ilə daxil edilib.</p>
                      )}
                      {offers.length === 0 ? (
                        <p className="muted small carrier-rfq-status">Təklif verməyib.</p>
                      ) : (
                        <div className="table-wrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Təklif</th>
                                <th className="num">Qiymət</th>
                                <th className="num">Tranzit</th>
                                <th>Etibarlıdır</th>
                                <th>Tarix</th>
                              </tr>
                            </thead>
                            <tbody>
                              {offers.flatMap((o) => [
                                <tr key={o.id} className={o.winner ? "row-winner" : undefined}>
                                  <td>
                                    {offerTag(o)}
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
                                  <td>{date(o.created_at)}</td>
                                </tr>,
                                ...o.previous.map((p) => (
                                  <tr key={p.id} className="row-old">
                                    <td>
                                      <span className="muted">↳ əvvəlki versiya v{p.version}</span>
                                    </td>
                                    <td className="num muted">{money(p.price, p.currency)}</td>
                                    <td className="num muted">{p.transit_days} gün</td>
                                    <td />
                                    <td className="muted">{date(p.created_at)}</td>
                                  </tr>
                                )),
                              ])}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
