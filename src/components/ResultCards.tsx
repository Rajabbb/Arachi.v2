import type { ResultCard } from "../../shared/protocol";

/** What the agent did, laid out from the real data so the user can check it (see server/agent/tools/toolCards.ts). */
export default function ResultCards({ cards }: { cards: ResultCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="result-cards">
      {cards.map((card, i) => (
        <section key={i} className={`result-card tone-${card.tone ?? "info"}`}>
          <h3 className="result-title">{card.title}</h3>
          {card.rows && card.rows.length > 0 && (
            <dl className="result-rows">
              {card.rows.map((r, j) => (
                <div key={j} className="result-row">
                  <dt>{r.label}</dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {card.items && card.items.length > 0 && (
            <ul className="result-items">
              {card.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          )}
          {card.note && <p className="result-note">{card.note}</p>}
        </section>
      ))}
    </div>
  );
}
