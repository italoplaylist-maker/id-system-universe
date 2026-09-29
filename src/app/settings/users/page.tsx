"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useCreateUser, useUpdateUser, useUsers, type UserRow } from "@/hooks/use-users";
import { useSession } from "@/hooks/use-session";
import { ROLES, type Role } from "@/lib/roles";
import { MIN_PASSWORD_LENGTH_CLIENT } from "@/lib/constants";
import { ApiClientError } from "@/lib/api-client";
import { can } from "@/server/auth/rbac";

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("OPERATOR");
  const createUser = useCreateUser();

  async function handleCreate() {
    try {
      await createUser.mutateAsync({ email, password, role });
      toast.success(`${email} created.`);
      setOpen(false);
      setEmail("");
      setPassword("");
      setRole("OPERATOR");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not create user.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> Add User
        </Button>
      </DialogTrigger>
      <DialogContent title="Add User" description="They can sign in immediately with this password.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Password (min. {MIN_PASSWORD_LENGTH_CLIENT} chars)</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="primary"
            className="w-full"
            disabled={!email || password.length < MIN_PASSWORD_LENGTH_CLIENT || createUser.isPending}
            onClick={handleCreate}
          >
            {createUser.isPending ? "Creating…" : "Create User"}
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
      toast.success(`Password reset for ${user.email}. Their existing sessions were signed out.`);
      onOpenChange(false);
      setPassword("");
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not reset password.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Reset password for ${user.email}`} description="This signs them out of every existing session.">
        <div className="space-y-3">
          <Input type="password" placeholder={`New password (min. ${MIN_PASSWORD_LENGTH_CLIENT} chars)`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button variant="primary" className="w-full" disabled={password.length < MIN_PASSWORD_LENGTH_CLIENT || updateUser.isPending} onClick={handleReset}>
            Reset Password
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UserRowItem({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const updateUser = useUpdateUser();

  async function handleRoleChange(role: Role) {
    try {
      await updateUser.mutateAsync({ id: user.id, role });
      toast.success(`${user.email} is now ${role}.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not change role.");
    }
  }

  async function handleToggleActive() {
    try {
      await updateUser.mutateAsync({ id: user.id, active: !user.active });
      toast.success(`${user.email} ${user.active ? "deactivated" : "reactivated"}.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not update user.");
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm">
      <div>
        <p className="font-medium">
          {user.email} {isSelf && <span className="text-xs text-muted">(you)</span>}
        </p>
        <p className="text-xs text-muted">Since {new Date(user.createdAt).toLocaleDateString()}</p>
      </div>
      <div className="flex items-center gap-2">
        {!user.active && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase text-muted">Inactive</span>}
        <select
          value={user.role}
          disabled={isSelf}
          onChange={(e) => handleRoleChange(e.target.value as Role)}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground disabled:opacity-40"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={() => setResetOpen(true)} aria-label="Reset password">
          <KeyRound className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" disabled={isSelf} onClick={() => (user.active ? setConfirmDeactivate(true) : handleToggleActive())}>
          {user.active ? "Deactivate" : "Reactivate"}
        </Button>
      </div>

      <ResetPasswordDialog user={user} open={resetOpen} onOpenChange={setResetOpen} />
      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`Deactivate ${user.email}?`}
        description="They will be signed out immediately and won't be able to log in until reactivated."
        confirmLabel="Deactivate"
        danger
        onConfirm={handleToggleActive}
      />
    </div>
  );
}

export default function UsersPage() {
  const { data: currentUser, isLoading: sessionLoading } = useSession();
  const canManage = currentUser ? can(currentUser.role, "user:manage") : false;
  const { data: users, isLoading } = useUsers();

  if (!sessionLoading && !canManage) {
    return <p className="text-sm text-muted">Only administrators can manage users.</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Access control</p>
          <h2 className="text-xl font-semibold">Users</h2>
        </div>
        <CreateUserDialog />
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      <Card className="divide-y divide-border">
        {users?.map((user) => (
          <UserRowItem key={user.id} user={user} isSelf={user.id === currentUser?.id} />
        ))}
      </Card>
    </div>
  );
}
