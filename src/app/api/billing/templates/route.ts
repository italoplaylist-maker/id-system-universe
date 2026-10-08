import { NextResponse } from "next/server";
import { z } from "zod";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { getTemplates, updateTemplate } from "@/server/billing/templates";

export async function GET() {
  try {
    await authorize("billing:view");
    return NextResponse.json({ templates: await getTemplates() });
  } catch (error) {
    return apiError(error);
  }
}

const bodySchema = z.object({ kind: z.enum(["BEFORE", "ON", "AFTER"]), body: z.string() });

export async function PUT(request: Request) {
  try {
    const user = await authorize("billing:manage");
    const { kind, body } = bodySchema.parse(await readJson(request));
    await updateTemplate(kind, body, await actorFor(user));
    return NextResponse.json({ templates: await getTemplates() });
  } catch (error) {
    return apiError(error);
  }
}
