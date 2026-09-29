"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateProvider } from "@/hooks/use-providers";
import { Plus } from "lucide-react";

const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#fb923c"];

export function AddProviderDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; applicationCount?: number; error?: string } | null>(null);

  const createProvider = useCreateProvider();

  function reset() {
    setName("");
    setBaseUrl("");
    setToken("");
    setColor(PALETTE[0]);
    setTestResult(null);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, token }),
      });
      const body = await res.json();
      setTestResult(body);
    } catch {
      setTestResult({ ok: false, error: "Connection failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    try {
      await createProvider.mutateAsync({ name, baseUrl, token, color });
      toast.success(`${name} connected.`);
      setOpen(false);
      reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save provider.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> Add Coolify
        </Button>
      </DialogTrigger>
      <DialogContent title="Add Coolify Instance" description="Credentials are encrypted at rest and never sent back to the browser.">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Coolify Principal" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Base URL</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://coolify.example.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">API Token</label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Color</label>
            <div className="flex gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-raised"
                  style={{ backgroundColor: c, outline: color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }}
                  aria-label={`Choose color ${c}`}
                />
              ))}
            </div>
          </div>

          <Button variant="secondary" className="w-full" disabled={!baseUrl || !token || testing} onClick={handleTest}>
            {testing ? "Testing…" : "Test Connection"}
          </Button>

          {testResult?.ok && <p className="text-sm text-status-running">Connection successful. {testResult.applicationCount ?? 0} applications found.</p>}
          {testResult && !testResult.ok && <p className="text-sm text-status-error">{testResult.error}</p>}

          <Button variant="primary" className="w-full" disabled={!testResult?.ok || !name || createProvider.isPending} onClick={handleSave}>
            {createProvider.isPending ? "Saving…" : "Save Provider"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
