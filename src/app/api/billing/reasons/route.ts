import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authorize, readJson } from "@/server/http/api-helpers";
import { listReasons, resolveReasonId } from "@/server/billing/charge-service";

export async function GET() {
  try {
    await authorize("billing:view");
    return NextResponse.json({ reasons: await listReasons() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await authorize("billing:manage");
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await readJson(request));
    await resolveReasonId(null, name);
    return NextResponse.json({ reasons: await listReasons() }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
