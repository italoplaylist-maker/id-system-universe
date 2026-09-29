"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateProject } from "@/hooks/use-projects";
import { ApiClientError } from "@/lib/api-client";

const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb923c"];

export function CreateProjectDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [accent, setAccent] = useState(PALETTE[0]);
  const createProject = useCreateProject();

  async function handleCreate() {
    try {
      await createProject.mutateAsync({ name, description: description || undefined, accent });
      toast.success(`${name} created.`);
      setOpen(false);
      setName("");
      setDescription("");
      setAccent(PALETTE[0]);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Could not create project.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </DialogTrigger>
      <DialogContent title="New Project" description="A project groups resources from one or more providers under one product.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Italoc" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Description (optional)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Sistema de Gestão de Locações" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Accent</label>
            <div className="flex gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: c, outline: accent === c ? `2px solid ${c}` : "none", outlineOffset: 2 }}
                  aria-label={`Choose accent ${c}`}
                />
              ))}
            </div>
          </div>
          <Button variant="primary" className="w-full" disabled={!name || createProject.isPending} onClick={handleCreate}>
            {createProject.isPending ? "Creating…" : "Create Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
