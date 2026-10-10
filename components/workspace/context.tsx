"use client";

import { createContext, useContext } from "react";
import type { GateId } from "@/lib/studio/types";
import type { ProjectView } from "../api";

export interface StudioCtx {
  id: string;
  view: ProjectView;
  url: (path?: string) => string;
  /** Run an action with a busy label, error toast and reload. Returns the result or undefined on error. */
  run: <T>(label: string, fn: () => Promise<T>, opts?: { reload?: boolean; success?: string }) => Promise<T | undefined>;
  busy: string | null;
  reload: () => Promise<void>;
  goto: (step: GateId) => void;
  notify: (message: string, kind?: "ok" | "bad" | "warn") => void;
}

export const StudioContext = createContext<StudioCtx | null>(null);

export function useStudio(): StudioCtx {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio outside workspace");
  return ctx;
}
