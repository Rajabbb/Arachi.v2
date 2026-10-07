import { useEffect, useState } from "react";
import type { CarrierListData, CarrierListItem } from "../../shared/protocol";
import { getJson, money } from "../lib/api";

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** "Avto Trans a@x.az Quru Türkiyə xətti" in lower case, for the search box. */
const searchText = (c: CarrierListItem) =>
  [c.name, c.email ?? "", c.category, c.subcategory].join(" ").toLocaleLowerCase("az");

const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "az"));

/**
 * The panel's carrier base: every carrier with how it answers the user's
 * RFQs. View only; carriers are added and edited in the chat.
 */
export default function CarrierList() {
  const [carriers, setCarriers] = useState<CarrierListItem[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");

  useEffect(() => {
    getJson<CarrierListData>("/api/carriers")
      .then((d) => setCarriers(d.carriers))
      .catch((e: Error) => setError(e.message));
  }, []);

  const all = carriers ?? [];
  const categories = unique(all.map((c) => c.category));
  const subcategories = unique(all.filter((c) => !category || c.category === category).map((c) => c.subcategory));
  const q = query.trim().toLocaleLowerCase("az");
  const shown = all.filter(
    (c) =>
      (!category || c.category === category) &&
      (!subcategory || c.subcategory === subcategory) &&
      (!q || searchText(c).includes(q)),
  );

  return (
    <section className="card">
      <h3>Daşıyıcı bazası</h3>
      {error && <p className="error" role="alert">Xəta: {error}</p>}
      {!carriers && !error && <p className="loading" role="status">Yüklənir...</p>}
      {carriers && carriers.length === 0 && (
        <p className="empty">Hələ daşıyıcı yoxdur. Söhbətdə daşıyıcı əlavə edin və ya Excel faylı yükləyin.</p>
      )}
      {carriers && carriers.length > 0 && (
        <>
          <div className="filters">
            <input
              type="search"
              placeholder="Ad, email və ya kateqoriya üzrə axtar"
              aria-label="Daşıyıcı axtar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Kateqoriya"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setSubcategory("");
              }}
            >
              <option value="">Bütün kateqoriyalar</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {subcategories.length > 0 && (
              <select aria-label="Alt kateqoriya" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
                <option value="">Bütün istiqamətlər</option>
                {subcategories.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>
          <p className="muted small">
            {shown.length} / {carriers.length} daşıyıcı · {carriers.filter((c) => c.active).length} aktiv. Daşıyıcı
            əlavə etmək və ya dəyişmək üçün söhbətdə yazın.
          </p>
          {shown.length === 0 ? (
            <p className="empty">Axtarışa uyğun daşıyıcı tapılmadı.</p>
          ) : (
            <div className="table-wrap">
              <table className="table rows-link">
                <thead>
                  <tr>
                    <th>Daşıyıcı</th>
                    <th>Kateqoriya</th>
                    <th className="num" title="Sorğu göndərilib">Sorğu</th>
                    <th className="num" title="Təklif verdiyi sorğular / göndərilən sorğular">Cavab</th>
                    <th className="num" title="Qalib seçilən sorğular">Qalib</th>
                    <th className="num">Son təklif</th>
                    <th>Son fəaliyyət</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id} onClick={() => (window.location.href = `/panel/carrier/${c.id}`)}>
                      <td>
                        <a href={`/panel/carrier/${c.id}`}>{c.name}</a>
                        {!c.active && <span className="pill pill-inactive">deaktiv</span>}
                        {c.failedDeliveries > 0 && (
                          <span className="tag tag-bad" title="Çatdırılmayan göndərişlər">{c.failedDeliveries} çatmayıb</span>
                        )}
                        {c.email && <div className="muted small">{c.email}</div>}
                      </td>
                      <td>
                        {c.category}
                        {c.subcategory && <div className="muted small">{c.subcategory}</div>}
                      </td>
                      <td className="num">{c.rfqsSent}</td>
                      <td className="num">
                        {c.rfqsAnswered} / {c.rfqsSent}
                        {c.responseRate !== null && <div className="muted small">{c.responseRate}%</div>}
                      </td>
                      <td className="num">{c.rfqsWon || "—"}</td>
                      <td className="num">
                        {c.lastOffer ? (
                          <>
                            {money(c.lastOffer.price, c.lastOffer.currency)}
                            <div className="muted small">RFQ #{c.lastOffer.rfq_id} · {c.lastOffer.transit_days} gün</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{date(c.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
