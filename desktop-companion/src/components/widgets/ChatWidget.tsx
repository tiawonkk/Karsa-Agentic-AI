import React, { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { MarkdownView } from "../MarkdownView";
import { useSystemStatus } from "../../context/SystemStatusContext";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/** The conversation lives in NotchIsland (shared with the @Directive bar); the widget is just a view on it. */
export interface ChatBridge {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
}

export const ChatBody: React.FC<{ size: WidgetSize; chat: ChatBridge; onOpenSettings: () => void }> = ({
  size,
  chat,
  onOpenSettings,
}) => {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const { isApiConnected, activeBadge } = useSystemStatus();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages, chat.isStreaming, size]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const v = input.trim();
    if (!v || chat.isStreaming) return;
    setInput("");
    chat.onSend(v);
  };

  const field = (
    <form onSubmit={send} className="flex items-center gap-1.5 w-full">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Tanya Karsa…"
        className="flex-1 min-w-0 h-7 px-3 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent"
      />
      <button
        type="submit"
        disabled={!input.trim() || chat.isStreaming}
        className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer flex-shrink-0"
        title="Kirim"
        aria-label="Kirim"
      >
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );

  if (size === "S") {
    return <div className="w-full pr-1">{field}</div>;
  }

  const visible = size === "M" ? chat.messages.slice(-2) : chat.messages;

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => (!isApiConnected ? onOpenSettings() : undefined)}
          className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
            isApiConnected
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 cursor-default"
              : "bg-rose-500/10 text-rose-500 border-rose-500/30 cursor-pointer"
          }`}
          title={isApiConnected ? "AI terhubung" : "Klik untuk memasang API key"}
        >
          {activeBadge}
        </button>
        {size === "L" && (
          <button
            type="button"
            onClick={chat.onClear}
            className="w-6 h-6 rounded-full text-ink-muted hover:text-ink hover:bg-pill flex items-center justify-center cursor-pointer"
            title="Bersihkan percakapan"
            aria-label="Bersihkan percakapan"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5 text-[11.5px]">
        {visible.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[92%] px-2.5 py-1.5 rounded-2xl leading-relaxed ${
                m.role === "user" ? "bg-accent text-white rounded-tr-sm" : "bg-card text-ink border border-subtle rounded-tl-sm"
              }`}
            >
              {m.role === "assistant" ? <MarkdownView content={m.text || "…"} /> : m.text}
            </div>
          </div>
        ))}
        {chat.isStreaming && chat.messages[chat.messages.length - 1]?.role === "user" && (
          <div className="text-[11px] text-ink-muted">Karsa sedang berpikir…</div>
        )}
        <div ref={endRef} />
      </div>
      {field}
    </div>
  );
};
