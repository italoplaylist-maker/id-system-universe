"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/settings/infrastructure", label: "Infrastructure" },
  { href: "/settings/users", label: "Users" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-border px-6">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "border-b-2 px-3 py-2 text-sm",
            pathname === tab.href ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
