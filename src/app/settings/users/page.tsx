"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, KeyRound, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCreateUser, useUpdateUser, useUsers, type UserRow } from "@/hooks/use-users";
import { useSession } from "@/hooks/use-session";
import { useProjects } from "@/hooks/use-projects";
import { ROLES, ROLE_LABEL, type Role } from "@/lib/roles";
import { MIN_PASSWORD_LENGTH_CLIENT } from "@/lib/constants";
import { ApiClientError } from "@/lib/api-client";
import { canUser } from "@/server/auth/rbac";

const GLOBAL_ROLES: Role[] = ["SUPERADMIN", "ADMIN"];
const ROLE_HINT: Record<Role, string> = {
  SUPERADMIN: "Acesso global total, inclusive financeiro e integrações.",
  ADMIN: "Gerencia a plataforma em todos os projetos (sem acesso financeiro, salvo permissão extra).",
  OPERATOR: "Opera (deploy, reiniciar, parar, iniciar) somente nos projetos selecionados.",
  VIEWER: "Somente consulta, apenas nos projetos selecionados.",
};

function ProjectPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { data: projects } = useProjects();
  const all = projects?.map((p) => p.id) ?? [];
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted">Projetos com acesso ({selected.length}/{all.length})</span>
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-accent hover:underline disabled:pointer-events-none" disabled={disabled} onClick={() => onChange(all)}>
            Selecionar todos
          </button>
          <button type="button" className="text-muted hover:underline disabled:pointer-events-none" disabled={disabled} onClick={() => onChange([])}>
            Limpar seleção
          </button>
        </div>
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {projects?.length === 0 && <p className="text-xs text-muted">Nenhum projeto cadastrado.</p>}
        {projects?.map((project) => (
          <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-raised">
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(project.id)}
              onChange={(e) => onChange(e.target.checked ? [...selected, project.id] : selected.filter((id) => id !== project.id))}
            />
            {project.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function RoleSelect({ value, onChange, actorIsSuperadmin, disabled }: { value: Role; onChange: (role: Role) => void; actorIsSuperadmin: boolean; disabled?: boolean }) {
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Role)}>
      {ROLES.filter((r) => actorIsSuperadmin || r !== "SUPERADMIN" || value === "SUPERADMIN").map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </Select>
  );
}

function BillingPermissions({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const level = value.includes("BILLING_MANAGE") ? "MANAGE" : value.includes("BILLING_VIEW") ? "VIEW" : "NONE";
  return (
    <Field label="Financeiro (Central de Cobranças)" hint="Sempre limitado aos projetos permitidos.">
      <Select
        value={level}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "MANAGE" ? ["BILLING_MANAGE"] : e.target.value === "VIEW" ? ["BILLING_VIEW"] : [])}
      >
        <option value="NONE">Sem acesso</option>
        <option value="VIEW">Visualizar (BILLING_VIEW)</option>
        <option value="MANAGE">Gerenciar — criar, editar, receber e enviar (BILLING_MANAGE)</option>
      </Select>
    </Field>
  );
}

function CreateUserDialog({ actorIsSuperadmin }: { actorIsSuperadmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const createUser = useCreateUser();
  const isGlobal = GLOBAL_ROLES.includes(role);

  async function handleCreate() {
    try {
      await createUser.mutateAsync({ email, password, role, projectIds: isGlobal ? [] : projectIds, ...(actorIsSuperadmin ? { extraPermissions: extra } : {}) });
      toast.success(`${email} criado.`);
      setOpen(false);
      setEmail("");
      setPassword("");
      setRole("OPERATOR");
      setProjectIds([]);
      setExtra([]);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível criar o usuário.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </DialogTrigger>
      <DialogContent title="Novo usuário" description="A pessoa poderá entrar imediatamente com esta senha.">
        <div className="space-y-3">
          <Field label="E-mail">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={`Senha (mín. ${MIN_PASSWORD_LENGTH_CLIENT} caracteres)`}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Perfil" hint={ROLE_HINT[role]}>
            <RoleSelect value={role} onChange={setRole} actorIsSuperadmin={actorIsSuperadmin} />
          </Field>
          {isGlobal ? <p className="rounded-md border border-border px-3 py-2 text-xs text-muted">Este perfil tem acesso global: todos os projetos.</p> : <ProjectPicker selected={projectIds} onChange={setProjectIds} />}
          {actorIsSuperadmin && <BillingPermissions value={extra} onChange={setExtra} />}
          <Button variant="primary" className="w-full" disabled={!email || password.length < MIN_PASSWORD_LENGTH_CLIENT || createUser.isPending} onClick={handleCreate}>
            {createUser.isPending ? "Criando…" : "Criar usuário"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditAccessDialog({ user, open, onOpenChange, actorIsSuperadmin }: { user: UserRow; open: boolean; onOpenChange: (open: boolean) => void; actorIsSuperadmin: boolean }) {
  const [role, setRole] = useState<Role>(user.role);
  const [projectIds, setProjectIds] = useState<string[]>(user.projectIds);
  const [extra, setExtra] = useState<string[]>(user.extraPermissions);
  const updateUser = useUpdateUser();
  const isGlobal = GLOBAL_ROLES.includes(role);
  const lockedSuperadmin = user.role === "SUPERADMIN" && !actorIsSuperadmin;

  async function save() {
    try {
      await updateUser.mutateAsync({
        id: user.id,
        ...(role !== user.role ? { role } : {}),
        projectIds,
        ...(actorIsSuperadmin ? { extraPermissions: extra } : {}),
      });
      toast.success("Acesso atualizado.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível atualizar.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Acesso de ${user.email}`} description="Perfil define O QUE a pessoa pode fazer; os projetos definem ONDE.">
        <div className="space-y-3">
          <Field label="Perfil" hint={ROLE_HINT[role]}>
            <RoleSelect value={role} onChange={setRole} actorIsSuperadmin={actorIsSuperadmin} disabled={lockedSuperadmin} />
          </Field>
          {isGlobal ? <p className="rounded-md border border-border px-3 py-2 text-xs text-muted">Este perfil tem acesso global: todos os projetos.</p> : <ProjectPicker selected={projectIds} onChange={setProjectIds} />}
          {actorIsSuperadmin && <BillingPermissions value={extra} onChange={setExtra} />}
          <Button variant="primary" className="w-full" disabled={updateUser.isPending || lockedSuperadmin} onClick={save}>
            Salvar acesso
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, open, onOpenChange }: { user: UserRow; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState("");
  const updateUser = useUpdateUser();

  async function handleReset() {
    try {
      await updateUser.mutateAsync({ id: user.id, password });
      toast.success(`Senha de ${user.email} redefinida. As sessões ativas foram encerradas.`);
      onOpenChange(false);
      setPassword("");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível redefinir a senha.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Redefinir senha de ${user.email}`} description="Isso encerra todas as sessões ativas da pessoa.">
        <div className="space-y-3">
          <Input type="password" placeholder={`Nova senha (mín. ${MIN_PASSWORD_LENGTH_CLIENT} caracteres)`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <Button variant="primary" className="w-full" disabled={password.length < MIN_PASSWORD_LENGTH_CLIENT || updateUser.isPending} onClick={handleReset}>
            Redefinir senha
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserRowItem({ user, isSelf, actorIsSuperadmin, projectNames }: { user: UserRow; isSelf: boolean; actorIsSuperadmin: boolean; projectNames: Map<string, string> }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const updateUser = useUpdateUser();
  const isGlobal = GLOBAL_ROLES.includes(user.role);
  const locked = user.role === "SUPERADMIN" && !actorIsSuperadmin;

  async function handleToggleActive() {
    try {
      await updateUser.mutateAsync({ id: user.id, active: !user.active });
      toast.success(`${user.email} ${user.active ? "desativado" : "reativado"}.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Não foi possível atualizar o usuário.");
    }
  }

  const projectSummary = isGlobal ? "Todos os projetos" : user.projectIds.length === 0 ? "Nenhum projeto" : user.projectIds.map((id) => projectNames.get(id) ?? "—").join(", ");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {user.email} {isSelf && <span className="text-xs text-muted">(você)</span>}
        </p>
        <p className="truncate text-xs text-muted">
          {ROLE_LABEL[user.role]} · {projectSummary}
          {user.extraPermissions.length > 0 && ` · ${user.extraPermissions.includes("BILLING_MANAGE") ? "Financeiro: gerenciar" : "Financeiro: visualizar"}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!user.active && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase text-muted">Inativo</span>}
        <Button variant="secondary" size="sm" disabled={isSelf || locked} onClick={() => setAccessOpen(true)}>
          <ShieldCheck className="h-3.5 w-3.5" /> Acesso
        </Button>
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => setResetOpen(true)} aria-label="Redefinir senha">
          <KeyRound className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" disabled={isSelf || locked} onClick={() => (user.active ? setConfirmDeactivate(true) : handleToggleActive())}>
          {user.active ? "Desativar" : "Reativar"}
        </Button>
      </div>

      {accessOpen && <EditAccessDialog key={`${user.id}-${user.role}-${user.projectIds.join()}-${user.extraPermissions.join()}`} user={user} open={accessOpen} onOpenChange={setAccessOpen} actorIsSuperadmin={actorIsSuperadmin} />}
      <ResetPasswordDialog user={user} open={resetOpen} onOpenChange={setResetOpen} />
      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Desativar ${user.email}?`}
        description="A pessoa será desconectada imediatamente e não poderá entrar até ser reativada."
        confirmLabel="Desativar"
        danger
        onConfirm={handleToggleActive}
      />
    </div>
  );
}

export default function UsersPage() {
  const { data: currentUser, isLoading: sessionLoading } = useSession();
  const canManage = currentUser ? canUser(currentUser, "user:manage") : false;
  const { data: users, isLoading } = useUsers();
  const { data: projects } = useProjects();
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  if (!sessionLoading && !canManage) {
    return <p className="text-sm text-muted">Somente administradores podem gerenciar usuários.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Controle de acesso</p>
          <h2 className="text-xl font-semibold">Usuários</h2>
        </div>
        <CreateUserDialog actorIsSuperadmin={currentUser?.role === "SUPERADMIN"} />
      </div>

      {isLoading && <p className="text-sm text-muted">Carregando…</p>}

      <Card className="divide-y divide-border">
        {users?.map((user) => (
          <UserRowItem key={user.id} user={user} isSelf={user.id === currentUser?.id} actorIsSuperadmin={currentUser?.role === "SUPERADMIN"} projectNames={projectNames} />
        ))}
      </Card>
    </div>
  );
}
