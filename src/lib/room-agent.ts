import type { AgentSessionView } from "@/server/claude/agent-service";
import type { RoomAgentView } from "@/server/orchestrator/service";

/** Funcionário permanente → forma que a cena já entende. A animação só representa o estado real do backend. */
export function roomAgentToSession(a: RoomAgentView): AgentSessionView {
  const state = a.state === "RUNNING" || a.state === "RECEIVING" ? "WORKING" : a.state === "WAITING" ? "APPROVAL" : a.state === "ERROR" ? "ERROR" : "IDLE";
  const now = new Date().toISOString();
  return {
    id: a.id,
    feedName: "Central",
    repo: null,
    branch: a.specialty,
    model: a.model,
    state,
    activity: a.state === "RECEIVING" ? `Comando recebido · ${a.currentTask?.prompt.slice(0, 60) ?? ""}` : a.activity ?? (a.state === "ERROR" ? a.lastError : null),
    toolCount: 0,
    failedCount: a.state === "ERROR" ? 1 : 0,
    startedAt: a.lastFinishedAt ?? now,
    lastEventAt: a.lastFinishedAt ?? a.currentTask?.startedAt ?? "1970-01-01T00:00:00.000Z",
    approval: a.approval ? { id: a.approval.id, tool: a.approval.tool, detail: a.approval.detail, createdAt: now } : null,
    profile: { title: a.name, team: a.team, roomState: a.state, queued: a.queued },
  };
}
