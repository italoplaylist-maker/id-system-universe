"use client";

import { useActivity } from "@/hooks/use-activity";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Discreet bottom-of-screen feed of real events — never synthetic. */
export function EventStream() {
  const { data } = useActivity(12);
  const events = data?.universeEvents ?? [];

  return (
    <div className="h-28 shrink-0 overflow-hidden border-t border-border bg-black/40 px-4 py-2 font-mono text-xs text-muted">
      <div className="flex h-full flex-col-reverse gap-0.5 overflow-hidden">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 truncate">
            <span className="shrink-0 text-muted/60">{formatTime(event.createdAt)}</span>
            <span className="shrink-0 font-semibold text-foreground/80">{event.applicationName ?? "SYSTEM"}</span>
            <span className="truncate">{event.message}</span>
          </div>
        ))}
        {events.length === 0 && <div>No events yet.</div>}
      </div>
    </div>
  );
}
