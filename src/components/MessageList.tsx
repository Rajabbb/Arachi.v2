import { useEffect, useRef, type ReactNode } from "react";
import type { ConfirmAnswer } from "../../shared/protocol";
import type { Message } from "../types";
import { formatSize } from "../lib/agent";
import MarkdownText from "./MarkdownText";
import ConfirmCard from "./ConfirmCard";
import AiMascot from "./AiMascot";
import ResultCards from "./ResultCards";

interface Props {
  messages: Message[];
  busy: boolean;
  /** What the agent is doing now (shown beside the typing dots). */
  progress?: string;
  onConfirm?: (confirmationId: string, approve: boolean, answer?: ConfirmAnswer) => Promise<void>;
  /** Shown instead of the list while there are no messages (the greeting). */
  empty?: ReactNode;
}

export default function MessageList({ messages, busy, progress, onConfirm, empty }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (empty && messages.length === 0 && !busy) {
    return <main className="messages empty-state">{empty}</main>;
  }

  return (
    <main className="messages" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className={`message ${m.role}`}>
          {m.role === "assistant" && (
            <span className="avatar" aria-hidden="true">
              <AiMascot size={32} mini />
            </span>
          )}
          <div className="bubble">
            {m.text &&
              (m.role === "assistant" ? <MarkdownText text={m.text} /> : <p>{m.text}</p>)}
            {m.attachments.length > 0 && (
              <ul className="attachments">
                {m.attachments.map((a) => (
                  <li key={a.id} className="chip">
                    📎 {a.name} <span className="muted">({formatSize(a.size)})</span>
                  </li>
                ))}
              </ul>
            )}
            {m.cards && m.cards.length > 0 && <ResultCards cards={m.cards} />}
            {m.downloads && m.downloads.length > 0 && (
              <ul className="attachments">
                {m.downloads.map((d) => (
                  <li key={d.url}>
                    <a className="chip download" href={d.url} download={d.name}>
                      ⬇ {d.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {onConfirm &&
              m.confirmations?.map((c) => (
                <ConfirmCard key={c.id} confirmation={c} onAnswer={(approve, answer) => onConfirm(c.id, approve, answer)} />
              ))}
          </div>
        </div>
      ))}
      {busy && (
        <div className="message assistant">
          <span className="avatar" aria-hidden="true">
            <AiMascot size={32} mini />
          </span>
          <div className="bubble typing" aria-label={progress || "AI yazır"}>
            <span />
            <span />
            <span />
            {progress && <em className="typing-step">{progress}</em>}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </main>
  );
}
