"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity, FileText, RotateCw, Rocket, Settings, ListChecks } from "lucide-react";
import { useApplications, useRedeployApplication, useRestartApplication } from "@/hooks/use-applications";
import { useUiStore } from "@/store/ui-store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiClientError } from "@/lib/api-client";
import type { UniverseApplication } from "@/types/domain";

export function CommandPalette() {
  const router = useRouter();
  const { commandPaletteOpen, setCommandPaletteOpen, selectApplication, requestTab } = useUiStore();
  const { data: applications } = useApplications();
  const restart = useRestartApplication();
  const redeploy = useRedeployApplication();

  const [activeApp, setActiveApp] = useState<UniverseApplication | null>(null);
  const [confirmKind, setConfirmKind] = useState<"restart" | "redeploy" | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === "Escape" && activeApp) {
        setActiveApp(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen, activeApp]);

  function closeAll() {
    setCommandPaletteOpen(false);
    setActiveApp(null);
  }

  /** Closes just the palette dialog, keeping `activeApp` so a follow-up ConfirmDialog can reference it. */
  function closePaletteOnly() {
    setCommandPaletteOpen(false);
  }

  function openApp(app: UniverseApplication) {
    selectApplication(app.id);
    closeAll();
  }

  function openLogs(app: UniverseApplication) {
    selectApplication(app.id);
    requestTab("logs");
    closeAll();
  }

  async function runRestart(app: UniverseApplication) {
    try {
      await restart.mutateAsync(app.id);
      toast.success(`${app.name} restart requested.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Restart failed.");
    }
  }

  async function runRedeploy(app: UniverseApplication) {
    try {
      await redeploy.mutateAsync({ id: app.id, force: false });
      toast.success(`${app.name} redeploy requested.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Redeploy failed.");
    }
  }

  return (
    <>
      <Command.Dialog
        open={commandPaletteOpen}
        onOpenChange={(open) => {
          setCommandPaletteOpen(open);
          if (!open) setActiveApp(null);
        }}
        label="Command Palette"
        className="fixed left-1/2 top-32 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-2xl"
      >
        <Command.Input
          autoFocus
          placeholder={activeApp ? `${activeApp.name} — choose an action…` : "Search applications, or type a settings page…"}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="p-4 text-sm text-muted">No results.</Command.Empty>

          {!activeApp && (
            <>
              <Command.Group heading="Applications" className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                {applications?.map((app) => (
                  <Command.Item
                    key={app.id}
                    value={`${app.name} ${app.providerName} ${app.status} ${app.repository ?? ""}`}
                    onSelect={() => setActiveApp(app)}
                    className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface"
                  >
                    <span>{app.name}</span>
                    <span className="text-xs text-muted">
                      {app.providerName} · {app.status}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to" className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
                <Command.Item onSelect={() => { router.push("/settings/infrastructure"); closeAll(); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                  <Settings className="h-3.5 w-3.5" /> Infrastructure Settings
                </Command.Item>
                <Command.Item onSelect={() => { router.push("/activity"); closeAll(); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                  <ListChecks className="h-3.5 w-3.5" /> Activity
                </Command.Item>
              </Command.Group>
            </>
          )}

          {activeApp && (
            <Command.Group heading={activeApp.name} className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
              <Command.Item onSelect={() => openApp(activeApp)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                <Activity className="h-3.5 w-3.5" /> Open
              </Command.Item>
              <Command.Item onSelect={() => openLogs(activeApp)} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                <FileText className="h-3.5 w-3.5" /> Logs
              </Command.Item>
              <Command.Item onSelect={() => { closePaletteOnly(); setConfirmKind("restart"); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                <RotateCw className="h-3.5 w-3.5" /> Restart
              </Command.Item>
              <Command.Item onSelect={() => { closePaletteOnly(); setConfirmKind("redeploy"); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm data-[selected=true]:bg-surface">
                <Rocket className="h-3.5 w-3.5" /> Redeploy
              </Command.Item>
            </Command.Group>
          )}
        </Command.List>
      </Command.Dialog>

      <ConfirmDialog
        open={confirmKind === "restart" && activeApp !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKind(null);
            setActiveApp(null);
          }
        }}
        title={`Restart ${activeApp?.name}?`}
        description="The application will be temporarily unavailable."
        confirmLabel="Restart"
        onConfirm={() => {
          if (activeApp) return runRestart(activeApp);
        }}
      />
      <ConfirmDialog
        open={confirmKind === "redeploy" && activeApp !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmKind(null);
            setActiveApp(null);
          }
        }}
        title={`Redeploy ${activeApp?.name}?`}
        description="A new deployment will be triggered from the current branch."
        confirmLabel="Redeploy"
        onConfirm={() => {
          if (activeApp) return runRedeploy(activeApp);
        }}
      />
    </>
  );
}
