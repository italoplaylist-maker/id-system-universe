"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Pause, Play, Trash2 } from "lucide-react";
import { useApplicationLogs } from "@/hooks/use-applications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { toast } from "sonner";

const LEVEL_CLASSES: Record<string, string> = {
  INFO: "text-foreground/80",
  WARN: "text-status-warning",
  ERROR: "text-status-error",
};

const LINE_OPTIONS = [100, 500, 1000, 2000];

export function LogsTerminal({ applicationId }: { applicationId: string }) {
  const [live, setLive] = useState(true);
  const [lines, setLines] = useState(500);
  const [search, setSearch] = useState("");
  const [cleared, setCleared] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useApplicationLogs(applicationId, { live, lines });

  const visibleLines = useMemo(() => {
    const raw = data?.lines ?? [];
    const filtered = search ? raw.filter((l) => l.raw.toLowerCase().includes(search.toLowerCase())) : raw;
    return filtered.slice(cleared);
  }, [data, search, cleared]);

  useEffect(() => {
    if (live && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLines, live]);

  function handleCopy() {
    navigator.clipboard.writeText(visibleLines.map((l) => l.raw).join("\n"));
    toast.success("Logs copied to clipboard.");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
        <Button variant={live ? "primary" : "secondary"} size="sm" onClick={() => setLive((v) => !v)}>
          {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {live ? "Live" : "Paused"}
        </Button>
        <Input placeholder="Search logs…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 max-w-[200px]" />
        <select
          value={lines}
          onChange={(e) => setLines(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
        >
          {LINE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} lines
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCleared((data?.lines.length ?? 0))}>
          <Trash2 className="h-3.5 w-3.5" /> Clear View
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background p-3 font-mono text-xs leading-relaxed">
        {isLoading && <p className="text-muted">Loading logs…</p>}
        {!isLoading && visibleLines.length === 0 && <p className="text-muted">No log lines.</p>}
        {visibleLines.map((line, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-all", LEVEL_CLASSES[line.level])}>
            {line.raw}
          </div>
        ))}
      </div>
    </div>
  );
}
