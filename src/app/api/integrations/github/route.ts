import { NextResponse } from "next/server";
import { requireSessionUser, getRequestMeta } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { getGitHubConfigStatus, listInstallations, updateGitHubConfig } from "@/server/github/github-service";

export async function GET() {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    const [config, installations] = await Promise.all([getGitHubConfigStatus(), listInstallations()]);
    return NextResponse.json({ config, installations });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "integration:manage");
    const meta = await getRequestMeta();
    const config = await updateGitHubConfig(await request.json(), { userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return NextResponse.json({ config });
  } catch (error) {
    return apiError(error);
  }
}
