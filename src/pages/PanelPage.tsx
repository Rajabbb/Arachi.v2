import { useEffect, useState } from "react";
import type { ChatError, DashboardData } from "../../shared/protocol";

const periods = [7, 30, 90, 365];

function initialDays(): number {
  const d = Number(new URLSearchParams(window.location.search).get("days"));
  return periods.includes(d) ? d : 30;
}

function money(total: number, currency: string): string {
  return `${total.toLocaleString("az-AZ", { maximumFractionDigits: 0 })} ${currency}`;
}

/** Analytics panel: the same numbers the get_dashboard tool reports. */
export default function PanelPage() {
  const [days, setDays] = useState(initialDays);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    history.replaceState(null, "", `/panel?days=${days}`);
    fetch(`/api/dashboard?days=${days}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as DashboardData | ChatError | null;
        if (!res.ok || !body || "error" in body) throw new Error(body && "error" in body ? body.error : "Serverlə əlaqə qurulmadı.");
        setData(body);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [days]);

  const maxStatus = Math.max(1, ...(data?.statuses.map((s) => s.count) ?? [1]));
  const tiles: [string, string, string?][] = data
    ? [
        ["Aktiv RFQ-lər", String(data.activeRfqs), "təklif toplanır"],
        ["Tamamlanmış daşımalar", String(data.awardedRfqs), "qalib seçilib"],
        ["Daşıyıcılar", String(data.carriers), "aktiv bazada"],
        ["Alınan təkliflər", String(data.offersReceived), `son ${data.periodDays} gün`],
        ["Cavab nisbəti", data.responseRate === null ? "—" : `${data.responseRate}%`, "təklif göndərən daşıyıcılar"],
        [
          "Sifariş dəyəri",
          data.awardedValue.length ? data.awardedValue.map((v) => money(v.total, v.currency)).join(" · ") : "—",
          `son ${data.periodDays} gün, daşıyıcı qiyməti`,
        ],
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
      </header>
      <main className="page-body">
        <div className="panel-head">
          <h1>Analitika paneli</h1>
          <div className="lang-switch" role="group" aria-label="Dövr">
            {periods.map((d) => (
              <button key={d} type="button" className={d === days ? "active" : ""} onClick={() => setDays(d)}>
                {d} gün
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error">Xəta: {error}</p>}
        {!data && !error && <p className="muted">Yüklənir...</p>}
        {data && (
          <>
            <div className="tiles">
              {tiles.map(([label, value, hint]) => (
                <div key={label} className="tile">
                  <div className="tile-label">{label}</div>
                  <div className="tile-value">{value}</div>
                  {hint && <div className="tile-hint">{hint}</div>}
                </div>
              ))}
            </div>

            <section className="card">
              <h3>Göndərmə statusları · son {data.periodDays} gün</h3>
              <ul className="meters">
                {data.statuses.map((s) => (
                  <li key={s.status}>
                    <span className="meter-label">{s.label}</span>
                    <span className="meter-track" aria-hidden="true">
                      <span className="meter-fill" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                    </span>
                    <span className="meter-value">{s.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card">
              <h3>Son təkliflər</h3>
              {data.recentOffers.length === 0 ? (
                <p className="muted">Hələ təklif yoxdur.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>RFQ</th>
                        <th>Marşrut</th>
                        <th>Daşıyıcı</th>
                        <th className="num">Qiymət</th>
                        <th className="num">Tranzit</th>
                        <th>Tarix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOffers.map((o) => (
                        <tr key={o.id}>
                          <td>#{o.rfq_id}</td>
                          <td>{o.origin} → {o.destination}</td>
                          <td>
                            {o.carrier} <span className="muted">v{o.version}</span>
                            {o.winner && <span className="winner"> ✓ qalib</span>}
                          </td>
                          <td className="num">{o.price.toLocaleString("az-AZ")} {o.currency}</td>
                          <td className="num">{o.transit_days} gün</td>
                          <td>{o.created_at.slice(0, 10)}</td>
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
