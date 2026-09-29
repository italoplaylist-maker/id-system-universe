"use client";

import { useUiStore } from "@/store/ui-store";
import { TopBar } from "@/components/hud/top-bar";
import { EventStream } from "@/components/hud/event-stream";
import { HqView } from "@/components/universe/hq/hq-view";
import { ListView } from "@/components/applications/list-view";
import { ApplicationPanel } from "@/components/applications/application-panel";
import { CommandPalette } from "@/components/command-palette/command-palette";

export function UniverseShell() {
  const { viewMode } = useUiStore();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopBar />
      <div className="relative flex flex-1 overflow-hidden">
        {viewMode === "UNIVERSE" ? <HqView /> : <ListView />}
      </div>
      <EventStream />
      <ApplicationPanel />
      <CommandPalette />
    </div>
  );
}
