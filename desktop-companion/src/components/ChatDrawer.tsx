import React, { useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X, MessageSquare, Trash2, Send } from "lucide-react";
import { MarkdownView } from "./MarkdownView";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (msg: string) => void;
  onClearChat: () => void;
  isDark?: boolean;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  isStreaming,
  onSendMessage,
  onClearChat,
  isDark = true,
}) => {
  const [input, setInput] = React.useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isOpen, messages]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSendMessage(input.trim());
    setInput("");
  };

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-12 pb-6 bg-black/65 backdrop-blur-md overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
        className={`w-full max-w-[440px] h-[80vh] max-h-[620px] rounded-3xl overflow-hidden flex flex-col border shadow-2xl ${
          isDark
            ? "bg-[#18181B] border-white/10 text-zinc-100"
            : "bg-[#FAF9F6] border-zinc-200 text-zinc-900"
        }`}
        style={{
          boxShadow: isDark
            ? "0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.08)"
            : "0 24px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.06)",
        }}
      >
        {/* Header - ALWAYS VISIBLE */}
        <div
          className={`px-5 py-3.5 flex items-center justify-between border-b flex-shrink-0 ${
            isDark ? "border-white/5 bg-white/[0.02]" : "border-zinc-200/80 bg-black/[0.01]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-500">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-tight">Karsa Conversation</h2>
              <p className="text-[10px] text-zinc-400">
                {isStreaming ? "Karsa sedang mengetik..." : "Asisten AI Kuliah & Riset"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onClearChat}
              className={`p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer ${
                isDark ? "hover:bg-white/5" : "hover:bg-zinc-200"
              }`}
              title="Bersihkan Percakapan"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                isDark
                  ? "bg-white/10 hover:bg-white/20 text-zinc-200 hover:text-white"
                  : "bg-zinc-200 hover:bg-zinc-300 text-zinc-700 hover:text-zinc-900"
              }`}
              title="Tutup (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${
                  msg.role === "user"
                    ? "bg-orange-600 text-white shadow-sm font-medium"
                    : isDark
                    ? "bg-white/[0.06] border border-white/5 text-zinc-200"
                    : "bg-white border border-zinc-200/80 text-zinc-800 shadow-sm"
                }`}
              >
                {msg.role === "user" ? (
                  <span className="whitespace-pre-wrap">{msg.text}</span>
                ) : (
                  <MarkdownView content={msg.text} />
                )}
              </div>
            </div>
          ))}
          {isStreaming && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-zinc-400 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse delay-75" />
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse delay-150" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div
          className={`p-3 border-t flex items-center gap-2 flex-shrink-0 ${
            isDark ? "border-white/5 bg-black/20" : "border-zinc-200/80 bg-white"
          }`}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ketik balasan untuk Karsa..."
            className={`flex-1 text-xs px-3.5 py-2 rounded-xl border outline-none ${
              isDark
                ? "bg-white/5 border-white/10 text-white placeholder-zinc-500 focus:border-orange-500/50"
                : "bg-zinc-50 border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-orange-500/50"
            }`}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={`p-2 rounded-xl text-white transition-all cursor-pointer flex-shrink-0 ${
              input.trim() && !isStreaming
                ? "bg-orange-600 hover:bg-orange-500 shadow-md"
                : "bg-zinc-600/50 opacity-40 cursor-not-allowed"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
