import { NextResponse } from "next/server";
import { apiError, authorize } from "@/server/http/api-helpers";
import { checkWhatsAppConnection } from "@/server/whatsapp/whatsapp-config";
import { consumeRateLimit } from "@/server/security/rate-limit";

export async function POST() {
  try {
    const user = await authorize("integration:manage");
    consumeRateLimit(`whatsapp-test:${user.id}`, 10, 60_000);
    return NextResponse.json({ status: await checkWhatsAppConnection() });
  } catch (error) {
    return apiError(error);
  }
}
