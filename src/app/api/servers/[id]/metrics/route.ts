import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { requireGlobalScope } from "@/server/auth/project-access";
import { ValidationError } from "@/lib/errors";
import { getServerMetrics, RANGES, type RangeKey } from "@/server/monitoring/server-service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize("provider:read");
    await requireGlobalScope(user);
    const range = new URL(request.url).searchParams.get("range") ?? "1h";
    if (!(range in RANGES)) throw new ValidationError("Período inválido.");
    return NextResponse.json(await getServerMetrics((await params).id, range as RangeKey));
  } catch (error) {
    return apiError(error);
  }
}
