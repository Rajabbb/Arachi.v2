import { useEffect, useState } from "react";
import type { RfqListItem, RfqListData } from "../../shared/protocol";
import { getJson, money } from "../lib/api";
import { offerTag } from "../lib/offers";

/**
 * The panel's list of all the user's RFQs (each row opens the RFQ's own
 * page), and the offers received grouped by RFQ.
 */
export default function RfqList() {
  const [rfqs, setRfqs] = useState<RfqListItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<RfqListData>("/api/rfqs")
      .then((d) => setRfqs(d.rfqs))
      .catch((e: Error) => setError(e.message));
  }, []);

  const withOffers = rfqs?.filter((r) => r.offers.length > 0) ?? [];

  return (
    <>
      <section className="card">
        <h3>Sorğular</h3>
        {error && <p className="error">Xəta: {error}</p>}
        {!rfqs && !error && <p className="muted">Yüklənir...</p>}
        {rfqs && rfqs.length === 0 && <p className="muted">Hələ sorğu yoxdur. Söhbətdə yeni sorğu yaradın.</p>}
        {rfqs && rfqs.length > 0 && (
          <div className="table-wrap">
            <table className="table rows-link">
              <thead>
                <tr>
                  <th>RFQ</th>
                  <th>Marşrut</th>
                  <th>Status</th>
                  <th className="num" title="Təklif göndərən / sorğu göndərilən daşıyıcılar">Cavab</th>
                  <th className="num">Ən yaxşı qiymət</th>
                  <th>Son tarix</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.map((r) => (
                  <tr key={r.id} onClick={() => (window.location.href = `/panel/rfq/${r.id}`)}>
                    <td>
                      <a href={`/panel/rfq/${r.id}`}>#{r.id}</a>
                    </td>
                    <td>
                      {r.origin} → {r.destination}
                      <div className="muted small">{r.cargo_type}, {r.weight_kg.toLocaleString("az-AZ")} kq</div>
                    </td>
                    <td>
                      <span className={`pill pill-${r.status}`}>{r.statusLabel}</span>
                    </td>
                    <td className="num">
                      {r.carriersResponded} / {r.carriersSent}
                    </td>
                    <td className="num">{r.bestPrice ? money(r.bestPrice.price, r.bestPrice.currency) : "—"}</td>
                    <td>{r.offer_deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rfqs && (
        <section className="card">
          <h3>Təkliflər sorğular üzrə</h3>
          {withOffers.length === 0 ? (
            <p className="muted">Hələ təklif yoxdur.</p>
          ) : (
            <div className="offer-groups">
              {withOffers.map((r) => (
                <div key={r.id} className="offer-group">
                  <div className="offer-group-head">
                    <a href={`/panel/rfq/${r.id}`}>
                      RFQ #{r.id} · {r.origin} → {r.destination}
                    </a>
                    <span className={`pill pill-${r.status}`}>{r.statusLabel}</span>
                    <span className="muted small">
                      {r.offers.length} təklif ({r.carriersResponded} daşıyıcıdan) · {r.carriersSent} daşıyıcıya göndərilib
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Daşıyıcı</th>
                          <th className="num">Qiymət</th>
                          <th className="num">Tranzit</th>
                          <th>Etibarlıdır</th>
                          <th>Tarix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.offers.map((o) => (
                          <tr key={o.id} className={o.winner ? "row-winner" : undefined}>
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
                            <td>{o.created_at.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
