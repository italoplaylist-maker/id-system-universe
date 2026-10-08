import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { listRepositories } from "@/server/github/github-service";

/** Repositórios autorizados no GitHub App — usados para vincular a Resources (exige poder editar Projects). */
export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    return NextResponse.json({ repositories: await listRepositories() });
  } catch (error) {
    return apiError(error);
  }
}
