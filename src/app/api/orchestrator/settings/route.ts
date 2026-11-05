import { NextResponse } from "next/server";
import { actorFor, apiError, readJson } from "@/server/http/api-helpers";
import { guard } from "@/server/orchestrator/guard";
import { getSettings, updateSettings } from "@/server/orchestrator/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await guard(false);
    return NextResponse.json({ settings: await getSettings() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await guard(true);
    return NextResponse.json({ settings: await updateSettings(await readJson(request), await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}
