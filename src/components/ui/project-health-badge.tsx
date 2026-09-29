import { Activity, CircleAlert, CircleHelp, Loader2, PowerOff } from "lucide-react";
import { cn } from "@/lib/cn";
import type { UniverseProjectHealth } from "@/types/domain";

const HEALTH_CONFIG: Record<UniverseProjectHealth, { label: string; icon: typeof Activity; className: string }> = {
  HEALTHY: { label: "Healthy", icon: Activity, className: "text-status-running border-status-running/30 bg-status-running/10" },
  DEGRADED: { label: "Degraded", icon: CircleAlert, className: "text-status-warning border-status-warning/30 bg-status-warning/10" },
  DEPLOYING: { label: "Deploying", icon: Loader2, className: "text-status-deploying border-status-deploying/30 bg-status-deploying/10" },
  OFFLINE: { label: "Offline", icon: PowerOff, className: "text-status-error border-status-error/30 bg-status-error/10" },
  UNKNOWN: { label: "Unknown", icon: CircleHelp, className: "text-status-unknown border-status-unknown/30 bg-status-unknown/10" },
};

/** Derived only from real resource states — never a guess. See computeProjectHealth. */
export function ProjectHealthBadge({ health, className }: { health: UniverseProjectHealth; className?: string }) {
  const config = HEALTH_CONFIG[health];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", config.className, className)}>
      <Icon className={cn("h-3.5 w-3.5", health === "DEPLOYING" && "animate-spin")} aria-hidden />
      {config.label}
    </span>
  );
}
