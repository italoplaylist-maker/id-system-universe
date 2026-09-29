"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2, RefreshCw, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useDeleteProvider, useTestProviderConnection, useUpdateProvider } from "@/hooks/use-providers";
import type { UniverseProviderSummary } from "@/types/domain";

const HEALTH_CONFIG: Record<UniverseProviderSummary["health"], { label: string; dot: string }> = {
  ONLINE: { label: "Online", dot: "bg-status-running" },
  DEGRADED: { label: "Degraded", dot: "bg-status-warning" },
  OFFLINE: { label: "Offline", dot: "bg-status-error" },
  UNKNOWN: { label: "Unknown", dot: "bg-status-unknown" },
};

export function ProviderCard({ provider }: { provider: UniverseProviderSummary }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState(provider.name);
  const [token, setToken] = useState("");

  const testConnection = useTestProviderConnection();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();

  const health = HEALTH_CONFIG[provider.health];

  async function handleTest() {
    try {
      const result = await testConnection.mutateAsync(provider.id);
      if (result.ok) toast.success(`${provider.name}: connected (${result.latencyMs}ms).`);
      else toast.error(result.error ?? "Connection failed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Connection test failed.");
    }
  }

  async function handleToggleEnabled() {
    await updateProvider.mutateAsync({ id: provider.id, enabled: !provider.enabled });
  }

  async function handleSaveEdit() {
    try {
      await updateProvider.mutateAsync({ id: provider.id, name, token: token || undefined });
      toast.success("Provider updated.");
      setEditOpen(false);
      setToken("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update provider.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: provider.color }} aria-hidden />
          <h3 className="text-sm font-semibold">{provider.name}</h3>
          {!provider.enabled && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase text-muted">Disabled</span>}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${health.dot}`} aria-hidden />
          {health.label}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="truncate font-mono text-xs text-muted">{provider.baseUrl}</p>
        <div className="flex items-center justify-between text-sm">
          <span>
            {provider.applicationCount} resources · {provider.projectCount} projects
          </span>
          {provider.latencyMs !== null && <span className="text-muted">{provider.latencyMs}ms</span>}
        </div>
        {provider.lastError && <p className="text-xs text-status-error">{provider.lastError}</p>}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={handleTest} disabled={testConnection.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 ${testConnection.isPending ? "animate-spin" : ""}`} />
            </Button>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </DialogTrigger>
              <DialogContent title={`Edit ${provider.name}`}>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-muted">Name</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted">New API Token (leave blank to keep current)</label>
                    <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={provider.maskedToken} />
                  </div>
                  <Button variant="primary" className="w-full" onClick={handleSaveEdit} disabled={updateProvider.isPending}>
                    Save
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="sm" onClick={handleToggleEnabled}>
              {provider.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5 text-status-error" />
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${provider.name}?`}
        description="This removes the provider and its cached applications from the Universe. Nothing is deleted on Coolify itself."
        confirmLabel="Delete Provider"
        requireTypedConfirmation={provider.name}
        danger
        onConfirm={async () => {
          await deleteProvider.mutateAsync(provider.id);
          toast.success(`${provider.name} removed.`);
        }}
      />
    </Card>
  );
}
