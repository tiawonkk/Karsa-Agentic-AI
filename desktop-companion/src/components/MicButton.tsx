import React from "react";
import { Mic, MicOff } from "lucide-react";
import { useSpeech } from "../lib/speech";

/** Tap, speak in Indonesian, text appears in the field. Renders nothing when the device has no speech support. */
export const MicButton: React.FC<{ onText: (text: string) => void; className?: string }> = ({ onText, className = "" }) => {
  const { listening, error, toggle, supported } = useSpeech(onText);
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title={error ?? (listening ? "Mendengarkan… ketuk untuk berhenti" : "Bicara")}
      aria-label={listening ? "Berhenti mendengarkan" : "Bicara"}
      aria-pressed={listening}
      className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-95 transition-colors ${
        listening ? "bg-rose-500 text-white animate-pulse" : error ? "bg-pill text-rose-500" : "bg-pill text-ink-2 hover:text-ink"
      } ${className}`}
    >
      {error && !listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
    </button>
  );
};
