import React, { useState } from "react";
import { BookOpen, Briefcase, FileText, FlaskConical, Hammer, Search, Table2, Wallet } from "lucide-react";
import { AutomationId } from "../../stores/studioMode";
import { FinancePanel } from "./FinancePanel";
import { DataPanel } from "./DataPanel";
import { ProjectPanel, SearchPanel } from "./ResearchPanel";
import { BusinessPanel } from "./BusinessPanel";
import { BuildPanel } from "./BuildPanel";
import { NotebookBody } from "../widgets/NotebookWidget";
import { FolderBar } from "./FolderBar";

export interface Automation {
  id: AutomationId;
  no: string;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  /** soft gradient behind the icon chip */
  tint: string;
}

const ic = "w-4 h-4";
export const AUTOMATIONS: Automation[] = [
  { id: "finance", no: "1 & 2", label: "Finance & Laporan", blurb: "Catat uang, berita finance, laporan bulanan", icon: <Wallet className={ic} />, tint: "linear-gradient(135deg,#FBBF24,#F97316)" },
  { id: "prd", no: "3", label: "PRD-to-App", blurb: "PRD jadi aplikasi, 0 sampai 100%", icon: <Hammer className={ic} />, tint: "linear-gradient(135deg,#34D399,#10B981)" },
  { id: "data", no: "4", label: "Data CSV/XLSX", blurb: "Bersihkan data untuk model ML", icon: <Table2 className={ic} />, tint: "linear-gradient(135deg,#38BDF8,#6366F1)" },
  { id: "research", no: "5", label: "Deep Research", blurb: "Jurnal arXiv/Crossref + matriks", icon: <Search className={ic} />, tint: "linear-gradient(135deg,#A78BFA,#6C63FF)" },
  { id: "article", no: "6", label: "Artikel Ilmiah", blurb: "Draf IMRaD dari sumbermu, ekspor .docx", icon: <FileText className={ic} />, tint: "linear-gradient(135deg,#FB7185,#F43F5E)" },
  { id: "brain", no: "7", label: "Personal Brain", blurb: "Notebook: tanya bersitasi, rangkum, kuis", icon: <BookOpen className={ic} />, tint: "linear-gradient(135deg,#FFB07B,#FF758F)" },
  { id: "project", no: "8", label: "Project Hub", blurb: "Nama proyek, sumber data, nilai kebaruan", icon: <FlaskConical className={ic} />, tint: "linear-gradient(135deg,#22D3EE,#0EA5E9)" },
  { id: "business", no: "9", label: "Business Builder", blurb: "Ide jadi modal, RAB, HPP, BEP, ROI", icon: <Briefcase className={ic} />, tint: "linear-gradient(135deg,#F59E0B,#EF4444)" },
];

// Bumped when the business canvas hands a PRD to the app builder, so the builder list reloads
let buildBump = 0;

/** The working surface of one automation. Used by the compact dock and by Full App Mode. */
export const AutomationPanel: React.FC<{ id: AutomationId; onGo?: (id: AutomationId) => void }> = ({ id, onGo }) => {
  const [, force] = useState(0);
  switch (id) {
    case "finance":
      return <FinancePanel />;
    case "prd":
      return <BuildPanel refreshKey={buildBump} />;
    case "data":
      return <DataPanel />;
    case "research":
      return <SearchPanel />;
    case "article":
    case "brain":
      // The notebook holds both: cited Q&A / quiz for learning, and the IMRaD paper draft with .docx export
      return (
        <div className="space-y-2">
          {id === "article" && <FolderBar compact hint="Pilih folder agar paper_imrad.docx langsung tersimpan di sana." />}
          <div className="h-[560px] max-h-full">
            <NotebookBody size="L" />
          </div>
        </div>
      );
    case "project":
      return (
        <div className="space-y-3">
          <FolderBar compact />
          <ProjectPanel />
        </div>
      );
    case "business":
      return (
        <div className="space-y-3">
          <FolderBar compact />
          <BusinessPanel
          onBuildCreated={() => {
            buildBump++;
            force((n) => n + 1);
            onGo?.("prd");
          }}
        />
        </div>
      );
  }
};
