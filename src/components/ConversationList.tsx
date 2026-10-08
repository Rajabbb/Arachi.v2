import type { ConversationSummary } from "../../shared/protocol";
import { when } from "../lib/conversations";
import Icon from "./Icon";

interface Props {
  conversations: ConversationSummary[];
  activeId: number | null;
  /** While the agent is answering, switching conversations is paused. */
  disabled: boolean;
  open: boolean;
  onNew: () => void;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

/** Chat history: a sidebar on wide screens, a drawer on phones. */
export default function ConversationList({
  conversations, activeId, disabled, open, onNew, onOpen, onDelete, onClose,
}: Props) {
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={onClose} />}
      <aside className={`conversations${open ? " open" : ""}`} aria-label="Söhbət tarixçəsi">
        <button type="button" className="new-chat" onClick={onNew} disabled={disabled}>
          <Icon name="plus" /> Yeni söhbət
        </button>
        {conversations.length === 0 ? (
          <p className="conversations-empty">Hələ söhbət yoxdur. İlk mesajınız burada saxlanacaq.</p>
        ) : (
          <ul>
            {conversations.map((c) => (
              <li key={c.id} className={c.id === activeId ? "active" : undefined}>
                <button
                  type="button"
                  className="conversation-open"
                  onClick={() => onOpen(c.id)}
                  disabled={disabled}
                  aria-current={c.id === activeId ? "true" : undefined}
                >
                  <span className="conversation-title">{c.title}</span>
                  <span className="conversation-date">{when(c.updated_at)}</span>
                </button>
                <button
                  type="button"
                  className="conversation-delete"
                  title="Söhbəti sil"
                  aria-label={`"${c.title}" söhbətini sil`}
                  onClick={() => onDelete(c.id)}
                  disabled={disabled}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}
