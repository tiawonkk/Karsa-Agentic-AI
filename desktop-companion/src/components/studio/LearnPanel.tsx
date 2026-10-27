import React, { useEffect, useRef, useState } from "react";
import { Globe, Headphones, ListChecks, Square } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, field, useAction } from "./shared";

interface Notebook {
  id: number;
  title: string;
  source_count: number;
}
interface Audio {
  title: string;
  segments: string[];
  mode: string;
  note?: string;
}
interface Question {
  type: "pilihan" | "isian";
  question: string;
  options?: string[];
  answer_index?: number;
  answer?: string;
  explanation?: string;
}

/** Notebook extras: web pages as sources, a spoken overview (browser text-to-speech) and a quiz. */
export const LearnPanel: React.FC = () => {
  const [nbs, setNbs] = useState<Notebook[]>([]);
  const [sel, setSel] = useState<number | "">("");
  const [url, setUrl] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [audio, setAudio] = useState<Audio | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [quizNote, setQuizNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<number, number | string>>({});
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const cancelled = useRef(false);

  const load = useAction(async () => {
    const d = await api<Notebook[] | { notebooks: Notebook[] }>("/notebooks");
    const list = Array.isArray(d) ? d : d.notebooks;
    setNbs(list);
    setSel((s) => (s !== "" && list.some((n) => n.id === s) ? s : list[0]?.id ?? ""));
  });
  const addUrl = useAction(async () => {
    const r = await api<{ name: string }>(`/notebooks/${sel}/sources/url`, { method: "POST", json: { url } });
    setAdded(r.name);
    setUrl("");
    await load.run();
  });
  const makeAudio = useAction(async () => setAudio(await api<Audio>(`/notebooks/${sel}/audio-overview`, { method: "POST" })));
  const makeQuiz = useAction(async () => {
    const r = await api<{ questions: Question[]; note?: string }>(`/notebooks/${sel}/quiz`, { method: "POST", json: { count: 6 } });
    setQuiz(r.questions);
    setQuizNote(r.note ?? null);
    setPicked({});
    setShown({});
  });

  useEffect(() => {
    load.run();
    return () => {
      cancelled.current = true;
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tts = typeof window !== "undefined" && "speechSynthesis" in window;
  const speak = () => {
    if (!audio || !tts) return;
    window.speechSynthesis.cancel();
    cancelled.current = false;
    setSpeaking(true);
    audio.segments.forEach((seg, i) => {
      const u = new SpeechSynthesisUtterance(seg);
      u.lang = "id-ID";
      u.onend = () => {
        if (i === audio.segments.length - 1) setSpeaking(false);
      };
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    });
  };
  const stop = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  if (nbs.length === 0 && !load.busy) {
    return <Hint>Belum ada notebook. Buat satu di widget <b>Notebook</b> dan tambahkan sumber, lalu kembali ke sini.</Hint>;
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Notebook</Label>
        <select value={sel} onChange={(e) => setSel(Number(e.target.value))} className={field} aria-label="Pilih notebook">
          {nbs.map((n) => <option key={n.id} value={n.id}>{n.title} ({n.source_count} sumber)</option>)}
        </select>
      </div>

      <div>
        <Label>Tambah halaman web</Label>
        <form onSubmit={(e) => { e.preventDefault(); addUrl.run(); }} className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={field} />
          <Btn type="submit" busy={addUrl.busy} disabled={!url.trim() || sel === ""}><Globe className="w-3 h-3" />Tambah</Btn>
        </form>
        {added && <Hint>Ditambahkan: {added}</Hint>}
        <Hint>PDF hasil scan juga bisa diunggah di widget Notebook: Karsa membacanya lewat OCR bila kunci Gemini terpasang.</Hint>
      </div>

      <div className="space-y-2">
        <Label>Ringkasan suara</Label>
        <div className="flex gap-2">
          <Btn tone="plain" onClick={() => makeAudio.run()} busy={makeAudio.busy} disabled={sel === ""}><Headphones className="w-3 h-3" />Buat ringkasan</Btn>
          {audio && (speaking ? <Btn tone="danger" onClick={stop}><Square className="w-3 h-3" />Berhenti</Btn> : <Btn onClick={speak} disabled={!tts}>Putar</Btn>)}
        </div>
        {!tts && <Hint>Peramban ini tidak mendukung suara; teks tetap bisa dibaca.</Hint>}
        {audio && (
          <Card className="space-y-1">
            <div className="text-[11.5px] font-semibold text-ink">{audio.title}</div>
            {audio.note && <Hint>{audio.note}</Hint>}
            {audio.segments.map((s, i) => <div key={i} className="text-[11px] text-ink-2">{s}</div>)}
          </Card>
        )}
      </div>

      <div className="space-y-2">
        <Label>Kuis</Label>
        <Btn tone="plain" onClick={() => makeQuiz.run()} busy={makeQuiz.busy} disabled={sel === ""}><ListChecks className="w-3 h-3" />Buat kuis</Btn>
        {quizNote && <Hint>{quizNote}</Hint>}
        {quiz?.map((q, i) => (
          <Card key={i} className="space-y-1.5">
            <div className="text-[11.5px] text-ink">{i + 1}. {q.question}</div>
            {q.type === "pilihan" ? (
              <div className="space-y-1">
                {q.options?.map((o, j) => {
                  const done = shown[i];
                  const right = j === q.answer_index;
                  return (
                    <button key={j} type="button" onClick={() => { setPicked({ ...picked, [i]: j }); setShown({ ...shown, [i]: true }); }} className={`w-full text-left text-[11px] rounded-lg px-2 py-1 cursor-pointer ${done && right ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400" : done && picked[i] === j ? "bg-rose-500/20 text-rose-500" : "bg-pill text-ink"}`}>
                      {o}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={String(picked[i] ?? "")} onChange={(e) => setPicked({ ...picked, [i]: e.target.value })} placeholder="Jawabanmu" className={field} />
                <Btn tone="plain" onClick={() => setShown({ ...shown, [i]: true })}>Cek</Btn>
              </div>
            )}
            {shown[i] && (
              <Hint>
                {q.type === "isian" ? (String(picked[i] ?? "").trim().toLowerCase() === (q.answer ?? "").toLowerCase() ? "Benar! " : `Jawaban: ${q.answer}. `) : ""}
                {q.explanation}
              </Hint>
            )}
          </Card>
        ))}
      </div>
      <ErrorLine message={load.error ?? addUrl.error ?? makeAudio.error ?? makeQuiz.error} />
    </div>
  );
};
