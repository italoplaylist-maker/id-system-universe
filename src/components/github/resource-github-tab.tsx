"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/select";
import { ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import {
  useDeploymentRuns,
  useGitHubBranches,
  useGitHubRepositories,
  useRemoveResourceRepository,
  useResourceRepository,
  useSetResourceRepository,
} from "@/hooks/use-github-repos";
import { canUser } from "@/server/auth/rbac";
import { formatDateTimeBR } from "@/components/billing/status";
import type { DeploymentRunSummary } from "@/server/deployments/deployment-runs";
import type { ResourceRepositoryView } from "@/server/github/resource-repository";

const TRIGGER_LABEL = { MANUAL: "Manual", GITHUB_PUSH: "GitHub · push", GITHUB_MERGE: "GitHub · merge" } as const;
const RUN_STATUS_LABEL = { QUEUED: "Na fila", RUNNING: "Implantando", SUCCESS: "Sucesso", FAILED: "Falhou", CANCELLED: "Cancelado", SUPERSEDED: "Substituído" } as const;
const RUN_STATUS_CLASS: Record<DeploymentRunSummary["status"], string> = {
  QUEUED: "text-muted",
  RUNNING: "text-status-deploying",
  SUCCESS: "text-status-running",
  FAILED: "text-status-error",
  CANCELLED: "text-muted",
  SUPERSEDED: "text-muted",
};

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

function ProductionVersion({ applicationId }: { applicationId: string }) {
  const { data } = useDeploymentRuns(applicationId);
  const production = data?.production;
  return (
    <section className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Versão em produção</h3>
      {production ? (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Commit</dt>
            <dd className="font-mono">
              {production.commitUrl ? (
                <a href={production.commitUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-accent">
                  {short(production.commitSha)} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                short(production.commitSha)
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Branch</dt>
            <dd>{production.branch ?? "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-muted">Implantado</dt>
            <dd>
              {formatDateTimeBR(production.finishedAt)} · {TRIGGER_LABEL[production.triggerSource]}
            </dd>
          </div>
          {production.commitMessage && (
            <div className="col-span-2">
              <dt className="text-xs text-muted">Mensagem</dt>
              <dd className="truncate">{production.commitMessage}{production.commitAuthor ? ` — ${production.commitAuthor}` : ""}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted">Nenhum deploy concluído com sucesso ainda.</p>
      )}
      {data?.queued && (
        <p className="mt-3 rounded border border-status-deploying/30 bg-status-deploying/10 px-2 py-1.5 text-xs text-status-deploying">
          Nova versão na fila: <span className="font-mono">{short(data.queued.commitSha)}</span> ({data.queued.branch})
        </p>
      )}
    </section>
  );
}

function RepositoryForm({ applicationId, current, canEdit }: { applicationId: string; current: ResourceRepositoryView | null; canEdit: boolean }) {
  const { data: repositories } = useGitHubRepositories(canEdit);
  const save = useSetResourceRepository(applicationId);
  const remove = useRemoveResourceRepository(applicationId);
  const [repositoryId, setRepositoryId] = useState(current?.githubRepositoryId ?? "");
  const [branch, setBranch] = useState(current?.branch ?? "");
  const [autoDeploy, setAutoDeploy] = useState(current?.autoDeploy ?? false);
  const [onPush, setOnPush] = useState(current?.onPush ?? true);
  const [onMerge, setOnMerge] = useState(current?.onMerge ?? true);
  const { data: branches, isError: branchesFailed } = useGitHubBranches(canEdit && repositoryId ? repositoryId : null);

  const selected = repositories?.find((r) => r.id === repositoryId);

  async function submit() {
    try {
      await save.mutateAsync({ githubRepositoryId: repositoryId, branch, autoDeploy, onPush, onMerge });
      toast.success("Repositório vinculado.");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível salvar.");
    }
  }

  if (!canEdit) {
    return (
      <section className="rounded-md border border-border p-3 text-sm">
        <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Repositório</h3>
        {current ? (
          <p>
            {current.repositoryFullName} · {current.branch} · Auto Deploy {current.autoDeploy ? "ativo" : "desligado"}
          </p>
        ) : (
          <p className="text-muted">Nenhum repositório vinculado.</p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-md border border-border p-3">
      <h3 className="text-xs uppercase tracking-[0.2em] text-muted">Repositório e Auto Deploy</h3>
      {repositories?.length === 0 && <p className="text-xs text-muted">Nenhum repositório disponível. Conecte o GitHub em Configurações → Integrações.</p>}
      <Field label="Repositório">
        <Select
          value={repositoryId}
          onChange={(e) => {
            setRepositoryId(e.target.value);
            setBranch(repositories?.find((r) => r.id === e.target.value)?.defaultBranch ?? "");
          }}
        >
          <option value="">Selecione…</option>
          {repositories?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Branch" hint={branchesFailed ? "Não foi possível listar as branches agora; digite o nome." : selected ? `Padrão do repositório: ${selected.defaultBranch ?? "—"}` : undefined}>
        {branches && branches.length > 0 ? (
          <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
            {!branches.includes(branch) && branch && <option value={branch}>{branch}</option>}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        ) : (
          <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} /> Deploy automático
      </label>
      {autoDeploy && (
        <div className="ml-6 space-y-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={onPush} onChange={(e) => setOnPush(e.target.checked)} /> Push</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={onMerge} onChange={(e) => setOnMerge(e.target.checked)} /> Merge</label>
          <p className="text-xs text-muted">Um merge que também gera push implanta o commit uma única vez.</p>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={submit} disabled={!repositoryId || !branch || save.isPending}>
          Salvar
        </Button>
        {current && (
          <Button variant="ghost" size="sm" onClick={() => remove.mutate(undefined, { onSuccess: () => toast.success("Vínculo removido.") })} disabled={remove.isPending}>
            Remover vínculo
          </Button>
        )}
      </div>
    </section>
  );
}

export function ResourceGitHubTab({ applicationId }: { applicationId: string }) {
  const { data: user } = useSession();
  const { data: current, isLoading } = useResourceRepository(applicationId);
  const { data: runs } = useDeploymentRuns(applicationId);
  const canEdit = user ? canUser(user, "project:write") : false;

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <ProductionVersion applicationId={applicationId} />
      {!isLoading && <RepositoryForm key={`${current?.githubRepositoryId}-${current?.branch}-${current?.autoDeploy}-${current?.onPush}-${current?.onMerge}`} applicationId={applicationId} current={current ?? null} canEdit={canEdit} />}
      <section>
        <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-muted">Últimos deploys</h3>
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {runs?.runs.map((run) => (
            <li key={run.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate">
                  <span className="font-mono">{short(run.commitSha)}</span> {run.commitMessage ?? ""}
                </p>
                <p className="text-xs text-muted">
                  {TRIGGER_LABEL[run.triggerSource]} · {formatDateTimeBR(run.receivedAt)}
                </p>
              </div>
              <span className={`shrink-0 text-xs ${RUN_STATUS_CLASS[run.status]}`}>{RUN_STATUS_LABEL[run.status]}</span>
            </li>
          ))}
          {runs?.runs.length === 0 && <li className="px-3 py-2 text-muted">Nenhum deploy registrado.</li>}
        </ul>
      </section>
    </div>
  );
}
