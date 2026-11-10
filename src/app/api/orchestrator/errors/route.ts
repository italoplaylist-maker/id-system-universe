import { NextResponse } from "next/server";
import { apiError } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { listErrorGroups } from "@/server/monitoring/error-collector";

export const dynamic = "force-dynamic";

/** Erros agrupados vistos nos logs dos sistemas (coletados a cada 15 min). `?horas=24&sistema=nome`. */
export async function GET(request: Request) {
  try {
    await guard(false);
    const url = new URL(request.url);
    const hours = Math.min(Math.max(Number(url.searchParams.get("horas")) || 24, 1), 720);
    const system = url.searchParams.get("sistema")?.trim().slice(0, 80) || undefined;
    return NextResponse.json({ errors: await listErrorGroups({ hours, system, limit: 60 }) });
  } catch (error) {
    return apiError(error);
  }
}
