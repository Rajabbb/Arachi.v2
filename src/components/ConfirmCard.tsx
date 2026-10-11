import { useState } from "react";
import type { ConfirmAnswer, Confirmation } from "../../shared/protocol";

const statusText: Record<Confirmation["status"], string> = {
  pending: "",
  running: "İcra olunur…",
  done: "✓ Təsdiqləndi və göndərildi",
  failed: "⚠ Təsdiqləndi, amma alınmadı",
  declined: "Xeyr: heç nə göndərilmədi",
  expired: "Təsdiq vaxtı keçib, heç nə göndərilmədi",
};

/** The button and status words for what the prepared action does (send is the default). */
function wording(tool?: string, picker = false) {
  if (tool === "create_rfq" && picker) {
    return { yes: "", busy: "Yaradılır…", done: "✓ Yaradıldı (nəticə aşağıdadır)", declined: "Ləğv edildi: RFQ yaradılmadı" };
  }
  if (tool === "create_rfq") return { yes: "Bəli, yarat", busy: "Yaradılır…", done: "✓ Təsdiqləndi və yaradıldı", declined: "Xeyr: heç nə yaradılmadı" };
  if (tool === "remove_carriers") return { yes: "Bəli, sil", busy: "Silinir…", done: "✓ Təsdiqləndi və silindi", declined: "Xeyr: heç nə silinmədi" };
  return { yes: "Bəli, göndər", busy: "Göndərilir…", done: statusText.done, declined: statusText.declined };
}

interface Props {
  confirmation: Confirmation;
  /** Sends the answer; resolves when the server has handled it. */
  onAnswer: (approve: boolean, answer?: ConfirmAnswer) => Promise<void>;
}

/**
 * An action the agent prepared. It runs only when the user presses a button;
 * the text comes from the server and lists exactly what will happen. A new RFQ
 * also shows the carrier base: the user ticks who gets it, and only those
 * carriers are emailed.
 */
export default function ConfirmCard({ confirmation, onAnswer }: Props) {
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [linkOnly, setLinkOnly] = useState(false);
  const [attach, setAttach] = useState<number | null>(null);

  async function answer(approve: boolean, choice?: ConfirmAnswer) {
    setBusy(true);
    setCancelling(!approve);
    setError("");
    try {
      await onAnswer(approve, choice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Alınmadı.");
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }

  const pending = confirmation.status === "pending";
  const choices = confirmation.choices;
  const words = wording(confirmation.tool, Boolean(choices));
  const status = confirmation.status === "done" ? words.done : confirmation.status === "declined" ? words.declined : statusText[confirmation.status];

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleCategory(ids: number[]) {
    setSelected((prev) => (ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  }

  const files = confirmation.files ?? [];
  const attachBox =
    pending && files.length > 0 ? (
      <div className="attach-choice">
        {files.length === 1 ? (
          <label className="picker-row">
            <input type="checkbox" disabled={busy} checked={attach === 0} onChange={(e) => setAttach(e.target.checked ? 0 : null)} />
            <span>
              Fayl daşıyıcılara görünsün <span className="muted">· {files[0].name}</span>
            </span>
          </label>
        ) : (
          <label className="picker-row">
            <span>Fayl daşıyıcılara görünsün:</span>
            <select disabled={busy} value={attach ?? ""} onChange={(e) => setAttach(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Heç biri</option>
              {files.map((f, i) => (
                <option key={f.name + i} value={i}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="muted attach-hint">Seçilərsə, daşıyıcı səhifəsində «Sənədə Bax» düyməsi görünəcək. Faylda daxili qiymət və ya şərh varsa, seçməyin.</p>
      </div>
    ) : null;

  if (pending && choices) {
    const pickDisabled = busy || linkOnly;
    return (
      <div className={`confirm-card ${confirmation.status}`}>
        <p className="confirm-text">{confirmation.text}</p>
        <div className="carrier-picker">
          <p className="picker-title">Kimə göndərək?</p>
          {choices.categories.length > 0 && (
            <>
              <p className="picker-label">Kateqoriyalar</p>
              {choices.categories.map((cat) => (
                <label key={cat.name} className="picker-row">
                  <input
                    type="checkbox"
                    disabled={pickDisabled}
                    checked={cat.carrierIds.every((id) => selected.includes(id))}
                    onChange={() => toggleCategory(cat.carrierIds)}
                  />
                  <span>
                    {cat.name} <span className="muted">({cat.carrierIds.length} daşıyıcı)</span>
                  </span>
                </label>
              ))}
            </>
          )}
          <p className="picker-label">Daşıyıcılar</p>
          {choices.carriers.map((c) => (
            <label key={c.id} className="picker-row">
              <input type="checkbox" disabled={pickDisabled} checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
              <span>
                {c.name} <span className="muted">· {c.email}</span>
              </span>
            </label>
          ))}
          <p className="picker-bulk">
            <button type="button" className="link-button" disabled={pickDisabled} onClick={() => setSelected(choices.carriers.map((c) => c.id))}>
              Hamısını seç
            </button>
            {" · "}
            <button type="button" className="link-button" disabled={pickDisabled} onClick={() => setSelected([])}>
              Təmizlə
            </button>
          </p>
          <p className="picker-label">Digər</p>
          <label className="picker-row">
            <input
              type="checkbox"
              disabled={busy}
              checked={linkOnly}
              onChange={(e) => {
                setLinkOnly(e.target.checked);
                if (e.target.checked) setSelected([]);
              }}
            />
            <span>Heç kimə göndərmə, yalnız link yarat</span>
          </label>
        </div>
        {attachBox}
        <div className="confirm-actions">
          {linkOnly ? (
            <button type="button" className="send-button" disabled={busy} onClick={() => void answer(true, { mode: "link", carrierIds: [], ...(attach !== null ? { attachFile: attach } : {}) })}>
              {busy && !cancelling ? words.busy : "Yarat və link al"}
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              disabled={busy || selected.length === 0}
              onClick={() => void answer(true, { mode: "send", carrierIds: selected, ...(attach !== null ? { attachFile: attach } : {}) })}
            >
              {busy && !cancelling ? words.busy : `Yarat və seçilənlərə göndər${selected.length ? ` (${selected.length})` : ""}`}
            </button>
          )}
          <button type="button" className="confirm-no" disabled={busy} onClick={() => void answer(true, { mode: "create", carrierIds: [], ...(attach !== null ? { attachFile: attach } : {}) })}>
            Yalnız yarat
          </button>
          <button type="button" className="confirm-no" disabled={busy} onClick={() => void answer(false)}>
            {cancelling ? "Ləğv edilir…" : "Ləğv et"}
          </button>
        </div>
        {error && <p className="confirm-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className={`confirm-card ${confirmation.status}`}>
      <p className="confirm-text">{confirmation.text}</p>
      {attachBox}
      {pending ? (
        <div className="confirm-actions">
          <button
            type="button"
            className="send-button"
            disabled={busy}
            onClick={() => void answer(true, attach !== null ? { mode: "create", carrierIds: [], attachFile: attach } : undefined)}
          >
            {busy && !cancelling ? words.busy : words.yes}
          </button>
          <button type="button" className="confirm-no" disabled={busy} onClick={() => void answer(false)}>
            {cancelling ? "Ləğv edilir…" : "Xeyr"}
          </button>
        </div>
      ) : (
        <p className="muted confirm-status">{status}</p>
      )}
      {error && <p className="confirm-error">{error}</p>}
    </div>
  );
}
