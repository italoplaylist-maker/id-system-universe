"use client";

import { useMemo } from "react";
import type { HqLayout } from "./hq-layout";
import { buildCorridorPath } from "./hq-layout";
import { TaskAgentController, type TaskAgentState } from "./task-agent-controller";
import type { UniverseApplication } from "@/types/domain";

function stateFor(app: UniverseApplication): TaskAgentState | null {
  if (app.pendingOperation === "REDEPLOY" || app.pendingOperation === "FORCE_REDEPLOY") return "DEPLOYING";
  if (app.pendingOperation) return "WORKING";
  if (app.status === "ERROR") return "ERROR";
  return null;
}

interface TaskAgentsProps {
  layout: HqLayout;
  applications: UniverseApplication[];
  workstationPositions: Map<string, [number, number]>;
}

/**
 * One employee per resource with a real operation in flight (or in error).
 * Keyed by resource id so identity survives polling refreshes — the walk
 * continues rather than restarting every few seconds.
 */
export function TaskAgents({ layout, applications, workstationPositions }: TaskAgentsProps) {
  const busy = useMemo(
    () =>
      applications
        .map((app) => ({ app, state: stateFor(app) }))
        .filter((entry): entry is { app: UniverseApplication; state: TaskAgentState } => entry.state !== null),
    [applications],
  );

  return (
    <>
      {busy.map(({ app, state }) => {
        if (!app.projectId) return null;
        const workstation = workstationPositions.get(app.id);
        if (!workstation) return null;
        const path = buildCorridorPath(layout, "operations", app.projectId);
        if (path.length === 0) return null;
        const waypoints: [number, number][] = [...path.slice(0, -1), workstation];
        return <TaskAgentController key={app.id} waypoints={waypoints} state={state} />;
      })}
    </>
  );
}
