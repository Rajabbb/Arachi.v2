import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatSize } from "../lib/agent";
import Icon from "./Icon";

interface Props {
  disabled: boolean;
  onSend: (text: string, files: File[]) => void;
}

export default function Composer({ disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const canSend = !disabled && (text.trim().length > 0 || files.length > 0);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(text.trim(), files);
    setText("");
    setFiles([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <form
      className="composer"
      onSubmit={submit}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {files.length > 0 && (
        <ul className="attachments pending">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="chip">
              📎 {f.name} <span className="muted">({formatSize(f.size)})</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`${f.name} faylını sil`}
                onClick={() => removeFile(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-row">
        <button
          type="button"
          className="icon-button"
          aria-label="Fayl əlavə et"
          title="Fayl əlavə et"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="paperclip" size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Nə etmək istədiyinizi yazın..."
          rows={1}
        />
        <button type="submit" className="send-button" disabled={!canSend}>
          Göndər
        </button>
      </div>
    </form>
  );
}
