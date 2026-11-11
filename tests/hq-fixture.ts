import { computeAgentPods, computeOfficeLayout } from "../src/components/universe/hq/office/office-layout";
import { officePropObstacles } from "../src/components/universe/hq/office/office-props";
import { computeHqPlan } from "../src/components/universe/hq/plan/hq-plan";
import { ATRIUM_WANDER, atriumObstacles } from "../src/components/universe/hq/plan/atrium-layout";
import { CLT_ROOM, computeCltLayout } from "../src/components/universe/hq/plan/clt-layout";
import { buildLifeWorldFromPlan } from "../src/components/universe/hq/life/world";
import { partitionDoorZ } from "../src/components/universe/hq/office/office-shell";

/** Mesma montagem do hq-scene: alas tecnológica, operacional e AGENTES CLT em volta do átrio. */
export function hqFixture(nProjects: number, nAgents: number, nClt = 7, nCom = 4) {
  const projects = Array.from({ length: nProjects }, (_, i) => ({ id: `p${i}`, name: `Projeto ${i}`, accent: "#38bdf8" }));
  const agents = Array.from({ length: nAgents }, (_, i) => ({ id: `a${i}`, name: `Agente ${i}`, accent: "#e8283f" }));
  const clt = Array.from({ length: nClt }, (_, i) => ({ id: `c${i}` }));
  const com = Array.from({ length: nCom }, (_, i) => ({ id: `m${i}` }));
  const tech = computeOfficeLayout(projects, [{ id: "r1", name: "VPS", color: "#34d399" }]);
  const pods = computeAgentPods(agents);
  const cltLayout = computeCltLayout(nClt, nCom);
  const plan = computeHqPlan({
    tech: { width: tech.width, depth: tech.depth, doorZ: partitionDoorZ(tech.depth) },
    agents: { width: pods.width, depth: pods.depth, doorZ: pods.aisleZ },
    clt: { width: CLT_ROOM.width, depth: CLT_ROOM.depth, doorZ: cltLayout.doorZ },
  });
  const world = buildLifeWorldFromPlan({
    plan,
    techDesks: tech.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z })),
    techObstacles: officePropObstacles(tech),
    agentDesks: pods.desks.map((d) => ({ id: d.projectId, x: d.x, z: d.z, yaw: d.yaw ?? 0 })),
    agentObstacles: pods.rooms.map((r) => ({ kind: "rect" as const, minX: r.x - r.w / 2, maxX: r.x + r.w / 2, minZ: r.z - r.d / 2, maxZ: r.z + r.d / 2 })),
    cltDesks: [...cltLayout.stations.map((s, i) => ({ id: clt[i].id, x: s.x, z: s.z, yaw: s.yaw })), ...cltLayout.commercial.stations.map((s, i) => ({ id: com[i].id, x: s.x, z: s.z, yaw: s.yaw }))],
    cltObstacles: cltLayout.obstacles,
    wander: ATRIUM_WANDER,
    atriumObstacles: atriumObstacles(),
  });
  return { world, plan, projects, agents, clt, com, cltLayout };
}
