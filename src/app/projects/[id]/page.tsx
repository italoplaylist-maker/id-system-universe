"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { useProjectDetail, useUpdateProject, useDeleteProject } from "@/hooks/use-projects";
import { useActivity } from "@/hooks/use-activity";
import { useUiStore } from "@/store/ui-store";
import { ApplicationPanel } from "@/components/applications/application-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectHealthBadge } from "@/components/ui/project-health-badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useBillingSummary, useCharges } from "@/hooks/use-billing";
import { useDeploymentRuns, useResourceRepository } from "@/hooks/use-github-repos";
import { canUser } from "@/server/auth/rbac";
import { formatBRL } from "@/lib/money";
import { ChargesTable } from "@/components/billing/charges-table";
import { ChargeDrawer } from "@/components/billing/charge-drawer";
import { ChargeFormDialog } from "@/components/billing/charge-form-dialog";
import { cn } from "@/lib/cn";

type Tab = "overview" | "resources" | "github" | "billing" | "activity";

const TAB_LABEL: Record<Tab, string> = { overview: "Visão geral", resources: "Resources", github: "GitHub", billing: "Financeiro", activity: "Atividade" };

function EditProjectDialog({ project }: { project: { id: string; name: string; description: string | null } }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const updateProject = useUpdateProject();

  async function handleSave() {
    try {
      await updateProject.mutateAsync({ id: project.id, name, description: description || null });
      toast.success("Project updated.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update project.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit Project">
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          <Button variant="primary" className="w-full" onClick={handleSave} disabled={updateProject.isPending}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectGitHubRow({ resource }: { resource: { id: string; name: string; resourceType: string } }) {
  const selectApplication = useUiStore((s) => s.selectApplication);
  const requestTab = useUiStore((s) => s.requestTab);
  const deployable = resource.resourceType === "APPLICATION";
  const { data: repository } = useResourceRepository(deployable ? resource.id : null);
  const { data: runs } = useDeploymentRuns(deployable ? resource.id : null);
  const production = runs?.production;

  return (
    <button
      onClick={() => {
        selectApplication(resource.id);
        requestTab("github");
      }}
      disabled={!deployable}
      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-surface-raised disabled:cursor-default disabled:opacity-60"
    >
      <div className="min-w-0">
        <p className="font-medium">{resource.name}</p>
        <p className="truncate text-xs text-muted">
          {!deployable ? "Sem deploy via Git" : repository ? `${repository.repositoryFullName} · ${repository.branch} · Auto Deploy ${repository.autoDeploy ? "ativo" : "desligado"}` : "Sem repositório vinculado"}
        </p>
      </div>
      <p className="shrink-0 text-xs text-muted">{production?.commitSha ? <>Em produção: <span className="font-mono">{production.commitSha.slice(0, 7)}</span></> : ""}</p>
    </button>
  );
}

function ProjectBilling({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { data: summary } = useBillingSummary({ projectId });
  const { data: charges } = useCharges({ projectId });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {summary ? `A receber ${formatBRL(summary.toReceiveCents)} · Vencido ${formatBRL(summary.overdueCents)}` : "Carregando…"}
        </p>
        {canManage && <ChargeFormDialog defaultProjectId={projectId} />}
      </div>
      <ChargesTable items={charges?.items ?? []} onOpen={setOpen} emptyText="Nenhuma cobrança vinculada a este projeto." />
      <ChargeDrawer chargeId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: project, isLoading } = useProjectDetail(id);
  const { data: activity } = useActivity(30, id);
  const deleteProject = useDeleteProject();
  const selectApplication = useUiStore((s) => s.selectApplication);
  const { data: user } = useSession();
  const canSeeBilling = user ? canUser(user, "billing:view") : false;
  const canManageBilling = user ? canUser(user, "billing:manage") : false;
  const tabs: Tab[] = canSeeBilling ? ["overview", "resources", "github", "billing", "activity"] : ["overview", "resources", "github", "activity"];

  if (isLoading || !project) {
    return <div className="min-h-screen bg-background p-6 text-sm text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/projects" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
          ← Projects
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: project.accent }} aria-hidden />
            <h1 className="text-lg font-semibold">{project.name}</h1>
            <EditProjectDialog project={project} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3.5 w-3.5 text-status-error" />
          </Button>
        </div>
        {project.description && <p className="text-sm text-muted">{project.description}</p>}
      </header>

      <div className="flex border-b border-border px-6">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {tab === "overview" && (
          <div className="space-y-6">
            <ProjectHealthBadge health={project.health} />
            <div className="grid grid-cols-3 gap-4">
              <Card className="p-4 text-center">
                <p className="text-2xl font-semibold">{project.resourceCount}</p>
                <p className="text-xs text-muted">Resources</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-2xl font-semibold">{project.resources.filter((r) => r.status === "RUNNING").length}</p>
                <p className="text-xs text-muted">Running</p>
              </Card>
              <Card className="p-4 text-center">
                <p className="text-2xl font-semibold">{project.providerCount}</p>
                <p className="text-xs text-muted">Providers</p>
              </Card>
            </div>
          </div>
        )}

        {tab === "resources" && (
          <Card className="divide-y divide-border">
            {project.resources.map((resource) => (
              <button
                key={resource.id}
                onClick={() => selectApplication(resource.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-surface-raised"
              >
                <div>
                  <p className="font-medium">{resource.name}</p>
                  <p className="text-xs text-muted">{resource.providerName}</p>
                </div>
                <StatusBadge status={resource.status} />
              </button>
            ))}
            {project.resources.length === 0 && <p className="p-4 text-sm text-muted">No resources assigned yet.</p>}
          </Card>
        )}

        {tab === "github" && (
          <Card className="divide-y divide-border">
            {project.resources.map((resource) => (
              <ProjectGitHubRow key={resource.id} resource={resource} />
            ))}
            {project.resources.length === 0 && <p className="p-4 text-sm text-muted">Nenhum resource neste projeto.</p>}
          </Card>
        )}

        {tab === "billing" && canSeeBilling && <ProjectBilling projectId={project.id} canManage={canManageBilling} />}

        {tab === "activity" && (
          <Card className="divide-y divide-border">
            {activity?.universeEvents.map((event) => (
              <div key={event.id} className="px-4 py-3 text-sm">
                <p>{event.message}</p>
                <p className="mt-0.5 text-xs text-muted">{new Date(event.createdAt).toLocaleString()}</p>
              </div>
            ))}
            {activity?.universeEvents.length === 0 && <CardContent className="text-sm text-muted">No activity yet.</CardContent>}
          </Card>
        )}
      </main>

      <ApplicationPanel />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${project.name}?`}
        description="Its resources are not deleted — they become Unassigned again. This only removes the project grouping."
        confirmLabel="Delete Project"
        requireTypedConfirmation={project.name}
        danger
        onConfirm={async () => {
          await deleteProject.mutateAsync(project.id);
          toast.success(`${project.name} deleted.`);
          router.push("/projects");
        }}
      />
    </div>
  );
}
