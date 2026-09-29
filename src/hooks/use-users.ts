"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { Role } from "@/lib/roles";

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: UserRow[] }>("/api/users"),
    select: (data) => data.users,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; role: Role }) =>
      apiFetch("/api/users", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; role?: Role; active?: boolean; password?: string }) =>
      apiFetch(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
