/**
 * Runs once when the server process starts (Next.js instrumentation hook —
 * both `next dev` and the standalone server call this exactly once).
 *
 * Root-cause fix for "Projects show up empty/stale in the Universe": before
 * this, syncing an application's list — and therefore the Coolify-project
 * auto-link (`linkUnassignedResourcesFromProviderProjects`) — only ran when
 * a human clicked "Sync" in the top bar. Deploy new code, don't click
 * Sync, and the Universe just keeps showing whatever was cached before —
 * indistinguishable from a real bug. A background interval keeps the cache
 * (and therefore Projects) current without depending on someone remembering
 * to click a button.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const SYNC_INTERVAL_MS = 60_000;
  const { syncAllProviders } = await import("@/server/applications/application-service");
  const { logger } = await import("@/lib/logger");

  const runSync = () => {
    syncAllProviders().catch((error) => {
      logger.error("background_sync_failed", { message: error instanceof Error ? error.message : String(error) });
    });
  };

  // Fire once shortly after boot (give the DB connection a moment), then on the interval.
  setTimeout(runSync, 5_000);
  setInterval(runSync, SYNC_INTERVAL_MS);
}
