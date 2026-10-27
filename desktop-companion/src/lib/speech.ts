import { useCallback, useEffect, useRef, useState } from "react";
import { setMood } from "./jelly";

/** Browser/WebView speech recognition (Indonesian). Absent in some browsers: callers must hide the mic then. */
const getCtor = (): any =>
  typeof window === "undefined" ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export const speechSupported = (): boolean => !!getCtor();

/** Press once to talk; interim text streams into `onText`, and `onFinal` fires when speech ends. */
export function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => recRef.current?.abort?.(), []);

  const toggle = useCallback(() => {
    if (listening) {
      recRef.current?.stop?.();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Perangkat ini belum mendukung suara.");
      return;
    }
    const rec = new Ctor();
    rec.lang = "id-ID";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      cb.current(text.trim());
    };
    rec.onerror = (e: any) => {
      setError(e?.error === "not-allowed" ? "Izin mikrofon ditolak." : "Suara tidak terbaca, coba lagi.");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setMood("idle");
    };
    recRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
      setMood("listening");
    } catch (_) {
      setListening(false);
    }
  }, [listening]);

  return { listening, error, toggle, supported: speechSupported() };
}
