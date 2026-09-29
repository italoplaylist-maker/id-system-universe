import Link from "next/link";
import { SettingsNav } from "@/components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
          ← Back to Universe
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Settings</h1>
      </header>
      <SettingsNav />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
