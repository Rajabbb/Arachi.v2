import { useEffect, useState } from "react";
import type { ChatError, DashboardData } from "../../shared/protocol";
import UserMenu from "../components/UserMenu";
import type { User } from "../lib/auth";
import RfqList from "../components/RfqList";
import CarrierList from "../components/CarrierList";
import MonthlyCharts from "../components/MonthlyCharts";
import MonthlyReport from "../components/MonthlyReport";
import { offerTag } from "../lib/offers";
import { useRefresh } from "../lib/useRefresh";

const periods = [7, 30, 90, 365];

function initialDays(): number {
  const d = Number(new URLSearchParams(window.location.search).get("days"));
  return periods.includes(d) ? d : 30;
}

const tabs = [
  ["rfqs", "Sorğular"],
  ["carriers", "Daşıyıcılar"],
  ["report", "Aylıq hesabat"],
] as const;

type Tab = (typeof tabs)[number][0];

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get("tab");
  return tabs.find(([key]) => key === t)?.[0] ?? "rfqs";
}

function money(total: number, currency: string): string {
  return `${total.toLocaleString("az-AZ", { maximumFractionDigits: 0 })} ${currency}`;
}

/** Analytics panel: the same numbers the get_dashboard tool reports. */
export default function PanelPage({ user }: { user: User }) {
  const [days, setDays] = useState(initialDays);
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const refresh = useRefresh();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("days", String(days));
    if (tab === "rfqs") params.delete("tab");
    else params.set("tab", tab);
    // The report keeps its month in the address too, so a reload stays on it.
    if (tab !== "report") params.delete("month");
    history.replaceState(null, "", `/panel?${params}`);
  }, [days, tab]);

  useEffect(() => {
    fetch(`/api/dashboard?days=${days}`)
      .then(async (res) => {
        // Session expired: back to the login screen.
        if (res.status === 401) window.location.reload();
        const body = (await res.json().catch(() => null)) as DashboardData | ChatError | null;
        if (!res.ok || !body || "error" in body) throw new Error(body && "error" in body ? body.error : "Serverlə əlaqə qurulmadı.");
        setData(body);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, [days, refresh]);

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
        {error && <p className="error" role="alert">Xəta: {error}</p>}
        {!data && !error && <p className="loading" role="status">Yüklənir...</p>}
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

            <MonthlyCharts months={data.monthly} />

            <div className="lang-switch panel-tabs" role="tablist" aria-label="Bölmə">
              {tabs.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "rfqs" && <RfqList />}
            {tab === "carriers" && <CarrierList />}
            {tab === "report" && <MonthlyReport refresh={refresh} />}

            <section className="card">
              <h3>Göndərmə statusları · son {data.periodDays} gün</h3>
              <p className="muted">Hər mərhələ sonrakıları da sayır: təklif göndərən daşıyıcı həm də baxıb, çatdırılıb və göndərilib.</p>
              <ul className="meters">
                {data.statuses.map((s) => (
                  <li key={s.status} className={`meter-${s.status}`}>
                    <span className="meter-label">{s.label}</span>
                    <span className="meter-track" aria-hidden="true">
                      <span className="meter-fill" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                    </span>
                    <span className="meter-value">{s.count}</span>
                  </li>
                ))}
              </ul>
            </section>

            {data.failedDeliveries.length > 0 && (
              <section className="card">
                <h3>Çatdırılmayan göndərişlər</h3>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>RFQ</th>
                        <th>Daşıyıcı</th>
                        <th>Kanal</th>
                        <th>Səbəb</th>
                        <th>Tarix</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.failedDeliveries.map((f) => (
                        <tr key={`${f.rfq_id}-${f.carrier}`}>
                          <td>#{f.rfq_id}</td>
                          <td>{f.carrier}</td>
                          <td>{f.channel}</td>
                          <td>{f.error ?? "—"}</td>
                          <td>{f.sent_at.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="card">
              <h3>Son təkliflər</h3>
              {data.recentOffers.length === 0 ? (
                <p className="empty">Hələ təklif yoxdur.</p>
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
                          <td>
                            <a href={`/panel/rfq/${o.rfq_id}`}>#{o.rfq_id}</a>
                          </td>
                          <td>{o.origin} → {o.destination}</td>
                          <td>
                            {o.carrier} <span className="muted">{offerTag(o)}</span>
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
