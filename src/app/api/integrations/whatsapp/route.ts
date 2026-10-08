import { NextResponse } from "next/server";
import { actorFor, apiError, authorize, readJson } from "@/server/http/api-helpers";
import { getWhatsAppSettingsView, updateWhatsAppSettings } from "@/server/whatsapp/whatsapp-config";

export async function GET() {
  try {
    await authorize("integration:manage");
    return NextResponse.json({ config: await getWhatsAppSettingsView() });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await authorize("integration:manage");
    return NextResponse.json({ config: await updateWhatsAppSettings(await readJson(request), await actorFor(user)) });
  } catch (error) {
    return apiError(error);
  }
}
