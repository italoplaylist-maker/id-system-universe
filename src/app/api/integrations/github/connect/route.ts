import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { buildInstallUrl } from "@/server/github/github-service";

/** Devolve a URL de instalação do GitHub App (com state assinado) — o navegador só redireciona. */
export async function POST() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    return NextResponse.json({ url: await buildInstallUrl(user.id) });
  } catch (error) {
    return apiError(error);
  }
}
