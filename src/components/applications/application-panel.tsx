"use client";

import { useState } from "react";
import { toast } from "sonner";
import { X, ExternalLink, ChevronDown } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useUiStore } from "@/store/ui-store";
import { useSession } from "@/hooks/use-session";
import {
  useApplicationDetail,
  useRedeployApplication,
  useRestartApplication,
  useStartApplication,
  useStopApplication,
} from "@/hooks/use-applications";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LogsTerminal } from "@/components/terminal/logs-terminal";
import { DeploymentList } from "@/components/deployments/deployment-list";
import { can } from "@/server/auth/rbac";
import { cn } from "@/lib/cn";
import { ApiClientError } from "@/lib/api-client";

type Tab = "overview" | "logs" | "deployments";
type PendingConfirm = "start" | "stop" | "restart" | "redeploy" | "force-redeploy" | null;

export function ApplicationPanel() {
  const { selectedApplicationId, selectApplication, requestedTab } = useUiStore();
  const { data: user } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  // Applying an external "open to this tab" request during render (not in an
  // effect) avoids an extra cascading render; the token guards against the
  // same tab being requested twice in a row (e.g. "Logs" for two different
  // applications) while never needing to clear the shared store value.
  const [appliedRequestToken, setAppliedRequestToken] = useState<number | null>(null);
  if (requestedTab && requestedTab.token !== appliedRequestToken) {
    setAppliedRequestToken(requestedTab.token);
    setTab(requestedTab.tab);
  }

  const { data: app } = useApplicationDetail(selectedApplicationId);
  const start = useStartApplication();
  const stop = useStopApplication();
  const restart = useRestartApplication();
  const redeploy = useRedeployApplication();

  if (!selectedApplicationId) return null;

  function close() {
    selectApplication(null);
    setTab("overview");
  }

  function reportError(error: unknown, fallback: string) {
    toast.error(error instanceof ApiClientError ? error.message : fallback);
  }

  async function runAction(kind: Exclude<PendingConfirm, null>) {
    if (!app) return;
    try {
      if (kind === "start") await start.mutateAsync(app.id);
      if (kind === "stop") await stop.mutateAsync(app.id);
      if (kind === "restart") await restart.mutateAsync(app.id);
      if (kind === "redeploy") await redeploy.mutateAsync({ id: app.id, force: false });
      if (kind === "force-redeploy") await redeploy.mutateAsync({ id: app.id, force: true });
      toast.success(`${app.name}: ${kind.replace("-", " ")} requested.`);
    } catch (error) {
      reportError(error, `Could not ${kind} ${app.name}.`);
    }
  }

  const role = user?.role;
  const busy = app?.pendingOperation != null;
  // Redeploy/logs/deployment history only make sense for a git-deployed
  // Application — a Service or Database is "redeployed" by restarting it,
  // and Coolify doesn't expose a build/deploy history for either.
  const isDeployable = app?.resourceType === "APPLICATION";
  const canStart = role && can(role, "application:start");
  const canStop = role && can(role, "application:stop");
  const canRestart = role && can(role, "application:restart");
  const canRedeploy = isDeployable && role && can(role, "application:redeploy");
  const canForceRedeploy = isDeployable && role && can(role, "application:force-redeploy");
  const tabs = isDeployable ? (["overview", "logs", "deployments"] as const) : (["overview", "logs"] as const);
  // Switching from an Application to a Service/Database while "Deployments" is open shouldn't render a tab that no longer exists.
  const activeTab = tab === "deployments" && !isDeployable ? "overview" : tab;

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-surface-raised shadow-2xl">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{app?.name ?? "…"}</h2>
            {app?.fqdn && (
              <a href={`https://${app.fqdn}`} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          {app && <StatusBadge status={app.status} className="mt-1.5" />}
        </div>
        <button onClick={close} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex border-b border-border text-sm">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("flex-1 border-b-2 px-3 py-2 capitalize", activeTab === t ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {t === "logs" ? "Runtime Logs" : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "overview" && app && (
          <div className="space-y-4 overflow-y-auto p-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Provider</dt>
                <dd>{app.providerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Branch</dt>
                <dd>{app.branch ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Repository</dt>
                <dd className="truncate">{app.repository ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Last deployment</dt>
                <dd>{app.lastDeployedAt ? new Date(app.lastDeployedAt).toLocaleString() : "—"}</dd>
              </div>
            </dl>

            {busy && (
              <p className="rounded-md border border-status-deploying/30 bg-status-deploying/10 px-3 py-2 text-xs text-status-deploying">
                Operation in progress ({app.pendingOperation?.toLowerCase()})…
              </p>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              {canStart && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => runAction("start")}>
                  Start
                </Button>
              )}
              {canStop && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPendingConfirm("stop")}>
                  Stop
                </Button>
              )}
              {canRestart && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPendingConfirm("restart")}>
                  Restart
                </Button>
              )}
              {canRedeploy && (
                <div className="flex">
                  <Button variant="primary" size="sm" className="flex-1 rounded-r-none" disabled={busy} onClick={() => setPendingConfirm("redeploy")}>
                    Redeploy
                  </Button>
                  {canForceRedeploy && (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger asChild>
                        <Button variant="primary" size="sm" className="rounded-l-none border-l border-black/20 px-2" disabled={busy}>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content className="z-50 rounded-md border border-border bg-surface-raised p-1 shadow-xl" align="end">
                          <DropdownMenu.Item
                            className="cursor-pointer rounded px-3 py-2 text-xs text-foreground outline-none hover:bg-surface"
                            onSelect={() => setPendingConfirm("force-redeploy")}
                          >
                            Redeploy without cache
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "logs" && <LogsTerminal applicationId={selectedApplicationId} />}
        {activeTab === "deployments" && isDeployable && <DeploymentList applicationId={selectedApplicationId} />}
      </div>

      <ConfirmDialog
        open={pendingConfirm === "stop"}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
        title={`Stop ${app?.name}?`}
        description="The application will be temporarily unavailable."
        confirmLabel="Stop"
        danger
        onConfirm={() => runAction("stop")}
      />
      <ConfirmDialog
        open={pendingConfirm === "restart"}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
        title={`Restart ${app?.name}?`}
        description="The application will be temporarily unavailable."
        confirmLabel="Restart"
        onConfirm={() => runAction("restart")}
      />
      <ConfirmDialog
        open={pendingConfirm === "redeploy"}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
        title={`Redeploy ${app?.name}?`}
        description="A new deployment will be triggered from the current branch."
        confirmLabel="Redeploy"
        onConfirm={() => runAction("redeploy")}
      />
      <ConfirmDialog
        open={pendingConfirm === "force-redeploy"}
        onOpenChange={(open) => !open && setPendingConfirm(null)}
        title={`Redeploy ${app?.name} without cache?`}
        description="Rebuilding without cache can take significantly longer than a normal deploy."
        confirmLabel="Redeploy without cache"
        danger
        onConfirm={() => runAction("force-redeploy")}
      />
    </div>
  );
}
