"use client";

import { useState } from "react";
import { useApplications } from "@/hooks/use-applications";
import { useProviders } from "@/hooks/use-providers";
import { useUiStore } from "@/store/ui-store";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { UniverseApplicationStatus } from "@/types/domain";

const STATUS_FILTERS: (UniverseApplicationStatus | "ALL")[] = ["ALL", "RUNNING", "DEPLOYING", "STOPPED", "ERROR", "UNKNOWN"];

export function ListView() {
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<UniverseApplicationStatus | "ALL">("ALL");
  const { selectApplication } = useUiStore();

  const { data: providers } = useProviders();
  const { data: applications, isLoading } = useApplications({
    query: query || undefined,
    providerId,
    status: status === "ALL" ? undefined : status,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <Input placeholder="Search applications…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-xs" />
        <select
          value={providerId ?? "ALL"}
          onChange={(e) => setProviderId(e.target.value === "ALL" ? undefined : e.target.value)}
          className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-foreground"
        >
          <option value="ALL">All Providers</option>
          {providers?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs ${
                status === s ? "border-accent text-accent" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && <p className="text-sm text-muted">Loading applications…</p>}
        {!isLoading && applications?.length === 0 && <p className="text-sm text-muted">No applications match.</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {applications?.map((app) => (
            <Card
              key={app.id}
              className="cursor-pointer p-4 transition-colors hover:border-accent/50"
              onClick={() => selectApplication(app.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{app.name}</p>
                  <p className="text-xs text-muted">{app.providerName}</p>
                </div>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: app.providerColor }} aria-hidden />
              </div>
              <div className="mt-3">
                <StatusBadge status={app.status} />
              </div>
              {app.branch && <p className="mt-2 truncate text-xs text-muted">{app.branch}</p>}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
