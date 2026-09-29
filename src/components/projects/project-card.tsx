import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ProjectHealthBadge } from "@/components/ui/project-health-badge";
import type { UniverseProject } from "@/types/domain";

export function ProjectCard({ project }: { project: UniverseProject }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="h-full p-4 transition-colors hover:border-accent/50">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: project.accent }} aria-hidden />
            <p className="font-medium">{project.name}</p>
          </div>
          {!project.enabled && <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] uppercase text-muted">Disabled</span>}
        </div>
        {project.description && <p className="mt-1 truncate text-xs text-muted">{project.description}</p>}
        <div className="mt-3">
          <ProjectHealthBadge health={project.health} />
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted">
          <span>{project.resourceCount} resources</span>
          <span>{project.providerCount} providers</span>
        </div>
      </Card>
    </Link>
  );
}
