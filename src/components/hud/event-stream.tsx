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
    <div className="h-28 shrink-0 overflow-y-auto overscroll-contain border-t border-border bg-black/60 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs leading-5 text-muted">
      <ul className="space-y-0.5">
        {events.map((event) => (
          <li key={event.id} className="grid grid-cols-[4.5rem_minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3">
            <time dateTime={event.createdAt} className="tabular-nums text-muted/70">{formatTime(event.createdAt)}</time>
            <span className="truncate font-semibold text-foreground/80">{event.applicationName ?? "SYSTEM"}</span>
            <span className="truncate" title={event.message}>{event.message}</span>
          </li>
        ))}
        {events.length === 0 && <li>Nenhum evento ainda.</li>}
      </ul>
    </div>
  );
}
