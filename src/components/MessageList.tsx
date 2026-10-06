import { useEffect, useRef } from "react";
import type { Message } from "../types";
import { formatSize } from "../lib/agent";
import MarkdownText from "./MarkdownText";

interface Props {
  messages: Message[];
  busy: boolean;
}

export default function MessageList({ messages, busy }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  return (
    <main className="messages" aria-live="polite">
      {messages.map((m) => (
        <div key={m.id} className={`message ${m.role}`}>
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
          </div>
        </div>
      ))}
      {busy && (
        <div className="message assistant">
          <div className="bubble typing" aria-label="AI yazır">
            <span />
            <span />
            <span />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </main>
  );
}
