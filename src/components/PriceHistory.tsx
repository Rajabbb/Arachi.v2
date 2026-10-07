import { useState } from "react";
import type { CarrierDetailData } from "../../shared/protocol";
import { money } from "../lib/api";
import { LineChart } from "./Charts";

interface Quote {
  rfqId: number;
  label: string;
  version: number;
  price: number;
  date: string;
  time: number;
  winner: boolean;
}

interface Group {
  key: string;
  route: string;
  currency: string;
  quotes: Quote[];
}

/**
 * Every price the carrier quoted (all versions of all offers), grouped by
 * route and currency: USD and EUR are never on one line or one axis.
 */
function groupQuotes(rfqs: CarrierDetailData["rfqs"]): Group[] {
  const groups = new Map<string, Group>();
  for (const { rfq, offers } of rfqs) {
    const route = `${rfq.origin} → ${rfq.destination}`;
    for (const o of offers) {
      const tag = o.carrier_offers > 1 ? `təklif ${o.offer_no}` : "təklif";
      const versions = [
        { version: o.version, price: o.price, currency: o.currency, created_at: o.created_at, winner: o.winner },
        ...o.previous.map((p) => ({ ...p, winner: false })),
      ];
      for (const v of versions) {
        const key = `${route}|${v.currency}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { key, route, currency: v.currency, quotes: [] }));
        g.quotes.push({
          rfqId: rfq.id,
          label: `RFQ #${rfq.id} · ${tag}${o.version > 1 ? ` v${v.version}` : ""}`,
          version: v.version,
          price: v.price,
          date: v.created_at.slice(0, 10),
          time: Date.parse(v.created_at),
          winner: v.winner,
        });
      }
    }
  }
  for (const g of groups.values()) g.quotes.sort((a, b) => a.time - b.time);
  // Most quoted first; that one is shown by default.
  return [...groups.values()].sort((a, b) => b.quotes.length - a.quotes.length || a.key.localeCompare(b.key));
}

const dayMs = 86400_000;
const shortDate = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** The carrier's quoted prices over time, one route and currency at a time. */
export default function PriceHistory({ rfqs }: { rfqs: CarrierDetailData["rfqs"] }) {
  const groups = groupQuotes(rfqs);
  const [key, setKey] = useState(groups[0]?.key ?? "");
  const group = groups.find((g) => g.key === key) ?? groups[0];

  if (!group) {
    return (
      <section className="card">
        <h3>Qiymət tarixçəsi</h3>
        <p className="muted">Bu daşıyıcı hələ qiymət verməyib.</p>
      </section>
    );
  }

  const q = group.quotes;
  const prices = q.map((x) => x.price);
  const [first, last] = [q[0].time, q[q.length - 1].time];
  // A single day still gets some width, so the point sits in the middle.
  const [xMin, xMax] = last - first < dayMs ? [first - dayMs, last + dayMs] : [first, last];
  const ticks = [...new Map(q.map((x) => [x.date, { x: x.time, label: shortDate(x.time) }])).values()];
  const summary: [string, string][] = [
    ["Ən aşağı", money(Math.min(...prices), group.currency)],
    ["Ən yüksək", money(Math.max(...prices), group.currency)],
    ["Son qiymət", money(prices[prices.length - 1], group.currency)],
    ["Qiymət sayı", String(q.length)],
  ];

  return (
    <section className="card">
      <h3>Qiymət tarixçəsi</h3>
      {groups.length > 1 && (
        <div className="filters">
          <select value={group.key} onChange={(e) => setKey(e.target.value)} aria-label="Marşrut və valyuta">
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.route} · {g.currency} ({g.quotes.length})
              </option>
            ))}
          </select>
        </div>
      )}
      <p className="chart-note">
        {group.route}, {group.currency} ilə verilən bütün qiymətlər, yenilənmiş versiyalar daxil. Boş dairə qalib seçilmiş təklifdir.
      </p>
      <dl className="price-summary">
        {summary.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <LineChart
        points={q.map((x) => ({
          x: x.time,
          y: x.price,
          highlight: x.winner,
          tip: (
            <>
              <strong>{money(x.price, group.currency)}</strong>
              <div>{x.label}</div>
              <div className="muted">
                {x.date}
                {x.winner && " · qalib"}
              </div>
            </>
          ),
        }))}
        xMin={xMin}
        xMax={xMax}
        xTicks={ticks}
        color="var(--series-1)"
        zero={false}
        label={`${group.route} marşrutu üzrə ${group.currency} qiymətləri, tarixə görə`}
      />
      <details className="chart-table">
        <summary>Cədvəl kimi göstər</summary>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tarix</th>
                <th>Təklif</th>
                <th className="num">Qiymət</th>
              </tr>
            </thead>
            <tbody>
              {[...q].reverse().map((x) => (
                <tr key={`${x.label}-${x.time}`} className={x.winner ? "row-winner" : undefined}>
                  <td>{x.date}</td>
                  <td>
                    <a href={`/panel/rfq/${x.rfqId}`}>{x.label}</a>
                    {x.winner && <span className="winner"> ✓ qalib</span>}
                  </td>
                  <td className="num">{money(x.price, group.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
