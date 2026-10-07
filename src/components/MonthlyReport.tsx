import { useEffect, useState } from "react";
import type { MonthlyReportData } from "../../shared/protocol";
import { getJson, money } from "../lib/api";
import { longMonth, recentMonths } from "../lib/months";

const months = recentMonths(24);

function initialMonth(): string {
  const m = new URLSearchParams(window.location.search).get("month");
  return m && months.includes(m) ? m : months[0];
}

const date = (iso: string) => iso.slice(0, 10);

/** One month on screen: totals, the RFQs made that month, and how each carrier answered. */
export default function MonthlyReport({ refresh }: { refresh: number }) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<MonthlyReportData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("month", month);
    history.replaceState(null, "", `/panel?${params}`);
  }, [month]);

  useEffect(() => {
    getJson<MonthlyReportData>(`/api/report?month=${month}`)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [month, refresh]);

  const tiles: [string, string, string?][] = data
    ? [
        ["Yeni sorğular", String(data.rfqsCreated)],
        ["Alınan təkliflər", String(data.offersReceived)],
        ["Cavab nisbəti", data.responseRate === null ? "—" : `${data.responseRate}%`, `${data.offered} / ${data.sent} daşıyıcı`],
        ["Qalib seçilib", String(data.awarded)],
        [
          "Sifariş dəyəri",
          data.awardedValue.length ? data.awardedValue.map((v) => money(v.total, v.currency)).join(" · ") : "—",
          "daşıyıcı qiyməti",
        ],
      ]
    : [];

  return (
    <section className="card report">
      <div className="report-head">
        <h3>Aylıq hesabat</h3>
        <div className="report-month">
          <button type="button" className="icon-button" aria-label="Əvvəlki ay" disabled={month === months[months.length - 1]}
            onClick={() => setMonth(months[months.indexOf(month) + 1])}>
            ‹
          </button>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Ay">
            {months.map((m) => (
              <option key={m} value={m}>
                {longMonth(m)}
              </option>
            ))}
          </select>
          <button type="button" className="icon-button" aria-label="Növbəti ay" disabled={month === months[0]}
            onClick={() => setMonth(months[months.indexOf(month) - 1])}>
            ›
          </button>
        </div>
      </div>
      {error && <p className="error">Xəta: {error}</p>}
      {!data && !error && <p className="muted">Yüklənir...</p>}
      {data && data.month === month && (
        <>
          <div className="tiles report-tiles">
            {tiles.map(([label, value, hint]) => (
              <div key={label} className="tile">
                <div className="tile-label">{label}</div>
                <div className="tile-value">{value}</div>
                {hint && <div className="tile-hint">{hint}</div>}
              </div>
            ))}
          </div>

          <h4>Bu ay yaradılan sorğular</h4>
          {data.rfqs.length === 0 ? (
            <p className="muted">{longMonth(month)} ayında sorğu yaradılmayıb.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>RFQ</th>
                    <th>Marşrut</th>
                    <th>Yük</th>
                    <th>Status</th>
                    <th className="num">Cavab</th>
                    <th className="num">Ən yaxşı qiymət</th>
                    <th>Qalib</th>
                    <th>Tarix</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rfqs.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <a href={`/panel/rfq/${r.id}`}>#{r.id}</a>
                      </td>
                      <td>
                        {r.origin} → {r.destination}
                      </td>
                      <td>
                        {r.cargo_type}, {r.weight_kg.toLocaleString("az-AZ")} kq
                      </td>
                      <td>
                        <span className={`pill pill-${r.status}`}>{r.statusLabel}</span>
                      </td>
                      <td className="num">
                        {r.carriersResponded} / {r.carriersSent}
                      </td>
                      <td className="num">{r.bestPrice ? money(r.bestPrice.price, r.bestPrice.currency) : "—"}</td>
                      <td>{r.winner ? `${r.winner.carrier} · ${money(r.winner.price, r.winner.currency)}` : "—"}</td>
                      <td>{date(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>Daşıyıcılar bu ay</h4>
          {data.carriers.length === 0 ? (
            <p className="muted">Bu ay heç bir daşıyıcıya sorğu göndərilməyib.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Daşıyıcı</th>
                    <th className="num">Sorğu göndərilib</th>
                    <th className="num">Təklif verib</th>
                    <th className="num">Cavab nisbəti</th>
                    <th className="num">Qalib</th>
                  </tr>
                </thead>
                <tbody>
                  {data.carriers.map((c) => (
                    <tr key={c.carrier_id}>
                      <td>
                        <a href={`/panel/carrier/${c.carrier_id}`}>{c.name}</a>
                      </td>
                      <td className="num">{c.sent}</td>
                      <td className="num">{c.offered}</td>
                      <td className="num">{c.responseRate === null ? "—" : `${c.responseRate}%`}</td>
                      <td className="num">{c.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Aylar Bakı vaxtı ilə hesablanır. Sifariş dəyəri valyutalar üzrə ayrıca göstərilir.</p>
        </>
      )}
    </section>
  );
}
