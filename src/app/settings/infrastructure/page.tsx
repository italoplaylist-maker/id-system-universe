"use client";

import { useProviders } from "@/hooks/use-providers";
import { ProviderCard } from "@/components/providers/provider-card";
import { AddProviderDialog } from "@/components/providers/provider-form-dialog";

export default function InfrastructurePage() {
  const { data: providers, isLoading } = useProviders();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Infrastructure</p>
          <h2 className="text-xl font-semibold">Coolify Instances</h2>
        </div>
        <AddProviderDialog />
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && providers?.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          No Coolify instances connected yet. Add one to start managing your applications.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers?.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} />
        ))}
      </div>
    </div>
  );
}
