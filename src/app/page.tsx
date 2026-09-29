import { redirect } from "next/navigation";
import { isBootstrapAvailable } from "@/server/auth/bootstrap";
import { UniverseShell } from "@/components/universe-shell";

// Depends on live DB state (has an admin been created yet?) — must never be
// baked in at build time, or the redirect decision would freeze at whatever
// was true when `next build` ran.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const needsSetup = await isBootstrapAvailable();
  if (needsSetup) redirect("/onboarding");

  return <UniverseShell />;
}
