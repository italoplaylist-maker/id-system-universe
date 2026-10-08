import { NextResponse } from "next/server";
import { requireSessionUser } from "@/server/auth/session";
import { requirePermission, apiError } from "@/server/http/api-helpers";
import { listBranches } from "@/server/github/github-service";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Params = Promise<{ id: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  try {
    const user = await requireSessionUser();
    requirePermission(user, "project:write");
    consumeRateLimit(`github-branches:${user.id}`, 30, 60_000);
    const { id } = await params;
    return NextResponse.json({ branches: await listBranches(id) });
  } catch (error) {
    return apiError(error);
  }
}
