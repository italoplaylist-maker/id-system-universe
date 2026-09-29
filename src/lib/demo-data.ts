import type { UniverseApplication, UniverseProviderSummary } from "@/types/domain";

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
    applicationCount: 3,
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
    applicationCount: 2,
  },
];

export const DEMO_APPLICATIONS: UniverseApplication[] = [
  { id: "demo-app-1", externalId: "d1", providerId: "demo-provider-1", providerType: "COOLIFY", providerName: "Coolify Principal (Demo)", providerColor: "#38bdf8", name: "Italoc", description: null, status: "RUNNING", fqdn: "italoc.example.com", repository: "italoplaylist-maker/Italoc", branch: "main", lastDeployedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(), lastSyncedAt: new Date().toISOString(), pendingOperation: null },
  { id: "demo-app-2", externalId: "d2", providerId: "demo-provider-1", providerType: "COOLIFY", providerName: "Coolify Principal (Demo)", providerColor: "#38bdf8", name: "FinFlow", description: null, status: "DEPLOYING", fqdn: "finflow.example.com", repository: "italoplaylist-maker/finflow", branch: "main", lastDeployedAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(), lastSyncedAt: new Date().toISOString(), pendingOperation: "REDEPLOY" },
  { id: "demo-app-3", externalId: "d3", providerId: "demo-provider-1", providerType: "COOLIFY", providerName: "Coolify Principal (Demo)", providerColor: "#38bdf8", name: "iCortes", description: null, status: "RUNNING", fqdn: "icortes.example.com", repository: "italoplaylist-maker/icortes", branch: "main", lastDeployedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), lastSyncedAt: new Date().toISOString(), pendingOperation: null },
  { id: "demo-app-4", externalId: "d4", providerId: "demo-provider-2", providerType: "COOLIFY", providerName: "VPS Secundária (Demo)", providerColor: "#a78bfa", name: "Construsil", description: null, status: "ERROR", fqdn: "construsil.example.com", repository: "italoplaylist-maker/construsil", branch: "main", lastDeployedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), lastSyncedAt: new Date().toISOString(), pendingOperation: null },
  { id: "demo-app-5", externalId: "d5", providerId: "demo-provider-2", providerType: "COOLIFY", providerName: "VPS Secundária (Demo)", providerColor: "#a78bfa", name: "Transportador", description: null, status: "STOPPED", fqdn: null, repository: "italoplaylist-maker/transportador", branch: "develop", lastDeployedAt: null, lastSyncedAt: new Date().toISOString(), pendingOperation: null },
];
