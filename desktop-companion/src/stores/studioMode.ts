import { useSyncExternalStore } from "react";

/** Full App Mode (Studio View): one tiny store so the Island, the dock and the keyboard can all open the same window. */
export type StudioTarget = "chat" | AutomationId;
export type AutomationId = "finance" | "prd" | "data" | "research" | "article" | "brain" | "project" | "business";

interface StudioState {
  open: boolean;
  target: StudioTarget;
}

let state: StudioState = { open: false, target: "chat" };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const openStudio = (target?: StudioTarget) => {
  state = { open: true, target: target ?? state.target };
  emit();
};
export const closeStudio = () => {
  state = { ...state, open: false };
  emit();
};
export const toggleStudio = () => (state.open ? closeStudio() : openStudio());
export const setStudioTarget = (target: StudioTarget) => {
  state = { ...state, target };
  emit();
};

export const useStudioMode = (): StudioState =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
