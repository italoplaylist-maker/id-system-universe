"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH_CLIENT } from "@/lib/constants";

type Step = "loading" | "welcome" | "admin" | "provider" | "done";

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const [providerName, setProviderName] = useState("Coolify Principal");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; applicationCount?: number; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/bootstrap")
      .then((r) => r.json())
      .then((data) => setStep(data.available ? "welcome" : "provider"))
      .catch(() => setStep("welcome"));
  }, []);

  async function handleCreateAdmin() {
    if (password.length < MIN_PASSWORD_LENGTH_CLIENT) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH_CLIENT} characters.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not create the administrator.");
      }
      setStep("provider");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the administrator.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTestConnection() {
    setBusy(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, token }),
      });
      const body = await res.json();
      setTestResult(body);
      if (!body.ok) toast.error(body.error ?? "Connection failed.");
    } catch {
      setTestResult({ ok: false, error: "Connection failed." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveProvider() {
    setBusy(true);
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: providerName, baseUrl, token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save the provider.");
      }
      setStep("done");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the provider.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "loading") return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-8">
        {step === "welcome" && (
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Welcome to</p>
            <h1 className="mt-1 mb-6 text-2xl font-semibold">ID System Universe</h1>
            <Button variant="primary" className="w-full" onClick={() => setStep("admin")}>
              Get Started
            </Button>
          </div>
        )}

        {step === "admin" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Create Admin</h2>
            <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input type="password" placeholder={`Password (min. ${MIN_PASSWORD_LENGTH_CLIENT} chars)`} value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button variant="primary" className="w-full" disabled={busy || !email || !password} onClick={handleCreateAdmin}>
              {busy ? "Creating…" : "Continue"}
            </Button>
          </div>
        )}

        {step === "provider" && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Connect your first infrastructure provider</h2>
            <p className="text-xs text-muted">COOLIFY</p>
            <Input placeholder="Name (e.g. Coolify Principal)" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
            <Input placeholder="https://coolify.example.com" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            <Input placeholder="API Token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />

            <Button variant="secondary" className="w-full" disabled={busy || !baseUrl || !token} onClick={handleTestConnection}>
              {busy ? "Testing…" : "Test Connection"}
            </Button>

            {testResult?.ok && (
              <p className="text-sm text-status-running">Connection successful. {testResult.applicationCount ?? 0} applications found.</p>
            )}
            {testResult && !testResult.ok && <p className="text-sm text-status-error">{testResult.error}</p>}

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => router.replace("/")}>
                Skip for now
              </Button>
              <Button variant="primary" className="flex-1" disabled={busy || !testResult?.ok} onClick={handleSaveProvider}>
                Save &amp; Continue
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <h2 className="mb-2 text-lg font-semibold text-status-running">Connection successful</h2>
            <p className="mb-6 text-sm text-muted">Your infrastructure is now part of the Universe.</p>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                router.replace("/");
                router.refresh();
              }}
            >
              Enter Universe
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
