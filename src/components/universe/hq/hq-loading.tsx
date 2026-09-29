"use client";

/** Coherent loading state instead of a black flash while WebGL support is probed (briefing 90). */
export function HqLoading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted">Loading</p>
      <p className="text-lg font-semibold text-foreground">ID SYSTEM HQ</p>
      <p className="text-xs text-muted">Preparing the building…</p>
    </div>
  );
}
