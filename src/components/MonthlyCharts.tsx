import type { MonthlyPoint } from "../../shared/protocol";
import { longMonth, shortMonth } from "../lib/months";
import { ColumnChart, Legend, LineChart } from "./Charts";

const percent = (n: number) => `${n.toLocaleString("az-AZ")}%`;

/** The panel's charts: RFQs and offers per month, and the carrier response rate per month. */
export default function MonthlyCharts({ months }: { months: MonthlyPoint[] }) {
  const labels = months.map((m) => shortMonth(m.month));
  const series = [
    { name: "Sorğular (RFQ)", color: "var(--series-1)", values: months.map((m) => m.rfqs) },
    { name: "Alınan təkliflər", color: "var(--series-2)", values: months.map((m) => m.offers) },
  ];
  const empty = months.every((m) => !m.rfqs && !m.offers && !m.sent);

  return (
    <section className="card">
      <h3>Son 12 ay</h3>
      {empty ? (
        <p className="muted">Son 12 ayda hələ sorğu və təklif yoxdur.</p>
      ) : (
        <div className="charts">
          <figure className="chart-figure">
            <figcaption>Sorğular və təkliflər, aylar üzrə</figcaption>
            <Legend items={series} />
            <ColumnChart
              labels={labels}
              tipLabels={months.map((m) => longMonth(m.month))}
              series={series}
              label="Son 12 ayda aylar üzrə yaradılan sorğular və alınan təkliflər"
            />
          </figure>
          <figure className="chart-figure">
            <figcaption>Daşıyıcı cavab nisbəti</figcaption>
            <p className="chart-note">Həmin ay sorğu göndərilən daşıyıcılardan neçə faizi təklif verib.</p>
            <LineChart
              points={months.map((m, i) =>
                m.responseRate === null
                  ? { x: i, y: null }
                  : {
                      x: i,
                      y: m.responseRate,
                      tip: (
                        <>
                          <strong>{longMonth(m.month)}</strong>
                          <div>
                            Cavab nisbəti: <b>{percent(m.responseRate)}</b>
                          </div>
                          <div className="muted">
                            {m.offered} / {m.sent} daşıyıcı təklif verib
                          </div>
                        </>
                      ),
                    },
              )}
              xMin={0}
              xMax={months.length - 1}
              xTicks={labels.map((label, i) => ({ x: i, label }))}
              color="var(--series-1)"
              format={percent}
              label="Son 12 ayda aylar üzrə daşıyıcı cavab nisbəti, faizlə"
            />
          </figure>
        </div>
      )}
      {!empty && (
        <details className="chart-table">
          <summary>Cədvəl kimi göstər</summary>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ay</th>
                  <th className="num">Sorğular</th>
                  <th className="num">Təkliflər</th>
                  <th className="num">Göndərilib</th>
                  <th className="num">Cavab nisbəti</th>
                  <th className="num">Qalib seçilib</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month}>
                    <td>{longMonth(m.month)}</td>
                    <td className="num">{m.rfqs}</td>
                    <td className="num">{m.offers}</td>
                    <td className="num">{m.sent}</td>
                    <td className="num">{m.responseRate === null ? "—" : percent(m.responseRate)}</td>
                    <td className="num">{m.awarded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
