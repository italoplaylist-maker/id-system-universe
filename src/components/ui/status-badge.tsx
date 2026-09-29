import { Activity, CircleAlert, CircleHelp, Loader2, Square } from "lucide-react";
import { cn } from "@/lib/cn";
import type { UniverseApplicationStatus } from "@/types/domain";

const STATUS_CONFIG: Record<UniverseApplicationStatus, { label: string; icon: typeof Activity; className: string }> = {
  RUNNING: { label: "Running", icon: Activity, className: "text-status-running border-status-running/30 bg-status-running/10" },
  STOPPED: { label: "Stopped", icon: Square, className: "text-status-stopped border-status-stopped/30 bg-status-stopped/10" },
  DEPLOYING: { label: "Deploying", icon: Loader2, className: "text-status-deploying border-status-deploying/30 bg-status-deploying/10" },
  ERROR: { label: "Error", icon: CircleAlert, className: "text-status-error border-status-error/30 bg-status-error/10" },
  UNKNOWN: { label: "Unknown", icon: CircleHelp, className: "text-status-unknown border-status-unknown/30 bg-status-unknown/10" },
};

/** Status is always conveyed by icon + text + color together — never color alone. */
export function StatusBadge({ status, className }: { status: UniverseApplicationStatus; className?: string }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", config.className, className)}>
      <Icon className={cn("h-3.5 w-3.5", status === "DEPLOYING" && "animate-spin")} aria-hidden />
      {config.label}
    </span>
  );
}
