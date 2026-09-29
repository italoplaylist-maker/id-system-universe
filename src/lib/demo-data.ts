import type { UniverseApplication, UniverseProject, UniverseProviderSummary } from "@/types/domain";

/**
 * Static fixture for "Explore Demo Universe" — only ever shown when zero
 * Coolify instances are registered, and only after the user opts in. Never
 * touches the database or a real provider; actions on demo data are
 * intercepted client-side (see useUiStore().demoMode).
 */
export const DEMO_PROVIDERS: UniverseProviderSummary[] = [
  {
    id: "demo-provider-1",
    type: "COOLIFY",
    name: "Coolify Principal (Demo)",
    baseUrl: "https://demo.internal",
    maskedToken: "••••demo",
    enabled: true,
    color: "#38bdf8",
    health: "ONLINE",
    latencyMs: 42,
    lastCheckAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    applicationCount: 10,
    projectCount: 5,
  },
  {
    id: "demo-provider-2",
    type: "COOLIFY",
    name: "VPS Secundária (Demo)",
    baseUrl: "https://demo2.internal",
    maskedToken: "••••demo",
    enabled: true,
    color: "#a78bfa",
    health: "ONLINE",
    latencyMs: 61,
    lastCheckAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    lastError: null,
    applicationCount: 4,
    projectCount: 2,
  },
];

export const DEMO_PROJECTS: UniverseProject[] = [
  { id: "demo-project-italoc", name: "Italoc", slug: "italoc", description: "Sistema de Gestão de Locações", icon: "building", accent: "#38bdf8", enabled: true, archivedAt: null, health: "HEALTHY", resourceCount: 4, providerCount: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "demo-project-transportador", name: "Transportador Digital", slug: "transportador-digital", description: "Gestão de frota e viagens", icon: "truck", accent: "#a78bfa", enabled: true, archivedAt: null, health: "DEPLOYING", resourceCount: 4, providerCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "demo-project-finflow", name: "FinFlow", slug: "finflow", description: "Controle financeiro", icon: "wallet", accent: "#34d399", enabled: true, archivedAt: null, health: "HEALTHY", resourceCount: 3, providerCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "demo-project-icortes", name: "iCortes", slug: "icortes", description: "Agendamento para barbearias", icon: "scissors", accent: "#fbbf24", enabled: true, archivedAt: null, health: "DEGRADED", resourceCount: 3, providerCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "demo-project-construsil", name: "Construsil", slug: "construsil", description: "Operação de transporte de silo", icon: "hard-hat", accent: "#f472b6", enabled: true, archivedAt: null, health: "OFFLINE", resourceCount: 2, providerCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

function resource(
  id: string,
  name: string,
  projectId: string,
  projectName: string,
  projectAccent: string,
  providerId: 1 | 2,
  status: UniverseApplication["status"],
  pendingOperation: string | null = null,
): UniverseApplication {
  const provider = providerId === 1 ? DEMO_PROVIDERS[0] : DEMO_PROVIDERS[1];
  return {
    id,
    externalId: id,
    providerId: provider.id,
    providerType: provider.type,
    providerName: provider.name,
    providerColor: provider.color,
    projectId,
    projectName,
    projectAccent,
    resourceType: name.toLowerCase().includes("postgres") || name.toLowerCase().includes("database") ? "DATABASE" : "APPLICATION",
    name,
    description: null,
    status,
    fqdn: status === "STOPPED" ? null : `${id}.example.com`,
    repository: `italoplaylist-maker/${projectId.replace("demo-project-", "")}`,
    branch: "main",
    lastDeployedAt: status === "STOPPED" ? null : new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    lastSyncedAt: new Date().toISOString(),
    pendingOperation,
  };
}

export const DEMO_APPLICATIONS: UniverseApplication[] = [
  // Italoc — spans both demo providers, like the spec's worked example.
  resource("demo-italoc-web", "Web", "demo-project-italoc", "Italoc", "#38bdf8", 1, "RUNNING"),
  resource("demo-italoc-api", "API", "demo-project-italoc", "Italoc", "#38bdf8", 1, "RUNNING"),
  resource("demo-italoc-db", "PostgreSQL", "demo-project-italoc", "Italoc", "#38bdf8", 1, "RUNNING"),
  resource("demo-italoc-bot", "Chatbot", "demo-project-italoc", "Italoc", "#38bdf8", 2, "RUNNING"),

  // Transportador — one resource mid-deploy, to show the HQ reacting live.
  resource("demo-transportador-web", "Web", "demo-project-transportador", "Transportador Digital", "#a78bfa", 1, "RUNNING"),
  resource("demo-transportador-api", "API", "demo-project-transportador", "Transportador Digital", "#a78bfa", 1, "DEPLOYING", "REDEPLOY"),
  resource("demo-transportador-db", "PostgreSQL", "demo-project-transportador", "Transportador Digital", "#a78bfa", 1, "RUNNING"),
  resource("demo-transportador-worker", "Worker", "demo-project-transportador", "Transportador Digital", "#a78bfa", 1, "RUNNING"),

  resource("demo-finflow-web", "Web", "demo-project-finflow", "FinFlow", "#34d399", 1, "RUNNING"),
  resource("demo-finflow-api", "API", "demo-project-finflow", "FinFlow", "#34d399", 1, "RUNNING"),
  resource("demo-finflow-db", "PostgreSQL", "demo-project-finflow", "FinFlow", "#34d399", 1, "RUNNING"),

  resource("demo-icortes-web", "Web", "demo-project-icortes", "iCortes", "#fbbf24", 1, "RUNNING"),
  resource("demo-icortes-api", "API", "demo-project-icortes", "iCortes", "#fbbf24", 1, "ERROR"),
  resource("demo-icortes-db", "PostgreSQL", "demo-project-icortes", "iCortes", "#fbbf24", 1, "RUNNING"),

  resource("demo-construsil-web", "Web", "demo-project-construsil", "Construsil", "#f472b6", 2, "STOPPED"),
  resource("demo-construsil-db", "PostgreSQL", "demo-project-construsil", "Construsil", "#f472b6", 2, "STOPPED"),
];
