import React from "react";
import { BookOpen, CheckSquare, MessageCircle, Music2, ShieldCheck, Timer, Wallet, Droplet } from "lucide-react";
import { WidgetId, WidgetSize, useWidgets } from "../../context/WidgetsContext";
import { WidgetContainer } from "./ResizableWidget";
import { PomodoroBody } from "./PomodoroWidget";
import { WaterBody } from "./WaterWidget";
import { TodoBody } from "./TodoWidget";
import { FinanceBody } from "./FinanceWidget";
import { MediaBody } from "./MediaWidget";
import { ChatBody, ChatBridge } from "./ChatWidget";
import { NotebookBody } from "./NotebookWidget";
import { ApprovalsBody } from "./ApprovalsWidget";
import { SlideErrorBoundary } from "../SlideErrorBoundary";
import { useTheme } from "../../context/ThemeContext";

interface WidgetDef {
  title: string;
  icon: React.ReactNode;
  launcherIcon: React.ReactNode;
  /** One soft accent per module */
  accent: string;
}

const ic = "w-3.5 h-3.5";
export const WIDGET_DEFS: Record<WidgetId, WidgetDef> = {
  pomodoro: { title: "Pomodoro", icon: <Timer className={`${ic} text-rose-500`} />, launcherIcon: <Timer className="w-4 h-4" />, accent: "#fb7185" },
  water: { title: "Water", icon: <Droplet className={`${ic} text-sky-500`} />, launcherIcon: <Droplet className="w-4 h-4" />, accent: "#0ea5e9" },
  todo: { title: "Todo", icon: <CheckSquare className={`${ic} text-emerald-500`} />, launcherIcon: <CheckSquare className="w-4 h-4" />, accent: "#10b981" },
  finance: { title: "Finance", icon: <Wallet className={`${ic} text-amber-500`} />, launcherIcon: <Wallet className="w-4 h-4" />, accent: "#f59e0b" },
  media: { title: "Media", icon: <Music2 className={`${ic} text-orange-500`} />, launcherIcon: <Music2 className="w-4 h-4" />, accent: "#f97316" },
  notebook: { title: "Notebook", icon: <BookOpen className={`${ic} text-violet-500`} />, launcherIcon: <BookOpen className="w-4 h-4" />, accent: "#8b5cf6" },
  approvals: { title: "Approvals", icon: <ShieldCheck className={`${ic} text-teal-500`} />, launcherIcon: <ShieldCheck className="w-4 h-4" />, accent: "#14b8a6" },
  chat: { title: "AI Chat", icon: <MessageCircle className={`${ic} text-indigo-500`} />, launcherIcon: <MessageCircle className="w-4 h-4" />, accent: "#6366f1" },
};

interface RenderCtx {
  chat: ChatBridge;
  onOpenSettings: () => void;
}

/** One widget frame + its body for the current size. Used by both the dock and the floating layer. */
export const WidgetView: React.FC<{ id: WidgetId } & RenderCtx> = ({ id, chat, onOpenSettings }) => {
  const def = WIDGET_DEFS[id];
  const body = (size: WidgetSize): React.ReactNode => {
    switch (id) {
      case "pomodoro":
        return <PomodoroBody size={size} />;
      case "water":
        return <WaterBody size={size} />;
      case "todo":
        return <TodoBody size={size} />;
      case "finance":
        return <FinanceBody size={size} />;
      case "media":
        return <MediaBody size={size} />;
      case "chat":
        return <ChatBody size={size} chat={chat} onOpenSettings={onOpenSettings} />;
      case "notebook":
        return <NotebookBody size={size} />;
      case "approvals":
        return <ApprovalsBody size={size} />;
    }
  };
  const { isDark } = useTheme();
  return (
    <WidgetContainer id={id} title={def.title} icon={def.icon} accent={def.accent}>
      {(size) => (
        <SlideErrorBoundary slideName={def.title} isDark={isDark}>
          {body(size)}
        </SlideErrorBoundary>
      )}
    </WidgetContainer>
  );
};

/** Drop-zone hints shown while any widget is dragged: outline the dock, or glow the screen edge. */
export const DropHints: React.FC = () => {
  const { dragHint } = useWidgets();
  if (!dragHint) return null;
  const { zone, accent, dockBox } = dragHint;
  if (zone === "dock" && dockBox) {
    return (
      <div
        className="fixed rounded-2xl pointer-events-none flex items-end justify-center pb-3 z-[44]"
        style={{ ...dockBox, background: `${accent}22`, boxShadow: `0 0 0 2px ${accent}` }}
      >
        <span className="px-3 py-1 rounded-full text-[11px] font-semibold text-white" style={{ background: accent }}>
          Lepas untuk memasukkan ke Dock
        </span>
      </div>
    );
  }
  if (zone === "left" || zone === "right") {
    return (
      <>
        <div
          className="fixed top-0 bottom-0 w-2 pointer-events-none z-[44]"
          style={{ [zone]: 0, background: accent, boxShadow: `0 0 18px 4px ${accent}` } as React.CSSProperties}
        />
        <span
          className="fixed top-1/2 -translate-y-1/2 px-3 py-1 rounded-full text-[11px] font-semibold text-white pointer-events-none z-[44]"
          style={{ [zone]: 14, background: accent } as React.CSSProperties}
        >
          Lepas untuk menyembunyikan
        </span>
      </>
    );
  }
  return null;
};

/** Floating (undocked) widgets. The wrapper never blocks clicks: each widget re-enables pointer events itself. */
export const FloatingWidgets: React.FC<RenderCtx> = ({ chat, onOpenSettings }) => {
  const { widgets } = useWidgets();
  const floating = (Object.keys(widgets) as WidgetId[]).filter((id) => widgets[id].open && !widgets[id].docked);
  return (
    <div className="fixed inset-0 pointer-events-none z-[45]">
      {floating.map((id) => (
        <WidgetView key={id} id={id} chat={chat} onOpenSettings={onOpenSettings} />
      ))}
      <DropHints />
    </div>
  );
};
