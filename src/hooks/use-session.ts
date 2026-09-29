"use client";

import { useQuery } from "@tanstack/react-query";

export interface CurrentUser {
  id: string;
  email: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
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
