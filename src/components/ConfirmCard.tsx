import { useState } from "react";
import type { Confirmation } from "../../shared/protocol";

const statusText: Record<Confirmation["status"], string> = {
  pending: "",
  running: "İcra olunur…",
  done: "✓ Təsdiqləndi və göndərildi",
  failed: "⚠ Təsdiqləndi, amma alınmadı",
  declined: "Xeyr: heç nə göndərilmədi",
  expired: "Təsdiq vaxtı keçib, heç nə göndərilmədi",
};

/** The button and status words for what the prepared action does (send is the default). */
function wording(tool?: string) {
  if (tool === "create_rfq") return { yes: "Bəli, yarat", busy: "Yaradılır…", done: "✓ Təsdiqləndi və yaradıldı", declined: "Xeyr: heç nə yaradılmadı" };
  if (tool === "remove_carriers") return { yes: "Bəli, sil", busy: "Silinir…", done: "✓ Təsdiqləndi və silindi", declined: "Xeyr: heç nə silinmədi" };
  return { yes: "Bəli, göndər", busy: "Göndərilir…", done: statusText.done, declined: statusText.declined };
}

interface Props {
  confirmation: Confirmation;
  /** Sends the answer; resolves when the server has handled it. */
  onAnswer: (approve: boolean) => Promise<void>;
}

/**
 * An action the agent prepared that sends messages to carriers. It runs
 * only when the user presses "Bəli"; the text comes from the server and
 * lists exactly who gets what.
 */
export default function ConfirmCard({ confirmation, onAnswer }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function answer(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await onAnswer(approve);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  const pending = confirmation.status === "pending";
  const words = wording(confirmation.tool);
  const status = confirmation.status === "done" ? words.done : confirmation.status === "declined" ? words.declined : statusText[confirmation.status];
  return (
    <div className={`confirm-card ${confirmation.status}`}>
      <p className="confirm-text">{confirmation.text}</p>
      {pending ? (
        <div className="confirm-actions">
          <button type="button" className="send-button" disabled={busy} onClick={() => void answer(true)}>
            {busy ? words.busy : words.yes}
          </button>
          <button type="button" className="confirm-no" disabled={busy} onClick={() => void answer(false)}>
            Xeyr
          </button>
        </div>
      ) : (
        <p className="muted confirm-status">{status}</p>
      )}
      {error && <p className="confirm-error">{error}</p>}
    </div>
  );
}
