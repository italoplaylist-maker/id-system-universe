"use client";

import Link from "next/link";
import { useActivity } from "@/hooks/use-activity";
import { Card } from "@/components/ui/card";

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: "text-status-running",
  FAILED: "text-status-error",
  RUNNING: "text-status-deploying",
  REQUESTED: "text-muted",
};

export default function ActivityPage() {
  const { data, isLoading } = useActivity(100);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
          ← Back to Universe
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Activity</h1>
      </header>

      <main className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-6 py-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Recent Events</h2>
          <Card className="divide-y divide-border">
            {data?.universeEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 text-sm">
                <p>{event.message}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!isLoading && data?.universeEvents.length === 0 && <p className="p-4 text-sm text-muted">No events yet.</p>}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Audit Log</h2>
          <Card className="divide-y divide-border">
            {data?.auditEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{event.action.replaceAll("_", " ")}</p>
                  <span className={`text-xs ${STATUS_COLORS[event.status] ?? "text-muted"}`}>{event.status}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {event.user?.email ?? "system"}
                  {event.project ? ` · ${event.project.name}` : ""}
                  {event.application ? ` / ${event.application.name}` : ""}
                  {event.provider ? ` · ${event.provider.name}` : ""}
                </p>
                <p className="text-[11px] text-muted/70">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {!isLoading && data?.auditEvents.length === 0 && <p className="p-4 text-sm text-muted">No audit events yet.</p>}
          </Card>
        </section>
      </main>
    </div>
  );
}
