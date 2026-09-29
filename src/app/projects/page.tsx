"use client";

import { useState } from "react";
import Link from "next/link";
import { useProjects } from "@/hooks/use-projects";
import { Input } from "@/components/ui/input";
import { ProjectCard } from "@/components/projects/project-card";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { UnassignedResourcesPanel } from "@/components/projects/unassigned-resources-panel";

export default function ProjectsPage() {
  const [query, setQuery] = useState("");
  const { data: projects, isLoading } = useProjects();

  const filtered = projects?.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.description?.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
          ← Back to Universe
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Projects</h1>
          <CreateProjectDialog />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <UnassignedResourcesPanel />

        <Input placeholder="Search projects…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-6 max-w-xs" />

        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && filtered?.length === 0 && <p className="text-sm text-muted">No projects match.</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered?.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      </main>
    </div>
  );
}
