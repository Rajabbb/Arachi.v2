import { useEffect, useState } from "react";
import type { ConfirmAnswer, ConversationSummary } from "../shared/protocol";
import type { Message } from "./types";
import { AgentRequestError, sendToAgent, toAttachment } from "./lib/agent";
import { answerConfirmation, deleteConversation, listConversations, loadConversation, toMessage } from "./lib/conversations";
import MessageList from "./components/MessageList";
import Composer from "./components/Composer";
import ConversationList from "./components/ConversationList";
import UserMenu from "./components/UserMenu";
import Welcome from "./components/Welcome";
import Icon from "./components/Icon";
import { arachiSiteUrl, type User } from "./lib/auth";
import type { Quota } from "../shared/protocol";
import { chatSteps, useProgress } from "./lib/progress";

function notice(text: string): Message {
  return { id: crypto.randomUUID(), role: "assistant", text, attachments: [], createdAt: Date.now() };
}

export default function App({ user }: { user: User }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // The saved conversation on screen; null = a new one, created by its first message.
  const [activeId, setActiveId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quota, setQuota] = useState<Quota | undefined>(user.quota);
  const [steps, setSteps] = useState<string[]>(["Mesaj oxunur…"]);
  const progress = useProgress(busy, steps);

  async function refreshList() {
    try {
      setConversations(await listConversations());
    } catch {
      // The list is a convenience; the chat keeps working without it.
    }
  }

  async function open(id: number) {
    setDrawerOpen(false);
    setLoading(true);
    try {
      setMessages(await loadConversation(id));
      setActiveId(id);
    } catch (err) {
      setActiveId(null);
      setMessages([notice(`Söhbəti açmaq alınmadı. ${err instanceof Error ? err.message : ""}`.trim())]);
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setDrawerOpen(false);
    setActiveId(null);
    setMessages([]);
  }

  // After login: the latest conversation, or a new empty one.
  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then(async (list) => {
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) await open(list[0].id);
        else setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id: number) {
    const title = conversations.find((c) => c.id === id)?.title ?? "";
    if (!window.confirm(`"${title}" söhbəti silinsin? Bunu geri qaytarmaq mümkün olmayacaq.`)) return;
    try {
      await deleteConversation(id);
      if (id === activeId) startNew();
      await refreshList();
    } catch (err) {
      window.alert(`Söhbəti silmək alınmadı. ${err instanceof Error ? err.message : ""}`.trim());
    }
  }

  async function handleSend(text: string, files: File[]) {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      attachments: files.map(toAttachment),
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setSteps(chatSteps(files.length > 0, text));
    setBusy(true);
    try {
      const res = await sendToAgent({ text, files, conversationId: activeId });
      setActiveId(res.conversationId);
      if (res.quota) setQuota(res.quota);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: res.reply,
          attachments: [],
          downloads: res.downloads,
          cards: res.cards,
          confirmations: res.confirmations,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      // The message may have been saved (and a conversation created) before the error.
      if (err instanceof AgentRequestError && err.conversationId) setActiveId(err.conversationId);
      if (err instanceof AgentRequestError && err.status === 402) {
        // Demo over or the plan's request allowance used up: not an error to retry.
        setQuota((q) => (q ? { ...q, expired: q.expired || /Demo müddəti/.test(err.message), remaining: /limiti dolub/.test(err.message) ? 0 : q.remaining } : q));
        setMessages((prev) => [...prev, notice(err.message)]);
      } else {
        const detail = err instanceof Error ? ` (${err.message})` : "";
        setMessages((prev) => [...prev, notice(`Xəta baş verdi, zəhmət olmasa yenidən cəhd edin.${detail}`)]);
      }
    } finally {
      setBusy(false);
      void refreshList();
    }
  }

  async function handleConfirm(confirmationId: string, approve: boolean, answer?: ConfirmAnswer) {
    const res = await answerConfirmation(confirmationId, approve, answer);
    setMessages((prev) => [
      ...prev.map((m) =>
        m.confirmations?.some((c) => c.id === confirmationId)
          ? { ...m, confirmations: m.confirmations.map((c) => (c.id === confirmationId ? res.confirmation : c)) }
          : m,
      ),
      ...(res.message ? [toMessage(res.message)] : []),
    ]);
  }

  const title = conversations.find((c) => c.id === activeId)?.title ?? "Yeni söhbət";

  return (
    <div className="chat-layout">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        disabled={busy}
        open={drawerOpen}
        onNew={startNew}
        onOpen={(id) => void open(id)}
        onDelete={(id) => void handleDelete(id)}
        onClose={() => setDrawerOpen(false)}
      />
      <div className="app">
        <header className="header">
          <button
            type="button"
            className="icon-button drawer-toggle"
            aria-label="Söhbət tarixçəsi"
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
          <span className="logo">Arachi</span>
          <span className="badge">AI</span>
          <nav className="nav">
            <a href="/" aria-current="page">Söhbət</a>
            {window.self === window.top && <a href={`${arachiSiteUrl}/customer`}>arachi.co paneli</a>}
          </nav>
          <UserMenu user={user} quota={quota} />
        </header>
        <div className="chat-title" title={title}>{title}</div>
        <MessageList
          messages={loading ? [] : messages}
          busy={busy || loading}
          progress={busy ? progress : undefined}
          onConfirm={handleConfirm}
          empty={<Welcome name={user.name} disabled={busy || loading} onPick={(text) => void handleSend(text, [])} />}
        />
        <Composer disabled={busy || loading} onSend={handleSend} />
      </div>
    </div>
  );
}
