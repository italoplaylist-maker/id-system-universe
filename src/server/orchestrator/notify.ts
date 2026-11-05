import { prisma } from "@/server/db/client";
import { notify } from "@/server/notifications/notify";

const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Pop-up/push quando um agente termina, falha ou é interrompido (cancelar é ação sua: não avisa). */
export async function notifyTaskFinished(taskId: string, status: "COMPLETED" | "FAILED" | "INTERRUPTED"): Promise<void> {
  const t = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { agent: { select: { name: true } } } });
  if (!t) return;
  const name = t.agent.name;
  if (status === "COMPLETED") {
    await notify({ kind: "agent", level: "success", title: `${name} terminou`, body: clip(t.result, 160) || clip(t.prompt, 120), url: "/", tag: `agent-task:${t.id}`, audience: { permission: "provider:read", requireGlobal: true } });
  } else {
    await notify({
      kind: "agent",
      level: "error",
      title: status === "FAILED" ? `${name} falhou` : `${name} foi interrompido`,
      body: clip(t.error, 200) || clip(t.prompt, 120),
      url: "/",
      tag: `agent-task:${t.id}`,
      audience: { permission: "provider:read", requireGlobal: true },
    });
  }
}

/** O agente parou esperando você aprovar algo — o aviso mais urgente. */
export async function notifyApprovalRequested(taskId: string, tool: string, detail: string): Promise<void> {
  const t = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { agent: { select: { name: true } } } });
  if (!t) return;
  await notify({
    kind: "approval",
    level: "warning",
    title: `${t.agent.name} pede sua aprovação`,
    body: `${tool}${detail ? ` · ${clip(detail, 140)}` : ""}`,
    url: "/",
    tag: `agent-approval:${taskId}`,
    audience: { permission: "provider:write", requireGlobal: true },
  });
}
