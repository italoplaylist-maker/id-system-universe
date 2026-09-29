import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

/**
 * Health of the Universe itself — deliberately does not touch Coolify or any
 * external provider. A Coolify outage must never take this container's
 * healthcheck down with it.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
