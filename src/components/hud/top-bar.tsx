"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Settings, LogOut, LayoutGrid, Box, RefreshCw, Building2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { useApplications } from "@/hooks/use-applications";
import { useSyncAll } from "@/hooks/use-applications";
import { useProjects } from "@/hooks/use-projects";
import { useUiStore } from "@/store/ui-store";
import { Button } from "@/components/ui/button";

function StatusPill({ label, value, dotClassName }: { label: string; value: number; dotClassName: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${dotClassName}`} aria-hidden />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

export function TopBar() {
  const router = useRouter();
  const { data: user } = useSession();
  const { data: applications } = useApplications();
  const { data: projects } = useProjects();
  const sync = useSyncAll();
  const { viewMode, setViewMode, setCommandPaletteOpen } = useUiStore();

  const projectCount = projects?.length ?? 0;
  const total = applications?.length ?? 0;
  const online = applications?.filter((a) => a.status === "RUNNING").length ?? 0;
  const deploying = applications?.filter((a) => a.status === "DEPLOYING").length ?? 0;
  const incidents = applications?.filter((a) => a.status === "ERROR").length ?? 0;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <div className="leading-tight">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted">ID System</p>
          <p className="text-sm font-semibold">Universe</p>
        </div>
        <div className="hidden items-center gap-5 md:flex">
          <StatusPill label="Projects" value={projectCount} dotClassName="bg-accent" />
          <StatusPill label="Resources" value={total} dotClassName="bg-accent" />
          <StatusPill label="Online" value={online} dotClassName="bg-status-running" />
          <StatusPill label="Deploying" value={deploying} dotClassName="bg-status-deploying" />
          <StatusPill label="Incidents" value={incidents} dotClassName={incidents > 0 ? "bg-status-error" : "bg-status-unknown"} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href="/projects" className="rounded-md p-2 text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Projects">
          <Building2 className="h-4 w-4" />
        </Link>

        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5" />
          Search
          <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await sync.mutateAsync();
              toast.success("Universe synced.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Sync failed.");
            }
          }}
        >
          <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
        </Button>

        <div className="flex rounded-md border border-border p-0.5">
          <button
            onClick={() => setViewMode("UNIVERSE")}
            className={`rounded p-1.5 ${viewMode === "UNIVERSE" ? "bg-accent text-black" : "text-muted hover:text-foreground"}`}
            aria-label="Universe view"
            aria-pressed={viewMode === "UNIVERSE"}
          >
            <Box className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("LIST")}
            className={`rounded p-1.5 ${viewMode === "LIST" ? "bg-accent text-black" : "text-muted hover:text-foreground"}`}
            aria-label="List view"
            aria-pressed={viewMode === "LIST"}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <Link href="/settings/infrastructure" className="rounded-md p-2 text-muted hover:bg-surface-raised hover:text-foreground" aria-label="Settings">
          <Settings className="h-4 w-4" />
        </Link>

        {user && (
          <div className="flex items-center gap-2 pl-2">
            <span className="hidden text-xs text-muted sm:inline">{user.email}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Log out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
