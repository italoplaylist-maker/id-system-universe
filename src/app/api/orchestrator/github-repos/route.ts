import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listInstallations, listRepositories, syncAllInstallations } from "@/server/github/github-service";

export const dynamic = "force-dynamic";

async function payload() {
  const [repos, installations] = await Promise.all([listRepositories(), listInstallations()]);
  return { repositories: repos.map((r) => ({ id: r.id, fullName: r.fullName, defaultBranch: r.defaultBranch, isPrivate: r.isPrivate })), installations: installations.length };
}

/** Repositórios que o GitHub App já enxerga: a lista para o agente escolher "Conectar repositório". */
export async function GET() {
  try {
    await guard(false);
    return NextResponse.json(await payload());
  } catch (error) {
    return apiError(error);
  }
}

/** "Atualizar lista": volta a perguntar ao GitHub quais repositórios as instalações enxergam. */
export async function POST() {
  try {
    await guard(true);
    await syncAllInstallations();
    return NextResponse.json(await payload());
  } catch (error) {
    return apiError(error);
  }
}
