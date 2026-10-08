"use client";

import { useQuery } from "@tanstack/react-query";
import type { Role } from "@/lib/roles";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
  extraPermissions: string[];
}

async function fetchSession(): Promise<CurrentUser | null> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}

export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: fetchSession, staleTime: 60_000 });
}
