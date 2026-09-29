"use client";

import { useApplicationDeployments } from "@/hooks/use-applications";
import type { UniverseDeployment } from "@/types/domain";

const STATUS_CLASSES: Record<UniverseDeployment["status"], string> = {
  QUEUED: "text-status-unknown",
  RUNNING: "text-status-deploying",
  SUCCESS: "text-status-running",
  FAILED: "text-status-error",
  CANCELLED: "text-status-stopped",
};

function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

export function DeploymentList({ applicationId }: { applicationId: string }) {
  const { data, isLoading } = useApplicationDeployments(applicationId);
  const deployments = data?.deployments ?? [];

  if (isLoading) return <p className="p-4 text-sm text-muted">Loading deployments…</p>;
  if (deployments.length === 0) return <p className="p-4 text-sm text-muted">No deployments recorded yet.</p>;

  return (
    <div className="divide-y divide-border">
      {deployments.map((deployment) => (
        <div key={deployment.id} className="flex items-center justify-between px-4 py-3 text-sm">
          <div>
            <p className={STATUS_CLASSES[deployment.status]}>{deployment.status}</p>
            {deployment.commit && <p className="font-mono text-xs text-muted">{deployment.commit.slice(0, 7)}</p>}
          </div>
          <div className="text-right text-xs text-muted">
            {deployment.startedAt && <p>{new Date(deployment.startedAt).toLocaleString()}</p>}
            {formatDuration(deployment.startedAt, deployment.finishedAt) && <p>{formatDuration(deployment.startedAt, deployment.finishedAt)}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
