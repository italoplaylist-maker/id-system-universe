"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";

interface Payload {
  id: string;
  kind: string;
  level: "success" | "error" | "warning" | "info";
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * Pop-ups em tempo real (deploy concluído, agente terminou, pedido de aprovação…) em qualquer tela.
 * Vem do servidor por SSE e só traz o que o usuário pode ver. O push do celular/computador usa o mesmo aviso.
 */
export function NotificationBridge() {
  const pathname = usePathname();
  // Nas telas de login/onboarding nem consulta a sessão (não polui o cache de "quem sou eu").
  const publicPage = pathname === "/login" || pathname.startsWith("/onboarding");
  const { data: user } = useSession(!publicPage);
  const loggedIn = !!user && !publicPage;
  useEffect(() => {
    if (!loggedIn || typeof EventSource === "undefined") return;
    const es = new EventSource("/api/notifications/stream");
    const seen = new Set<string>();
    es.addEventListener("notify", (ev) => {
      let p: Payload;
      try {
        p = JSON.parse((ev as MessageEvent).data) as Payload;
      } catch {
        return;
      }
      if (seen.has(p.id)) return;
      seen.add(p.id);
      const options = {
        id: p.tag, // mesma tag substitui o pop-up anterior em vez de empilhar
        description: p.body || undefined,
        duration: p.kind === "approval" ? 30_000 : p.level === "error" ? 12_000 : 8_000,
        action: p.url && p.url !== "/" ? { label: "Abrir", onClick: () => window.location.assign(p.url) } : undefined,
      };
      if (p.level === "success") toast.success(p.title, options);
      else if (p.level === "error") toast.error(p.title, options);
      else if (p.level === "warning") toast.warning(p.title, options);
      else toast.info(p.title, options);
    });
    return () => es.close();
  }, [loggedIn]);
  return null;
}
