"use client";

import { TaskAgent, type TaskAgentState } from "./task-agent";
import type { UniverseApplication } from "@/types/domain";

function stateFor(app: UniverseApplication): TaskAgentState | null {
  if (app.pendingOperation === "REDEPLOY" || app.pendingOperation === "FORCE_REDEPLOY") return "DEPLOYING";
  if (app.pendingOperation) return "WORKING";
  if (app.status === "ERROR") return "ERROR";
  return null;
}

export function TaskAgents({
  applications,
  positions,
}: {
  applications: UniverseApplication[];
  positions: Map<string, [number, number, number]>;
}) {
  return (
    <>
      {applications.map((app) => {
        const state = stateFor(app);
        const position = positions.get(app.id);
        if (!state || !position) return null;
        return <TaskAgent key={app.id} targetPosition={position} state={state} />;
      })}
    </>
  );
}
