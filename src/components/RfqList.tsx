import { useEffect, useState } from "react";
import type { RfqListItem, RfqListData } from "../../shared/protocol";
import { getJson, money } from "../lib/api";

/** The panel's list of all the user's RFQs; each row opens the RFQ's own page. */
export default function RfqList() {
  const [rfqs, setRfqs] = useState<RfqListItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<RfqListData>("/api/rfqs")
      .then((d) => setRfqs(d.rfqs))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
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
  );
}
