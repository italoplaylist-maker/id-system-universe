"use client";

import { useEffect, useState } from "react";
import { computeEnvironmentState, type EnvironmentState } from "./environment-state";

const RECOMPUTE_MS = 30_000;

/** Real time + astronomy, refreshed every 30s — plenty for a light direction that moves over minutes, never per-frame. */
export function useEnvironmentState(): EnvironmentState {
  const [state, setState] = useState<EnvironmentState>(() => computeEnvironmentState(new Date()));

  useEffect(() => {
    const id = setInterval(() => setState(computeEnvironmentState(new Date())), RECOMPUTE_MS);
    return () => clearInterval(id);
  }, []);

  return state;
}
