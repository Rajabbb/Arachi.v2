import { useState } from "react";
import type { Message } from "./types";
import { sendToAgent, toAttachment } from "./lib/agent";
import MessageList from "./components/MessageList";
import Composer from "./components/Composer";
import UserMenu from "./components/UserMenu";
import type { User } from "./lib/auth";

const welcome: Message = {
  id: "welcome",
  role: "assistant",
  text: "Salam! Mən Arachi AI agentiyəm. Nə etmək istədiyinizi yazın və ya fayl əlavə edin, qalanını mən edim.",
  attachments: [],
  createdAt: Date.now(),
};

export default function App({ user }: { user: User }) {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [busy, setBusy] = useState(false);
  // Conversation state owned by the agent server; sent back unchanged each turn.
  const [transcript, setTranscript] = useState<unknown[]>([]);

  async function handleSend(text: string, files: File[]) {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      attachments: files.map(toAttachment),
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setBusy(true);
    try {
      const res = await sendToAgent({ text, files, transcript });
      setTranscript(res.transcript);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: res.reply,
          attachments: [],
          downloads: res.downloads,
          createdAt: Date.now(),
        },
      ]);
    } catch (err) {
      const detail = err instanceof Error ? ` (${err.message})` : "";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Xəta baş verdi, zəhmət olmasa yenidən cəhd edin.${detail}`,
          attachments: [],
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <span className="logo">Arachi</span>
        <span className="badge">V2</span>
        <nav className="nav">
          <a href="/" aria-current="page">Söhbət</a>
          <a href="/panel">Panel</a>
        </nav>
        <UserMenu user={user} />
      </header>
      <MessageList messages={messages} busy={busy} />
      <Composer disabled={busy} onSend={handleSend} />
    </div>
  );
}
