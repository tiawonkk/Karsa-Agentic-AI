import React, { useState } from "react";
import { BarChart3, BookOpen, Briefcase, FlaskConical, Hammer, Search, Wallet } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { FinancePanel } from "../studio/FinancePanel";
import { DataPanel } from "../studio/DataPanel";
import { ProjectPanel, SearchPanel } from "../studio/ResearchPanel";
import { BusinessPanel } from "../studio/BusinessPanel";
import { BuildPanel } from "../studio/BuildPanel";
import { LearnPanel } from "../studio/LearnPanel";

type Tab = "money" | "data" | "search" | "project" | "business" | "build" | "learn";

const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "money", label: "Uang", icon: <Wallet className="w-3.5 h-3.5" /> },
  { id: "data", label: "Data", icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: "search", label: "Literatur", icon: <Search className="w-3.5 h-3.5" /> },
  { id: "project", label: "Proyek", icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { id: "business", label: "Bisnis", icon: <Briefcase className="w-3.5 h-3.5" /> },
  { id: "build", label: "Aplikasi", icon: <Hammer className="w-3.5 h-3.5" /> },
  { id: "learn", label: "Belajar", icon: <BookOpen className="w-3.5 h-3.5" /> },
];

const TAB_KEY = "karsa_studio_tab";

/** Karsa Studio: the automations that need more room than a chat reply (reports, data, research, business, app builder). */
export const StudioBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      return t && TABS.some((x) => x.id === t) ? t : "money";
    } catch (_) {
      return "money";
    }
  });
  const [buildKey, setBuildKey] = useState(0);
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch (_) {}
  };

  if (size === "S") {
    return (
      <div className="w-full flex items-center gap-2 text-[12px] font-semibold text-ink">
        <FlaskConical className="w-4 h-4 text-violet-500" /> Karsa Studio
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div role="tablist" aria-label="Bagian Studio" className="flex gap-1 overflow-x-auto flex-shrink-0 pb-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => choose(t.id)}
            className={`h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap cursor-pointer ${tab === t.id ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 select-text">
        {tab === "money" && <FinancePanel />}
        {tab === "data" && <DataPanel />}
        {tab === "search" && <SearchPanel />}
        {tab === "project" && <ProjectPanel />}
        {tab === "business" && (
          <BusinessPanel
            onBuildCreated={() => {
              setBuildKey((k) => k + 1);
              choose("build");
            }}
          />
        )}
        {tab === "build" && <BuildPanel refreshKey={buildKey} />}
        {tab === "learn" && <LearnPanel />}
      </div>
    </div>
  );
};
