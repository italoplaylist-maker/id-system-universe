"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { ASSET_MANIFEST } from "@/components/universe/hq/assets/asset-manifest";
import type { AssetKey } from "@/components/universe/hq/assets/asset-keys";

type CheckResult = "checking" | "present" | "missing";

function initialChecks(): Record<string, CheckResult> {
  const result: Record<string, CheckResult> = {};
  for (const [key, entry] of Object.entries(ASSET_MANIFEST)) {
    if (entry.enabled) result[key] = "checking";
  }
  return result;
}

const CATEGORY_LABEL: Record<string, string> = {
  office: "Office",
  people: "People",
  infrastructure: "Infrastructure",
  decoration: "Decoration",
};

/** Dev-only: shows which GLBs are wired up vs. still on procedural fallback, and whether an enabled entry's file actually exists at its path. */
export default function AssetStatusPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const [checks, setChecks] = useState<Record<string, CheckResult>>(initialChecks);

  useEffect(() => {
    const entries = Object.entries(ASSET_MANIFEST) as [AssetKey, (typeof ASSET_MANIFEST)[AssetKey]][];
    for (const [key, entry] of entries) {
      if (!entry.enabled) continue;
      fetch(entry.path, { method: "HEAD" })
        .then((res) => setChecks((prev) => ({ ...prev, [key]: res.ok ? "present" : "missing" })))
        .catch(() => setChecks((prev) => ({ ...prev, [key]: "missing" })));
    }
  }, []);

  const byCategory = new Map<string, [AssetKey, (typeof ASSET_MANIFEST)[AssetKey]][]>();
  for (const [key, entry] of Object.entries(ASSET_MANIFEST) as [AssetKey, (typeof ASSET_MANIFEST)[AssetKey]][]) {
    const list = byCategory.get(entry.category) ?? [];
    list.push([key, entry]);
    byCategory.set(entry.category, list);
  }

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <h1 className="text-xl font-semibold">HQ Asset Status</h1>
      <p className="mt-1 text-sm text-muted">
        Drop a GLB at the expected path, flip <code>enabled: true</code> in <code>asset-manifest.ts</code>, reload this page.
      </p>

      <div className="mt-6 space-y-8">
        {Array.from(byCategory.entries()).map(([category, entries]) => (
          <div key={category}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{CATEGORY_LABEL[category] ?? category}</h2>
            <div className="space-y-2">
              {entries.map(([key, entry]) => {
                const status: CheckResult | "disabled" = entry.enabled ? (checks[key] ?? "checking") : "disabled";
                return (
                  <div key={key} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{entry.label}</p>
                      <p className="text-xs text-muted">Expected: {entry.path}</p>
                    </div>
                    <span
                      className={
                        status === "present"
                          ? "rounded-full bg-status-running/15 px-2.5 py-1 text-xs font-semibold text-status-running"
                          : status === "missing"
                            ? "rounded-full bg-status-error/15 px-2.5 py-1 text-xs font-semibold text-status-error"
                            : "rounded-full bg-surface-raised px-2.5 py-1 text-xs font-semibold text-muted"
                      }
                    >
                      {status === "present" ? "GLB LOADED" : status === "missing" ? "ENABLED BUT MISSING" : status === "checking" ? "CHECKING…" : "FALLBACK"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
